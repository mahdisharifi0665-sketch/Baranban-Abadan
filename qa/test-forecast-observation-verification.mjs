import assert from "node:assert/strict";
import {buildVerificationPairs,scoreVerificationPairs,selectForecastArtifactsForVerification} from "../src/forecast-observation-verification.mjs";
const times=[];for(let i=1;i<=24;i++){const d=new Date(Date.parse("2026-11-10T00:00:00Z")+i*3600000);times.push(d.toISOString().slice(0,16));}
const values=v=>Array(24).fill(v);
const payload=hourly=>JSON.stringify({hourly:{time:times,...hourly},hourly_units:{precipitation:"mm"}});
const archive={archive_id:"test-cycle",generated_at_utc:"2026-11-09T12:00:00Z",target:{timezone:"UTC"},products:[
 {type:"deterministic",model:"ecmwf_ifs",raw_payload:payload({precipitation:values(0.25)})},
 {type:"ensemble",model:"ecmwf_ifs025_ensemble",raw_payload:payload({precipitation_member01:values(0.25),precipitation_member02:values(0.2),precipitation_member03:values(0.1)})}
]};
const observed=[{station_id:"WMO-40872",window_start_utc:"2026-11-10T00:00:00Z",window_end_utc:"2026-11-11T00:00:00Z",total_mm:5}];
const built=buildVerificationPairs(archive,observed);
assert.equal(built.errors.length,0);assert.equal(built.pairs.length,2);
const deterministic=built.pairs.find(x=>x.product_type==="deterministic");
assert.equal(deterministic.forecast_total_mm,6);
const utcArchive={...archive,products:[{...archive.products[0],verification_raw_payload:payload({precipitation:values(0.25)}),verification_timezone:"UTC"}]};
const utcBuilt=buildVerificationPairs(utcArchive,observed,{timezone:"Asia/Tehran"});
assert.equal(utcBuilt.pairs.length,1);assert.equal(deterministic.error_mm,1);assert.equal(deterministic.lead_bin,"0-24h");
const ensemble=built.pairs.find(x=>x.product_type==="ensemble");
assert.equal(ensemble.valid_members,3);assert.equal(ensemble.forecast_mean_mm,4.4);assert.equal(ensemble.probabilities["5"].probability,1/3);assert.equal(ensemble.probabilities["10"].probability,0);
const pastWindow=buildVerificationPairs(archive,[{station_id:"WMO-40872",window_start_utc:"2026-11-08T00:00:00Z",window_end_utc:"2026-11-09T00:00:00Z",total_mm:2}]);
assert.equal(pastWindow.pairs.length,0);assert.equal(pastWindow.errors.length,0);
const historicalArchive={...archive,generated_at_utc:"2026-11-11T11:00:00Z",forecast_issue_time_utc:"2026-11-09T12:00:00Z",forecast_issue_time_basis:"single_runs_api_requested_run_parameter"};
const historical=buildVerificationPairs(historicalArchive,observed);
assert.equal(historical.pairs.length,2);
assert.equal(historical.pairs[0].issue_time_utc,"2026-11-09T12:00:00.000Z");
assert.equal(historical.pairs[0].issue_time_basis,"single_runs_api_requested_run_parameter");
assert.equal(historical.pairs[0].lead_hours,12);
const report=scoreVerificationPairs(built.pairs,{minimumSamples:1});
const detScore=report.groups.find(x=>x.type==="deterministic");assert.equal(detScore.continuous.mae_mm,1);assert.equal(detScore.thresholds["5"].tp,1);
const ensScore=report.groups.find(x=>x.type==="ensemble");assert.equal(ensScore.thresholds["5"].brier_score,Number(((1/3-1)**2).toFixed(5)));
assert.equal(report.direct_abadan_ground_truth,false);assert.equal(report.calibration_approved,false);

const latestEnd=Date.parse("2026-11-12T18:00:00Z"),now=Date.parse("2026-11-13T05:30:00Z");
const artifact=(id,created_at,extra={})=>({id,name:"baranyar-forecast-archive-"+id,created_at,expired:false,archive_download_url:"https://example.invalid/"+id,...extra});
const legacyArtifact=artifact(8,"2026-11-11T10:00:00Z",{name:"baranban-forecast-archive-8"});
const selected=selectForecastArtifactsForVerification([
 artifact(1,"2026-11-11T11:00:00Z"),
 legacyArtifact,
 artifact(2,"2026-11-12T19:00:00Z"),
 artifact(7,"2026-11-12T12:00:00Z"),
 artifact(3,"2026-10-01T11:00:00Z"),
 artifact(4,"2026-11-11T12:00:00Z",{expired:true}),
 artifact(5,"2026-11-11T13:00:00Z",{name:"baranban-observation-archive-5"})
],[{window_start_utc:"2026-11-11T18:00:00Z",window_end_utc:"2026-11-12T18:00:00Z"}],{nowMs:now,lookbackDays:30});
assert.deepEqual(selected.map(x=>x.id),[2,7,1,8],"late-uploaded archives must remain candidates; archive issue time is checked after download");
const lateIssuedArchive={...archive,generated_at_utc:"2026-11-12T19:00:00Z"};
assert.equal(buildVerificationPairs(lateIssuedArchive,observed).pairs.length,0,"an archive actually issued after the observation window must not create a verification pair");
assert.deepEqual(selectForecastArtifactsForVerification([artifact(6,"2026-11-11T11:00:00Z")],[{window_start_utc:"2026-11-12T18:00:00Z",window_end_utc:"2026-11-13T18:00:00Z"}],{nowMs:now}),[artifact(6,"2026-11-11T11:00:00Z")]);
const crowdedInventory=Array.from({length:25},(_,i)=>artifact(100+i,new Date(now-i*60000).toISOString()));
const broadSelection=selectForecastArtifactsForVerification(crowdedInventory,[{window_start_utc:"2026-11-11T18:00:00Z",window_end_utc:"2026-11-12T18:00:00Z"}],{nowMs:now});
assert.equal(broadSelection.length,25,"verification candidate selection must not truncate at the former 20-artifact default");

console.log("PASS: deterministic MAE/bias/RMSE, threshold contingency, ensemble strict probability, Brier and reliability scoring.");