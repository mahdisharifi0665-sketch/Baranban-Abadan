import assert from "node:assert/strict";
import {createHash} from "node:crypto";

const LAT = 28.0794;
const LON = 51.7694;
const TIMEZONE = "Asia/Tehran";
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
  return json;
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
  const nonNull = keys.reduce((n,k)=>n+(hourly[k] || []).filter(v=>v !== null && Number.isFinite(v)).length,0);
  const expected = keys.reduce((n,k)=>n+(hourly[k] || []).length,0);
  return {hours:times.length, first:times[0] ?? null, last:times.at(-1) ?? null, requestedStart:requestedWindow.startHour, requestedEnd:requestedWindow.endHour, matchesRequestedBounds:times[0]===requestedWindow.startHour && times.at(-1)===requestedWindow.endHour, monotonicHourly, arraysAligned, variableFields:keys.length, validValues:nonNull, totalValues:expected, coverage:expected ? Number((nonNull/expected).toFixed(4)) : 0};
}

async function deterministic(model) {
  const json = await getJson("https://api.open-meteo.com/v1/forecast", {
    latitude:String(LAT), longitude:String(LON),
    hourly:"precipitation,cape,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl",
    start_hour:requestedWindow.startHour, end_hour:requestedWindow.endHour, timezone:TIMEZONE, models:model, cell_selection:"land"
  });
  assert.ok(Array.isArray(json.hourly?.time) && json.hourly.time.length > 0, model + " missing hourly time");
  assert.ok(Number.isFinite(json.latitude) && Number.isFinite(json.longitude), model + " missing resolved coordinates");
  assert.ok(json.hourly_units?.precipitation, model + " missing precipitation unit");
  const precipCheck=inspectHourly(json,"precipitation");
  assert.ok(precipCheck.monotonicHourly, model + " hourly timestamps are not unique contiguous hourly steps");
  assert.ok(precipCheck.arraysAligned, model + " precipitation arrays are not aligned with timestamps");

  return {model, retrievedAtUtc:new Date().toISOString(), modelRunTimeStatus:"not_exposed_by_endpoint", resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,timezone:json.timezone,distanceFromTargetKm:distanceKm(LAT,LON,json.latitude,json.longitude)}, payloadSha256:json.__payloadHash, precipitation:precipCheck, cape:inspectHourly(json,"cape"), requestedWindow};
}

async function ensemble(model) {
  const json = await getJson("https://ensemble-api.open-meteo.com/v1/ensemble", {
    latitude:String(LAT), longitude:String(LON),
    hourly:"precipitation,cape",
    start_hour:requestedWindow.startHour, end_hour:requestedWindow.endHour, timezone:TIMEZONE,
    models:model, cell_selection:"land"
  });
  assert.ok(Array.isArray(json.hourly?.time) && json.hourly.time.length > 0, model + " missing hourly time");
  assert.ok(Number.isFinite(json.latitude) && Number.isFinite(json.longitude), model + " missing resolved coordinates");
  const precipitation = inspectHourly(json,"precipitation");
  assert.ok(precipitation.variableFields > 0, model + " returned no precipitation member fields");
  assert.ok(precipitation.monotonicHourly, model + " hourly timestamps are not unique contiguous hourly steps");
  assert.ok(precipitation.arraysAligned, model + " ensemble precipitation arrays are not aligned with timestamps");
  return {model, retrievedAtUtc:new Date().toISOString(), modelRunTimeStatus:"not_exposed_by_endpoint", requestedWindow, resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,timezone:json.timezone,distanceFromTargetKm:distanceKm(LAT,LON,json.latitude,json.longitude)}, payloadSha256:json.__payloadHash, precipitation, cape:inspectHourly(json,"cape")};
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
console.log(JSON.stringify({target:{latitude:LAT,longitude:LON,timezone:TIMEZONE,requestedCalendarDays:10},results,failures},null,2));
assert.equal(failures.length,0,"One or more Open-Meteo model probes failed");
