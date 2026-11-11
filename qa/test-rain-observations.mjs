import assert from "node:assert/strict";
import {validateRainObservation,auditRainObservationSeries} from "../src/rain-observations.mjs";
const base={
 schema_version:"1.0.0",observation_id:"ABDAN-20261111-001",
 station:{station_id:"ABDAN-TEST-01",name:"Abdan test gauge",latitude:28.0801523,longitude:51.77113355,elevation_m:null,timezone:"Asia/Tehran",distance_from_abadan_km:0},
 source:{provider:"user-supplied test fixture",source_type:"personal_gauge",source_reference:null,instrument:"manual gauge"},
 observed_start_utc:"2026-11-11T00:00:00Z",observed_end_utc:"2026-11-11T01:00:00Z",retrieved_at_utc:"2026-11-11T01:05:00Z",
 value_mm:2.4,measurement_kind:"interval_total",quality_status:"raw",quality_flags:[]
};
assert.equal(validateRainObservation(base).valid,true);
for (const timestamp of ["2026-02-30T00:00:00Z","2026-04-31T00:00:00Z","2026-11-11T24:00:00Z","2026-11-11T12:60:00Z","2026-11-11T12:00:00+25:00"]) {
 assert.ok(validateRainObservation({...base,observed_start_utc:timestamp}).errors.includes("invalid_observed_start_utc"), `reject invalid timestamp ${timestamp}`);
}
assert.ok(validateRainObservation({...base,value_mm:-0.1}).errors.includes("invalid_rain_value"));
assert.ok(validateRainObservation({...base,station:{...base.station,latitude:95}}).errors.includes("invalid_latitude"));
assert.ok(validateRainObservation({...base,observed_end_utc:base.observed_start_utc}).errors.includes("non_positive_observation_interval"));
assert.ok(validateRainObservation({...base,observed_start_utc:"2026-11-11T00:00:00"}).errors.includes("invalid_observed_start_utc"));
assert.ok(validateRainObservation({...base,quality_status:"missing",value_mm:0}).errors.includes("missing_observation_must_have_null_value"));
const duplicate=auditRainObservationSeries([base,base]);
assert.ok(duplicate.findings.some(x=>x.code==="duplicate_interval"));
const overlap=auditRainObservationSeries([base,{...base,observation_id:"002",observed_start_utc:"2026-11-11T00:30:00Z",observed_end_utc:"2026-11-11T01:30:00Z"}]);
assert.ok(overlap.findings.some(x=>x.code==="overlapping_intervals"));
const gap=auditRainObservationSeries([base,{...base,observation_id:"003",observed_start_utc:"2026-11-11T03:00:00Z",observed_end_utc:"2026-11-11T04:00:00Z"}],{expectedIntervalSeconds:3600});
assert.ok(gap.findings.some(x=>x.code==="time_gap"));
const counter={...base,measurement_kind:"cumulative_counter",counter_reset:false,value_mm:10};
const reset={...counter,observation_id:"004",observed_start_utc:"2026-11-11T01:00:00Z",observed_end_utc:"2026-11-11T02:00:00Z",value_mm:1};
assert.ok(auditRainObservationSeries([counter,reset]).findings.some(x=>x.code==="unflagged_counter_reset"));
assert.equal(auditRainObservationSeries([{...counter},{...reset,counter_reset:true}]).findings.some(x=>x.code==="unflagged_counter_reset"),false);
const otherStation={...base,observation_id:"OTHER-001",station:{...base.station,station_id:"OTHER-STATION"}};
assert.equal(auditRainObservationSeries([base,otherStation]).findings.some(x=>["overlapping_intervals","duplicate_interval"].includes(x.code)),false);
assert.ok(validateRainObservation({...base,time_window_basis:"invalid"}).errors.includes("invalid_time_window_basis"));
console.log("PASS: rain observation contract, time-window metadata, per-station duplicate/overlap/gap and counter-reset QA.");
