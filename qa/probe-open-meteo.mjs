import assert from "node:assert/strict";

const LAT = 28.0794;
const LON = 51.7694;
const DAYS = 10;
const TIMEZONE = "Asia/Tehran";
const TIMEOUT_MS = 45000;

async function getJson(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url.hostname}: ${body.slice(0,500)}`);
  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`Invalid JSON from ${url.hostname}`); }
  if (json.error) throw new Error(json.reason || "API returned error");
  return json;
}

function inspectHourly(json, variable) {
  const hourly = json.hourly || {};
  const times = hourly.time || [];
  const keys = Object.keys(hourly).filter(k => k === variable || k.startsWith(variable + "_"));
  const nonNull = keys.reduce((n,k)=>n+(hourly[k] || []).filter(v=>v !== null && Number.isFinite(v)).length,0);
  const expected = keys.reduce((n,k)=>n+(hourly[k] || []).length,0);
  return {hours:times.length, first:times[0] ?? null, last:times.at(-1) ?? null, variableFields:keys.length, validValues:nonNull, totalValues:expected, coverage:expected ? Number((nonNull/expected).toFixed(4)) : 0};
}

async function deterministic(model) {
  const json = await getJson("https://api.open-meteo.com/v1/forecast", {
    latitude:String(LAT), longitude:String(LON),
    hourly:"precipitation,cape,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl",
    daily:"precipitation_sum",
    forecast_days:String(DAYS), timezone:TIMEZONE, models:model, cell_selection:"land"
  });
  assert.ok(Array.isArray(json.hourly?.time) && json.hourly.time.length > 0, model + " missing hourly time");
  assert.ok(Number.isFinite(json.latitude) && Number.isFinite(json.longitude), model + " missing resolved coordinates");
  assert.ok(json.hourly_units?.precipitation, model + " missing precipitation unit");
  return {model, resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,timezone:json.timezone}, precipitation:inspectHourly(json,"precipitation"), cape:inspectHourly(json,"cape"), dailyDays:json.daily?.time?.length ?? 0, dailyPrecipitation:json.daily?.precipitation_sum ?? []};
}

async function ensemble(model) {
  const json = await getJson("https://ensemble-api.open-meteo.com/v1/ensemble", {
    latitude:String(LAT), longitude:String(LON),
    hourly:"precipitation,cape",
    forecast_days:String(DAYS), timezone:TIMEZONE,
    models:model, cell_selection:"land"
  });
  assert.ok(Array.isArray(json.hourly?.time) && json.hourly.time.length > 0, model + " missing hourly time");
  assert.ok(Number.isFinite(json.latitude) && Number.isFinite(json.longitude), model + " missing resolved coordinates");
  const precipitation = inspectHourly(json,"precipitation");
  assert.ok(precipitation.variableFields > 0, model + " returned no precipitation member fields");
  return {model, resolved:{latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,timezone:json.timezone}, precipitation, cape:inspectHourly(json,"cape")};
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
console.log(JSON.stringify({target:{latitude:LAT,longitude:LON,timezone:TIMEZONE,requestedForecastDays:DAYS},results,failures},null,2));
assert.equal(failures.length,0,"One or more Open-Meteo model probes failed");
