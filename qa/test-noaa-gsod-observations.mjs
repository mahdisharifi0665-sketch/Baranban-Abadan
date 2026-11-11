import assert from "node:assert/strict";
import {parseNoaaGsodCsv,summarizeNoaaGsodObservations} from "../src/noaa-gsod-observations.mjs";
const csv=[
 "STATION,DATE,LATITUDE,LONGITUDE,ELEVATION,NAME,TEMP,TEMP_ATTRIBUTES,PRCP,PRCP_ATTRIBUTES,FRSHTT",
 '40872099999,2025-01-08,27.8333,51.9333,4.0,"BANDAR-E-DAYYER, IR",68.0,24,0.06,G,000000',
 "40872099999,2025-01-09,27.8333,51.9333,4.0,BANDAR-E-DAYYER,69.0,24,99.99,I,000000",
 "40872099999,2025-01-10,27.8333,51.9333,4.0,BANDAR-E-DAYYER,70.0,24,0.00,H,010000",
 "40872099999,2025-01-11,27.8333,51.9333,4.0,BANDAR-E-DAYYER,70.0,24,0.20,A,000000",
 "40872099999,2025-01-12,27.8333,51.9333,4.0,BANDAR-E-DAYYER,70.0,24,0.10,,000000"
].join("\n");
const records=parseNoaaGsodCsv(csv,{expectedStationId:"40872099999",retrievedAtUtc:"2026-11-11T12:00:00Z"});
assert.equal(records.length,5);
assert.equal(records[0].value_mm,1.524);
assert.equal(records[0].quality_status,"raw");
assert.equal(records[0].source.measurement_period_hours,24);
assert.equal(records[0].time_window_basis,"nominal_utc_daily_label");
assert.equal(records[1].value_mm,null);
assert.equal(records[1].quality_status,"missing");
assert.equal(records[2].quality_status,"suspect");
assert.equal(records[3].source.measurement_period_hours,6);
assert.equal(records[3].quality_status,"suspect");
assert.equal(records[4].quality_status,"suspect");
assert.equal(records[0].station.station_id,"WMO-40872");
assert.equal(records[0].station.distance_from_abadan_km,31.7);
assert.ok(records.every(x=>x.station.latitude!==28.0794||x.station.longitude!==51.7694));
assert.deepEqual(summarizeNoaaGsodObservations(records),{record_count:5,numeric_precipitation_count:4,missing_count:1,raw_24h_count:1,suspect_count:3,accepted_count:0,last_record_date:"2025-01-12"});
assert.throws(()=>parseNoaaGsodCsv(csv,{expectedStationId:"40858099999"}),/unexpected_gsod_station/);
assert.throws(()=>parseNoaaGsodCsv(csv.replace("27.8333","97.8333"),{expectedStationId:"40872099999"}),/invalid_gsod_coordinates/);
assert.throws(()=>parseNoaaGsodCsv(csv.replace("0.06,G","-0.06,G"),{expectedStationId:"40872099999"}),/invalid_gsod_precipitation/);
console.log("PASS: NOAA GSOD CSV parsing, station identity, units, missing/incomplete flags, and conservative 24-hour classification.");