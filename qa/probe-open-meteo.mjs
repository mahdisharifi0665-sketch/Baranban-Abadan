import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {createForecastArchiveDocument} from "../src/forecast-archive.mjs";
import {createHash} from "node:crypto";
import {aggregatePrecipitation,ensembleExceedance,ensembleDailyExceedance,createEnsembleCoveragePolicy} from "../src/precipitation-core.mjs";
import {buildHourlyPrecipitationIntervals,calendarDayWindow,utcHourlyForecastWindow} from "../src/open-meteo-time-adapter.mjs";

const LAT = 28.0801523;
const LON = 51.77113355;
const TIMEZONE = "Asia/Tehran";
const DAYS = 10;
const TIMEOUT_MS = 45000;

function addDays(date, days) {
  const [y,m,d]=date.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
function localDateNow(timeZone) {
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
}
const firstForecastDate=addDays(localDateNow(TIMEZONE),1);
const requestedWindow={startHour:firstForecastDate+"T01:00",endHour:addDays(firstForecastDate,10)+"T00:00",expectedHours:240};

async function getJson(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url.hostname}: ${body.slice(0,500)}`);
  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`Invalid JSON from ${url.hostname}`); }
  if (json.error) throw new Error(json.reason || "API returned error");
  Object.defineProperty(json, "__payloadHash", {value:createHash("sha256").update(body).digest("hex"), enumerable:false});
  Object.defineProperty(json, "__rawPayload", {value:body, enumerable:false});
  return json;
}

const verificationWindow=utcHourlyForecastWindow(Date.now(),240);
async function getUtcVerificationPayload(base,model){
 const json=await getJson(base,{latitude:String(LAT),longitude:String(LON),hourly:"precipitation",start_hour:verificationWindow.startHour,end_hour:verificationWindow.endHour,timezone:"UTC",models:model,cell_selection:"land"});
 const check=inspectHourly(json,"precipitation");
 assert.ok(check.monotonicHourly,model+" UTC verification timestamps are not contiguous");
 assert.ok(check.arraysAligned,model+" UTC verification precipitation arrays are not aligned");
 assert.equal(check.first,verificationWindow.startHour,model+" UTC verification start mismatch");
 assert.equal(check.last,verificationWindow.endHour,model+" UTC verification end mismatch");
 return {rawPayload:json.__rawPayload,payloadSha256:json.__payloadHash,timezone:"UTC",window:verificationWindow};
}
function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2-lat1), dLon = rad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return Number((6371 * 2 * Math.asin(Math.sqrt(a))).toFixed(2));
}

function inspectHourly(json, variable) {
  const hourly = json.hourly || {};
  const times = hourly.time || [];
  const keys = Object.keys(hourly).filter(k => k === variable || k.startsWith(variable + "_"));
  const timeMs = times.map(t => Date.parse(t));
  const monotonicHourly = timeMs.every((v,i)=>Number.isFinite(v) && (i===0 || v-timeMs[i-1]===3600000));
  const arraysAligned = keys.every(k=>Array.isArray(hourly[k]) && hourly[k].length===times.length);
  const validPerField=keys.map(k=>(hourly[k] || []).filter(v=>v !== null && Number.isFinite(v)).length);
  const nonNull=validPerField.reduce((a,b)=>a+b,0);
  const expected=keys.reduce((n,k)=>n+(hourly[k] || []).length,0);
  const negativeSamples=keys.flatMap(k=>(hourly[k]||[]).map((v,i)=>({field:k,time:times[i],value:v})).filter(x=>Number.isFinite(x.value)&&x.value<0)).slice(0,20);
  const validMembersPerTime=times.map((_,i)=>keys.reduce((n,k)=>n+(Number.isFinite(hourly[k]?.[i])?1:0),0));
  const firstKey=keys[0];
  const missingExamples=firstKey ? times.filter((_,i)=>!Number.isFinite(hourly[firstKey]?.[i])).slice(0,12) : [];
  return {
    hours:times.length, first:times[0] ?? null, last:times.at(-1) ?? null,
    requestedStart:requestedWindow.startHour, requestedEnd:requestedWindow.endHour,
    matchesRequestedBounds:times[0]===requestedWindow.startHour && times.at(-1)===requestedWindow.endHour,
    monotonicHourly, arraysAligned, variableFields:keys.length,
    validValues:nonNull, totalValues:expected, coverage:expected ? Number((nonNull/expected).toFixed(4)) : 0,
    perMemberValidHours:validPerField.length ? {min:Math.min(...validPerField),max:Math.max(...validPerField),fullCoverage:validPerField.filter(n=>n===times.length).length} : null,
    validMembersPerHour:keys.length ? {min:Math.min(...validMembersPerTime),max:Math.max(...validMembersPerTime)} : null,
    negativeValueCount:keys.reduce((n,k)=>n+(hourly[k]||[]).filter(v=>Number.isFinite(v)&&v<0).length,0),
    negativeValueExamples:negativeSamples,
    firstMemberMissingHourExamples:missingExamples
  };
}

async function deterministic(model) {
  const json = await getJson("https://api.open-meteo.com/v1/forecast", {
    latitude:String(LAT), longitude:String(LON),
    hourly:"precipitation,cape,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl", daily:"precipitation_sum",
    start_hour:requestedWindow.startHour, end_hour:requestedWindow.endHour, start_date:firstForecastDate, end_date:addDays(firstForecastDate,DAYS-1), timezone:TIMEZONE, models:model, cell_selection:"land"
  });
  const verification=await getUtcVerificationPayload("https://api.open-meteo.com/v1/forecast",model);
  assert.ok(Array.isArray(json.hourly?.time) && json.hourly.time.length > 0, model + " missing hourly time");
  assert.ok(Number.isFinite(json.latitude) && Number.isFinite(json.longitude), model + " missing resolved coordinates");
  assert.ok(json.hourly_units?.precipitation, model + " missing precipitation unit");
  assert.equal(json.daily?.time?.length,DAYS,model+" daily API date range mismatch");
  assert.equal(json.daily?.precipitation_sum?.length,DAYS,model+" daily precipitation array length mismatch");
  const precipCheck=inspectHourly(json,"precipitation");
  assert.ok(precipCheck.monotonicHourly, model + " hourly timestamps are not unique contiguous hourly steps");
  assert.ok(precipCheck.arraysAligned, model + " precipitation arrays are not aligned with timestamps");

  const intervals=buildHourlyPrecipitationIntervals(json.hourly.time,json.hourly.precipitation,json.hourly_units.precipitation,TIMEZONE);
  const dailyTotals=Array.from({length:DAYS},(_,i)=>{
    const date=addDays(firstForecastDate,i), win=calendarDayWindow(date,TIMEZONE);
    const result=aggregatePrecipitation(intervals,win);
    const invalidSamples=intervals.filter(x=>Date.parse(x.start)<Date.parse(win.end)&&Date.parse(x.end)>Date.parse(win.start)&&(!Number.isFinite(x.value)||x.value<0)).slice(0,5);
    return {date,totalMm:result.ok?result.totalMm:null,reason:result.ok?null:result.reason,invalidSamples};
  });
  const dailyApi={dates:json.daily?.time||[],values:json.daily?.precipitation_sum||[],unit:json.daily_units?.precipitation_sum||null};
  const dailyComparison=dailyTotals.map((day,i)=>{
    const dailyValue=dailyApi.values[i];
    const hourlyValue=day.totalMm;
    const comparable=Number.isFinite(dailyValue)&&dailyValue>=0&&Number.isFinite(hourlyValue);
    const difference=comparable?Number(Math.abs(dailyValue-hourlyValue).toFixed(6)):null;
    return {date:day.date,dailyApiMm:Number.isFinite(dailyValue)?dailyValue:null,hourlyAggregateMm:hourlyValue,absoluteDifferenceMm:difference,match:comparable?difference<=0.1:null};
  });
  return {model, retrievedAtUtc:new Date().toISOString(), modelRunTimeStatus:"not_exposed_by_endpoint", resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,timezone:json.timezone,distanceFromTargetKm:distanceKm(LAT,LON,json.latitude,json.longitude)}, payloadSha256:json.__payloadHash, rawPayload:json.__rawPayload, verificationRawPayload:verification.rawPayload, verificationPayloadSha256:verification.payloadSha256, verificationTimezone:verification.timezone, verificationWindow:verification.window, precipitation:precipCheck, dailyAggregation:{completeDays:dailyTotals.filter(x=>x.totalMm!==null).length,days:dailyTotals}, dailyApi, dailyComparison:{comparableDays:dailyComparison.filter(x=>x.match!==null).length,mismatches:dailyComparison.filter(x=>x.match===false),days:dailyComparison}, cape:inspectHourly(json,"cape"), requestedWindow};
}

async function ensemble(model) {
  const json = await getJson("https://ensemble-api.open-meteo.com/v1/ensemble", {
    latitude:String(LAT), longitude:String(LON),
    hourly:"precipitation,cape", daily:"precipitation_sum",
    start_hour:requestedWindow.startHour, end_hour:requestedWindow.endHour, start_date:firstForecastDate, end_date:addDays(firstForecastDate,DAYS-1), timezone:TIMEZONE,
    models:model, cell_selection:"land"
  });
  const verification=await getUtcVerificationPayload("https://ensemble-api.open-meteo.com/v1/ensemble",model);
  assert.ok(Array.isArray(json.hourly?.time) && json.hourly.time.length > 0, model + " missing hourly time");
  assert.ok(Number.isFinite(json.latitude) && Number.isFinite(json.longitude), model + " missing resolved coordinates");
  const precipitation = inspectHourly(json,"precipitation");
  assert.ok(precipitation.variableFields > 0, model + " returned no precipitation member fields");
  const precipitationKeys=Object.keys(json.hourly).filter(k=>k==="precipitation" || k.startsWith("precipitation_"));
  const memberSeries=precipitationKeys.map(key=>({id:key,intervals:buildHourlyPrecipitationIntervals(json.hourly.time,json.hourly[key],json.hourly_units?.precipitation || "mm",TIMEZONE)}));
  const dailyKeys=Object.keys(json.daily||{}).filter(k=>k==="precipitation_sum" || k.startsWith("precipitation_sum_"));
  const dailyValuesByMember=dailyKeys.map(key=>({id:key,values:json.daily[key]}));
  const dailyApiDates=json.daily?.time||[];
  assert.equal(dailyApiDates.length,DAYS,model+" daily API date range mismatch");
  assert.equal(dailyKeys.length,precipitation.variableFields,model+" daily and hourly ensemble member field counts differ");
  assert.ok(dailyValuesByMember.every(m=>Array.isArray(m.values)&&m.values.length===DAYS),model+" daily member arrays are not aligned with dates");
  const hourlyDailyComparisons=dailyApiDates.map((date,i)=>{
    const win=calendarDayWindow(date,TIMEZONE);
    const differences=[];
    for (const member of memberSeries) {
      const dailyKey=member.id==="precipitation"?"precipitation_sum":member.id.replace(/^precipitation/,"precipitation_sum");
      const dailyValue=json.daily?.[dailyKey]?.[i];
      const hourlyResult=aggregatePrecipitation(member.intervals,win);
      if (hourlyResult.ok && Number.isFinite(dailyValue) && dailyValue>=0) differences.push({member:member.id,difference:Math.abs(dailyValue-hourlyResult.totalMm)});
    }
    const mismatches=differences.filter(x=>x.difference>0.1);
    return {date,comparableMembers:differences.length,mismatchCount:mismatches.length,maxAbsDifferenceMm:differences.length?Number(Math.max(...differences.map(x=>x.difference)).toFixed(6)):null,mismatchExamples:mismatches.slice(0,5)};
  });
  const dailyEnsemble= dailyApiDates.map((date,i)=>{
    const vals=dailyValuesByMember.map(m=>m.values?.[i]);
    const valid=vals.filter(v=>Number.isFinite(v)&&v>=0);
    const negativeDailyValues=vals.filter(v=>Number.isFinite(v)&&v<0).length;
    const total=dailyValuesByMember.length;
    const strictPolicy=createEnsembleCoveragePolicy(total,"strict-100-v1");
    const candidate90Policy=createEnsembleCoveragePolicy(total,"candidate-90-v1");
    const probabilitiesStrict=Object.fromEntries([5,10,25].map(th=>[String(th),ensembleDailyExceedance(vals,th,strictPolicy).probability]));
    const probabilities90=Object.fromEntries([5,10,25].map(th=>[String(th),ensembleDailyExceedance(vals,th,candidate90Policy).probability]));
    return {date,validMembers:valid.length,totalMembers:total,negativeDailyValues,probabilitiesAllMembersComplete:probabilitiesStrict,probabilitiesAt90PercentCoverageCandidate:probabilities90,coveragePolicy:{id:candidate90Policy.policyId,status:candidate90Policy.policyStatus,minimumCoverage:candidate90Policy.minMemberCoverage,requiredMembers:candidate90Policy.minValidMembers,coverageFraction:valid.length/total,approvedForOperationalUse:false,calibrated:false}};
  });
  const dailyAggregation=Array.from({length:DAYS},(_,i)=>{
    const date=addDays(firstForecastDate,i), win=calendarDayWindow(date,TIMEZONE);
    const perMember=memberSeries.map(m=>({id:m.id,...aggregatePrecipitation(m.intervals,win)}));
    const validMembers=perMember.filter(x=>x.ok).length;
    const reasonCounts={};
    for (const item of perMember) if (!item.ok) reasonCounts[item.reason]=(reasonCounts[item.reason]||0)+1;
    const firstFailure=perMember.find(x=>!x.ok) || null;
    const firstFailureIntervals=firstFailure ? memberSeries.find(m=>m.id===firstFailure.id)?.intervals : [];
    const invalidSamples=(firstFailureIntervals||[]).filter(x=>Date.parse(x.start)<Date.parse(win.end)&&Date.parse(x.end)>Date.parse(win.start)&&(!Number.isFinite(x.value)||x.value<0)).slice(0,5);
    const policy=createEnsembleCoveragePolicy(memberSeries.length,"strict-100-v1");
    const probabilities=Object.fromEntries([5,10,25].map(threshold=>[String(threshold),ensembleExceedance(memberSeries,win,threshold,policy).probability]));
    return {date,validMembers,totalMembers:memberSeries.length,reasonCounts,firstFailure:firstFailure?{id:firstFailure.id,reason:firstFailure.reason,invalidSamples}:null,probabilityAllMembersComplete:probabilities};
  });
  assert.ok(precipitation.monotonicHourly, model + " hourly timestamps are not unique contiguous hourly steps");
  assert.ok(precipitation.arraysAligned, model + " ensemble precipitation arrays are not aligned with timestamps");
  return {model, retrievedAtUtc:new Date().toISOString(), modelRunTimeStatus:"not_exposed_by_endpoint", requestedWindow, resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,timezone:json.timezone,distanceFromTargetKm:distanceKm(LAT,LON,json.latitude,json.longitude)}, payloadSha256:json.__payloadHash, rawPayload:json.__rawPayload, verificationRawPayload:verification.rawPayload, verificationPayloadSha256:verification.payloadSha256, verificationTimezone:verification.timezone, verificationWindow:verification.window, precipitation, dailyAggregation:{completeDays:dailyAggregation.filter(x=>x.validMembers===x.totalMembers).length,days:dailyAggregation,probabilityPolicy:{strict:"strict-100-v1",candidate:"candidate-90-v1",candidateStatus:"uncalibrated-diagnostic-only",approvedForOperationalUse:false}}, dailyApi:{dates:dailyApiDates,memberFields:dailyKeys,memberCount:dailyKeys.length,unit:json.daily_units?.precipitation_sum||null,days:dailyEnsemble}, hourlyVsDaily:{days:hourlyDailyComparisons,comparableMemberDays:hourlyDailyComparisons.reduce((n,x)=>n+x.comparableMembers,0),mismatchCount:hourlyDailyComparisons.reduce((n,x)=>n+x.mismatchCount,0)}, cape:inspectHourly(json,"cape")};
}

const results = [];
const failures = [];
for (const model of ["ecmwf_ifs","ncep_gfs_global","icon_global"]) {
  try { results.push({type:"deterministic",...await deterministic(model)}); }
  catch (e) { failures.push({type:"deterministic",model,error:String(e)}); }
}
for (const model of ["ecmwf_ifs025_ensemble","ncep_gefs025","dwd_icon_global_eps"]) {
  try { results.push({type:"ensemble",...await ensemble(model)}); }
  catch (e) { failures.push({type:"ensemble",model,error:String(e)}); }
}
const generatedAtUtc=new Date().toISOString();
const target={latitude:LAT,longitude:LON,timezone:TIMEZONE,requestedCalendarDays:DAYS};
assert.equal(failures.length,0,"One or more Open-Meteo model probes failed");
const archive=createForecastArchiveDocument({generatedAtUtc,target,results,failures});
const archiveDirectory="artifacts/forecast-archive";
await mkdir(archiveDirectory,{recursive:true});
const archivePath=archiveDirectory+"/"+archive.archive_id+".json";
await writeFile(archivePath,JSON.stringify(archive,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({archivePath,archiveId:archive.archive_id,generatedAtUtc,productCount:archive.product_count,failureCount:archive.failure_count,target,products:results.map(x=>({type:x.type,model:x.model,payloadSha256:x.payloadSha256,retrievedAtUtc:x.retrievedAtUtc})),failures},null,2));
