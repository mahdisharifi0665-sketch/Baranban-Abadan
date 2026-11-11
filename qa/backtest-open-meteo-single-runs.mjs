import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {buildHourlyPrecipitationIntervals} from "../src/open-meteo-time-adapter.mjs";
import {aggregatePrecipitation} from "../src/precipitation-core.mjs";
import {scoreVerificationPairs} from "../src/forecast-observation-verification.mjs";
const observationPath="artifacts/observation-archive/ogimet-synop-40872.json";
if(!fs.existsSync(observationPath))throw new Error("OGIMET observation archive missing");
const observationArchive=JSON.parse(fs.readFileSync(observationPath,"utf8"));
const windows=observationArchive.daily_non_overlapping_24h||[];
const models=["ecmwf_ifs","gfs_global","icon_global"];
const tasks=windows.flatMap(window=>models.map(model=>({window,model,run:window.window_start_utc.slice(0,10)+"T00:00"})));
const results=new Array(tasks.length),pairs=[],headers={"user-agent":"BaranYar-Abadan/6.0.0 exact single-run backtest"};
async function fetchTask(task){
 const issueUtc=task.run+":00Z",issue=Date.parse(issueUtc),start=Date.parse(task.window.window_start_utc),end=Date.parse(task.window.window_end_utc);
 const leadStart=(start-issue)/3600000,leadEnd=(end-issue)/3600000;
 const url="https://single-runs-api.open-meteo.com/v1/forecast?latitude=28.0801523&longitude=51.77113355&models="+task.model+"&run="+encodeURIComponent(task.run)+"&hourly=precipitation&forecast_days=2&timezone=UTC";
 for(let attempt=0;attempt<2;attempt++){try{
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});const body=await response.text();
  if(!response.ok){if(attempt===0&&[429,500,502,503,504].includes(response.status)){await new Promise(resolve=>setTimeout(resolve,700));continue;}return {model:task.model,run_utc:issueUtc,window_end_utc:task.window.window_end_utc,available:false,http_status:response.status,error:body.slice(0,350),url};}
  const raw=JSON.parse(body),times=raw.hourly?.time,values=raw.hourly?.precipitation;
  if(!Array.isArray(times)||!Array.isArray(values)||times.length!==values.length)throw new Error("hourly_precipitation_arrays_missing_or_misaligned");
  const intervals=buildHourlyPrecipitationIntervals(times,values,raw.hourly_units?.precipitation||"mm","UTC");
  const total=aggregatePrecipitation(intervals,{start:task.window.window_start_utc,end:task.window.window_end_utc});
  const result={model:task.model,run_utc:issueUtc,window_start_utc:task.window.window_start_utc,window_end_utc:task.window.window_end_utc,observed_mm:task.window.total_mm,available:true,http_status:response.status,coverage_start:times[0],coverage_end:times.at(-1),hourly_count:times.length,forecast_mm:total.ok?total.totalMm:null,error_mm:total.ok?Number((total.totalMm-task.window.total_mm).toFixed(4)):null,coverage_ok:total.ok,coverage_reason:total.reason||null,lead_start_hours:Number(leadStart.toFixed(2)),lead_end_hours:Number(leadEnd.toFixed(2)),payload_sha256:createHash("sha256").update(body).digest("hex"),raw_payload:raw,url};
  if(total.ok&&leadStart>=0&&leadEnd<=48){pairs.push({product_type:"deterministic",model:task.model,archive_id:"single-run-"+task.run,issue_time_utc:issueUtc,window_start_utc:task.window.window_start_utc,window_end_utc:task.window.window_end_utc,lead_hours:Number(((leadStart+leadEnd)/2).toFixed(2)),lead_bin:"18-42h",station_id:"WMO-40872",observed_total_mm:task.window.total_mm,forecast_total_mm:total.totalMm,error_mm:Number((total.totalMm-task.window.total_mm).toFixed(6))});}
  return result;
 }catch(error){if(attempt===1)return {model:task.model,run_utc:issueUtc,window_end_utc:task.window.window_end_utc,available:false,error:String(error),url};}}
}
let cursor=0;async function worker(){while(true){const index=cursor++;if(index>=tasks.length)return;results[index]=await fetchTask(tasks[index]);}}
await Promise.all(Array.from({length:4},()=>worker()));
const metrics=scoreVerificationPairs(pairs,{minimumSamples:30});
const byModel=Object.fromEntries(models.map(model=>{const rows=results.filter(x=>x.model===model);return [model,{requests:rows.length,available:rows.filter(x=>x.available).length,valid_pairs:pairs.filter(x=>x.model===model).length,coverage_failures:rows.filter(x=>x.available&&x.coverage_ok===false).length,errors:rows.filter(x=>!x.available).length}];}));
const eventCounts=Object.fromEntries([5,10,25].map(th=>[String(th),windows.filter(w=>w.total_mm>=th).length]));
const status=pairs.length===0?"no_valid_pairs":pairs.length<30?"insufficient_sample":"preliminary_regional_proxy";
const report={report_schema_version:"1.0.0",generated_at_utc:new Date().toISOString(),status,calibration_approved:false,event_sample_status:eventCounts["5"]<10?"event_sparse":"event_sample_pending_review",method:"exact_daily_00z_single_run_backtest",provider:"Open-Meteo Single Runs API",run_selection:"00:00 UTC on the UTC date of each observation-window start",lead_window_hours:{start:18,end:42,midpoint:30},forecast_horizon_requested_days:2,models,observation_source:{station_id:"WMO-40872",name:"Bandar-e-Dayyer",distance_from_abadan_km:31.7,direct_abadan_ground_truth:false,archive_id:observationArchive.archive_id},observation_window_count:windows.length,observed_event_counts_mm:eventCounts,request_count:tasks.length,valid_pair_count:pairs.length,model_summary:byModel,metrics,notes:["Each observed 24-hour window ending at 18:00 UTC is paired with the exact 00:00 UTC model run on the same UTC date as the window start; valid-time lead spans 18 to 42 hours.","This is a fixed daily 00Z cycle backtest, not an exhaustive evaluation of every 6-hour model cycle or the full 10-day forecast horizon.","Only deterministic ECMWF IFS, GFS Global and ICON Global products are included; historical ensemble-member probabilities are not evaluated here.","The observation source is a regional proxy 31.7 km from Abadan, not a direct local rain gauge.","The 53-window sample contains very few effective-rain events; continuous errors are preliminary and event scores are not sufficient for calibration or operational threshold changes.","Only strict complete non-overlapping 24-hour observations are used; suspect SYNOP amounts and inferred zeros are excluded."],pairs,run_results:results};
const output="artifacts/verification/single-run-backtest.json";fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({output,status,request_count:tasks.length,valid_pair_count:pairs.length,observed_event_counts_mm:eventCounts,model_summary:byModel,groups:metrics.groups.map(g=>({model:g.model,sample_count:g.sample_count,status:g.status,mae_mm:g.continuous?.mae_mm,bias_mm:g.continuous?.bias_mm,rmse_mm:g.continuous?.rmse_mm,thresholds:g.thresholds}))},null,2));