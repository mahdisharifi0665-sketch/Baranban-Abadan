import {buildHourlyPrecipitationIntervals} from "./open-meteo-time-adapter.mjs";
import {aggregatePrecipitation,createEnsembleCoveragePolicy,ensembleExceedance} from "./precipitation-core.mjs";
const THRESHOLDS=[5,10,25];
function leadBin(hours){if(hours<=24)return "0-24h";if(hours<=48)return "24-48h";if(hours<=72)return "48-72h";if(hours<=120)return "72-120h";return "120-240h";}
function median(values){const sorted=[...values].sort((a,b)=>a-b),m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;}
export function buildVerificationPairs(archive,observedWindows,{timezone=archive?.target?.timezone||"Asia/Tehran"}={}){
 if(!archive||!Array.isArray(archive.products)||!Array.isArray(observedWindows))throw new TypeError("archive_products_and_observed_windows_required");
 const issue=Date.parse(archive.generated_at_utc);if(!Number.isFinite(issue))throw new TypeError("invalid_forecast_archive_issue_time");
 const pairs=[],errors=[];
 for(const product of archive.products){try{
  if(!product||!["deterministic","ensemble"].includes(product.type)||typeof product.model!=="string")throw new TypeError("invalid_forecast_product_metadata");
  const raw=JSON.parse(product.raw_payload);const hourly=raw.hourly||{},times=hourly.time;
  const keys=Object.keys(hourly).filter(k=>k==="precipitation"||k.startsWith("precipitation_"));
  if(!Array.isArray(times)||times.length===0||keys.length===0)throw new TypeError("forecast_hourly_precipitation_missing");
  const unit=raw.hourly_units?.precipitation||"mm";
  if(product.type==="deterministic"){
   const key=keys.includes("precipitation")?"precipitation":keys[0];
   const intervals=buildHourlyPrecipitationIntervals(times,hourly[key],unit,timezone);
   for(const observed of observedWindows){
    const start=Date.parse(observed.window_start_utc),end=Date.parse(observed.window_end_utc);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<issue||end<=start||!Number.isFinite(observed.total_mm))continue;
    const result=aggregatePrecipitation(intervals,{start:observed.window_start_utc,end:observed.window_end_utc});if(!result.ok)continue;
    const lead=(start-issue)/3600000;
    pairs.push({product_type:"deterministic",model:product.model,archive_id:archive.archive_id,issue_time_utc:archive.generated_at_utc,window_start_utc:observed.window_start_utc,window_end_utc:observed.window_end_utc,lead_hours:Number(lead.toFixed(2)),lead_bin:leadBin(lead),station_id:observed.station_id||"WMO-40872",observed_total_mm:observed.total_mm,forecast_total_mm:result.totalMm,error_mm:Number((result.totalMm-observed.total_mm).toFixed(6))});
   }
  } else {
   const members=keys.map(key=>({id:key,intervals:buildHourlyPrecipitationIntervals(times,hourly[key],unit,timezone)}));
   const policy=createEnsembleCoveragePolicy(members.length,"strict-100-v1");
   for(const observed of observedWindows){
    const start=Date.parse(observed.window_start_utc),end=Date.parse(observed.window_end_utc);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<issue||end<=start||!Number.isFinite(observed.total_mm))continue;
    const totals=members.map(m=>aggregatePrecipitation(m.intervals,{start:observed.window_start_utc,end:observed.window_end_utc})).map(r=>r.ok?r.totalMm:null);
    const valid=totals.filter(Number.isFinite);if(valid.length===0)continue;
    const probabilities=Object.fromEntries(THRESHOLDS.map(th=>{const r=ensembleExceedance(members,{start:observed.window_start_utc,end:observed.window_end_utc},th,policy);return [String(th),{probability:r.probability,valid_members:r.validMembers,total_members:r.totalMembers,reason:r.reason||null}];}));
    const lead=(start-issue)/3600000;
    pairs.push({product_type:"ensemble",model:product.model,archive_id:archive.archive_id,issue_time_utc:archive.generated_at_utc,window_start_utc:observed.window_start_utc,window_end_utc:observed.window_end_utc,lead_hours:Number(lead.toFixed(2)),lead_bin:leadBin(lead),station_id:observed.station_id||"WMO-40872",observed_total_mm:observed.total_mm,forecast_mean_mm:Number((valid.reduce((a,b)=>a+b,0)/valid.length).toFixed(6)),forecast_median_mm:Number(median(valid).toFixed(6)),valid_members:valid.length,total_members:members.length,probabilities});
   }
  }
 }catch(error){errors.push({model:product?.model||null,type:product?.type||null,error:String(error)});}}
 return {pairs,errors};
}
function confusion(pairs,threshold){let tp=0,fp=0,fn=0,tn=0;for(const p of pairs){const forecast=p.forecast_total_mm>=threshold,observed=p.observed_total_mm>=threshold;if(forecast&&observed)tp++;else if(forecast&&!observed)fp++;else if(!forecast&&observed)fn++;else tn++;}const n=tp+fp+fn+tn;return {threshold_mm:threshold,sample_count:n,tp,fp,fn,tn,pod:tp+fn?tp/(tp+fn):null,far:tp+fp?fp/(tp+fp):null,accuracy:n?(tp+tn)/n:null};}
export function scoreVerificationPairs(pairs,{minimumSamples=30}={}){
 if(!Array.isArray(pairs))throw new TypeError("pairs_must_be_array");
 const map=new Map();for(const p of pairs){const key=[p.product_type,p.model,p.lead_bin].join("|");if(!map.has(key))map.set(key,[]);map.get(key).push(p);}
 const groups=[];for(const [key,items] of map){const [type,model,leadBinName]=key.split("|");
  if(type==="deterministic"){const errors=items.map(x=>x.error_mm),n=errors.length,mae=errors.reduce((s,x)=>s+Math.abs(x),0)/n,bias=errors.reduce((s,x)=>s+x,0)/n,rmse=Math.sqrt(errors.reduce((s,x)=>s+x*x,0)/n);groups.push({type,model,lead_bin:leadBinName,sample_count:n,status:n>=minimumSamples?"preliminary_regional_proxy":"insufficient_sample",continuous:{mae_mm:Number(mae.toFixed(4)),bias_mm:Number(bias.toFixed(4)),rmse_mm:Number(rmse.toFixed(4))},thresholds:Object.fromEntries(THRESHOLDS.map(th=>[String(th),confusion(items,th)]))});
  }else{const brier={};for(const th of THRESHOLDS){const scored=items.filter(x=>Number.isFinite(x.probabilities?.[String(th)]?.probability));const y=scored.map(x=>x.observed_total_mm>=th?1:0),p=scored.map(x=>x.probabilities[String(th)].probability);const n=p.length;const bins=Array.from({length:10},(_,i)=>({bin:i,lower:i/10,upper:(i+1)/10,count:0,mean_probability:null,observed_frequency:null}));for(let i=0;i<n;i++){const idx=Math.min(9,Math.floor(p[i]*10));bins[idx].count++;bins[idx]._p=(bins[idx]._p||0)+p[i];bins[idx]._y=(bins[idx]._y||0)+y[i];}for(const bin of bins){if(bin.count){bin.mean_probability=Number((bin._p/bin.count).toFixed(4));bin.observed_frequency=Number((bin._y/bin.count).toFixed(4));}delete bin._p;delete bin._y;}brier[String(th)]={threshold_mm:th,sample_count:n,brier_score:n?Number((p.reduce((s,x,i)=>s+(x-y[i])**2,0)/n).toFixed(5)):null,mean_probability:n?Number((p.reduce((a,b)=>a+b,0)/n).toFixed(4)):null,observed_event_rate:n?Number((y.reduce((a,b)=>a+b,0)/n).toFixed(4)):null,reliability_bins:bins};}
   groups.push({type,model,lead_bin:leadBinName,sample_count:items.length,status:items.length>=minimumSamples?"preliminary_regional_proxy":"insufficient_sample",thresholds:brier});
  }
 }
 return {report_schema_version:"1.0.0",pair_count:pairs.length,group_count:groups.length,verification_source:"regional_proxy",station_id:"WMO-40872",station_distance_from_abadan_km:31.7,direct_abadan_ground_truth:false,calibration_approved:false,forecast_skill_validated:false,minimum_samples_for_preliminary_metrics:minimumSamples,groups,notes:["Forecast issue time is archive retrieval time; authoritative model initialization time is not exposed by provider.","Observed windows are exact rolling 24-hour intervals from the Bandar-e-Dayyer SYNOP station, not local Abadan gauge measurements.","No probability calibration or operational policy approval is inferred from these regional-proxy scores."]};
}