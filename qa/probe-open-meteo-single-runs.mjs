import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {buildHourlyPrecipitationIntervals} from "../src/open-meteo-time-adapter.mjs";
import {aggregatePrecipitation} from "../src/precipitation-core.mjs";
const observationPath="artifacts/observation-archive/ogimet-synop-40872.json";
if(!fs.existsSync(observationPath))throw new Error("OGIMET archive required before Single Runs probe");
const observations=JSON.parse(fs.readFileSync(observationPath,"utf8"));
const now=new Date(),cutoff=now.getTime()-10*86400000;
const targetWindows=(observations.daily_non_overlapping_24h||[])
 .filter(w=>Number.isFinite(Date.parse(w.window_start_utc))&&Date.parse(w.window_start_utc)>=cutoff&&Date.parse(w.window_end_utc)<=now.getTime())
 .sort((a,b)=>a.window_start_utc.localeCompare(b.window_start_utc)).slice(-10);
if(targetWindows.length===0)throw new Error("No recent complete non-overlapping 24h observation windows available for historical single-run probe");
const TARGET={name:"Abdan",latitude:28.0801523,longitude:51.77113355,timezone:"Asia/Tehran"};
const models=["ecmwf_ifs","gfs_global","icon_global"];
async function probeModel(model,runParam,runUtc,targetWindow){
 const url=`https://single-runs-api.open-meteo.com/v1/forecast?latitude=${TARGET.latitude}&longitude=${TARGET.longitude}&models=`+model+"&run="+encodeURIComponent(runParam)+"&hourly=precipitation&forecast_days=10&timezone=UTC`;
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{"user-agent":"Baranban-Abadan/5.1 historical single-run verification"}});
  const body=await response.text();
  if(!response.ok)return {model,run_utc:runUtc,http_status:response.status,available:false,error:body.slice(0,400),url};
  const raw=JSON.parse(body),times=raw.hourly?.time,values=raw.hourly?.precipitation;
  if(!Array.isArray(times)||!Array.isArray(values)||times.length!==values.length)throw new Error("hourly precipitation arrays missing or misaligned");
  const intervals=buildHourlyPrecipitationIntervals(times,values,raw.hourly_units?.precipitation||"mm","UTC");
  const total=aggregatePrecipitation(intervals,{start:targetWindow.window_start_utc,end:targetWindow.window_end_utc});
  return {model,run_utc:runUtc,http_status:response.status,available:true,timezone:raw.timezone,utc_offset_seconds:raw.utc_offset_seconds,coverage_start:times[0],coverage_end:times.at(-1),hourly_count:times.length,precipitation_unit:raw.hourly_units?.precipitation||"mm",payload_sha256:createHash("sha256").update(body).digest("hex"),target_window:{start_utc:targetWindow.window_start_utc,end_utc:targetWindow.window_end_utc,observed_mm:targetWindow.total_mm,forecast_mm:total.ok?total.totalMm:null,error_mm:total.ok?Number((total.totalMm-targetWindow.total_mm).toFixed(3)):null,coverage_ok:total.ok,reason:total.reason||null},raw_payload:raw,url};
 }catch(error){return {model,run_utc:runUtc,available:false,error:String(error),url};}
}
const runs=[];
for(const targetWindow of targetWindows){
 const date=targetWindow.window_start_utc.slice(0,10),runUtc=date+"T00:00:00Z";
 const results=await Promise.all(models.map(model=>probeModel(model,date,runUtc,targetWindow)));
 runs.push({run_utc:runUtc,valid_time_window:{start_utc:targetWindow.window_start_utc,end_utc:targetWindow.window_end_utc,observed_mm:targetWindow.total_mm},models:results});
}
const allModels=runs.flatMap(r=>r.models),availablePairs=allModels.filter(m=>m.available&&m.target_window?.coverage_ok).length;
const archive={archive_schema_version:"1.0.0",generated_at_utc:new Date().toISOString(),provider:"Open-Meteo Single Runs API",endpoint:"https://single-runs-api.open-meteo.com/v1/forecast",target:TARGET,verification_station:{station_id:"WMO-40872",name:"Bandar-e-Dayyer",distance_km:31.7,direct_abadan_ground_truth:false},method:"For each recent exact 24h observation window, query the 00Z deterministic model run from that same UTC date and aggregate the exact matching 24h forecast window.",runs,summary:{requested_windows:targetWindows.length,requested_models_per_window:models.length,requested_model_runs:allModels.length,available_forecast_pairs:availablePairs,failed_or_incomplete_pairs:allModels.length-availablePairs,models:Object.fromEntries(models.map(model=>[model,{available_pairs:allModels.filter(m=>m.model===model&&m.available&&m.target_window?.coverage_ok).length,requested_pairs:targetWindows.length}])),exact_runs_preserved:true,skill_calibration_approved:false}};
const output="artifacts/observation-archive/open-meteo-single-runs-probe.json";fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(archive,null,2)+"\n");
console.log(JSON.stringify({output,summary:archive.summary,runs:runs.map(r=>({run_utc:r.run_utc,observed_mm:r.valid_time_window.observed_mm,models:r.models.map(m=>({model:m.model,available:m.available,http_status:m.http_status,forecast_mm:m.target_window?.forecast_mm,error_mm:m.target_window?.error_mm,coverage_ok:m.target_window?.coverage_ok,error:m.error}))}))},null,2));
if(availablePairs===0)console.log("No historical single-run forecast pair was available; diagnostic recorded without blocking the observation pipeline.");
