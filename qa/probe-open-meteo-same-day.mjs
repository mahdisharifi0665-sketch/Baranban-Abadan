import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";

const LAT=28.0801523, LON=51.77113355, TIMEZONE="Asia/Tehran";
const TIMEOUT_MS=45000;
function localParts(epochMs){
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(epochMs)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
}
function nextLocalDate(date){
  const [y,m,d]=date.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);
}
const now=new Date(), nowParts=localParts(now.getTime());
const today=`${nowParts.year}-${nowParts.month}-${nowParts.day}`;
const tomorrow=nextLocalDate(today);
const nextHourParts=localParts(now.getTime()+60*60*1000);
const startHour=`${nextHourParts.year}-${nextHourParts.month}-${nextHourParts.day}T${nextHourParts.hour}:00`;
const endHour=tomorrow+"T00:00";
const startDate=today, endDate=tomorrow;

async function fetchModel(model){
  const url=new URL("https://api.open-meteo.com/v1/forecast");
  for(const [k,v] of Object.entries({
    latitude:String(LAT),longitude:String(LON),hourly:"precipitation",
    start_date:startDate,end_date:endDate,start_hour:startHour,end_hour:endHour,
    timezone:TIMEZONE,models:model,cell_selection:"land"
  })) url.searchParams.set(k,v);
  const response=await fetch(url,{signal:AbortSignal.timeout(TIMEOUT_MS)});
  const body=await response.text();
  if(!response.ok) throw new Error(`${model}: HTTP ${response.status}: ${body.slice(0,300)}`);
  const json=JSON.parse(body);
  if(json.error) throw new Error(`${model}: ${json.reason||"provider_error"}`);
  const times=json.hourly?.time||[], values=json.hourly?.precipitation||[];
  assert.ok(times.length>0,`${model}: no hourly forecast`);
  assert.equal(values.length,times.length,`${model}: time/value length mismatch`);
  for(let i=0;i<times.length;i++){
    assert.ok(Number.isFinite(Date.parse(times[i])),`${model}: invalid timestamp`);
    if(i) assert.equal(Date.parse(times[i])-Date.parse(times[i-1]),3600000,`${model}: non-contiguous hourly timestamps`);
  }
  assert.equal(times[0],startHour,`${model}: requested same-day start not covered`);
  assert.equal(times.at(-1),endHour,`${model}: requested end-of-day not covered`);
  return {model,retrievedAtUtc:new Date().toISOString(),resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,distanceFromTargetKm:Number((6371*2*Math.asin(Math.sqrt(Math.sin((json.latitude-LAT)*Math.PI/360)**2+Math.cos(LAT*Math.PI/180)*Math.cos(json.latitude*Math.PI/180)*Math.sin((json.longitude-LON)*Math.PI/360)**2))).toFixed(2))},unit:json.hourly_units?.precipitation||null,times,precipitationMm:values,validHours:values.filter(v=>Number.isFinite(v)&&v>=0).length,totalHours:values.length,rawPayload:json};
}
const models=["ecmwf_ifs","ncep_gfs_global","icon_global"];
const results=[],failures=[];
for(const model of models){
  try{results.push(await fetchModel(model));}
  catch(error){failures.push({model,error:String(error)});}
}
assert.ok(results.length>0,"No same-day model forecast was retrieved");
const archive={
  schemaVersion:1,kind:"baranyar-same-day-hourly-forecast",
  generatedAtUtc:new Date().toISOString(),
  target:{name:"Abdan, Dayyer, Bushehr, Iran",latitude:LAT,longitude:LON,radiusKm:5,timezone:TIMEZONE},
  requested:{localDate:today,startHour,endHour,startDate,endDate,
    note:"Hourly precipitation labels represent the preceding hour. The first interval may be partly elapsed at retrieval time; do not treat it as a full future hour."},
  results,failures
};
await mkdir("artifacts/same-day-forecast",{recursive:true});
const path="artifacts/same-day-forecast/same-day-"+Date.now()+".json";
await writeFile(path,JSON.stringify(archive,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({path,localDate:today,startHour,endHour,successfulModels:results.map(x=>({model:x.model,hours:x.totalHours,validHours:x.validHours,distanceKm:x.resolved.distanceFromTargetKm})),failures},null,2));
