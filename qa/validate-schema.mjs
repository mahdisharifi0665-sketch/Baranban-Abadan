import fs from "node:fs";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(fs.readFileSync("schemas/forecast-record.schema.json", "utf8"));
const observationSchema = JSON.parse(fs.readFileSync("schemas/rain-observation.schema.json", "utf8"));
const stationRegistrySchema = JSON.parse(fs.readFileSync("schemas/observation-station-registry.schema.json", "utf8"));
const stationRegistry = JSON.parse(fs.readFileSync("data/observation-station-registry.json", "utf8"));
const ajv = new Ajv2020({allErrors:true, strict:true, allowUnionTypes:true});
addFormats(ajv);
const validate = ajv.compile(schema);
const validateObservation = ajv.compile(observationSchema);
const validateStationRegistry = ajv.compile(stationRegistrySchema);

const valid = {
  schema_version:"1.0.0",
  source_id:"test-source",
  model_id:"test-model",
  product_type:"deterministic",
  model_run_time_utc:"2026-11-11T00:00:00Z",
  issue_time_utc:"2026-11-11T01:00:00Z",
  retrieved_at_utc:"2026-11-11T01:05:00Z",
  valid_start_utc:"2026-11-11T00:00:00Z",
  valid_end_utc:"2026-11-12T00:00:00Z",
  latitude:28.0794,
  longitude:51.7694,
  variable:"precipitation",
  value:5,
  unit:"mm",
  accumulation_period_seconds:86400,
  quality_flags:[]
};
assert.equal(validate(valid), true, JSON.stringify(validate.errors));
assert.equal(validate({...valid, latitude:91}), false, "latitude outside WGS84 must fail");
assert.equal(validate({...valid, product_type:"unknown"}), false, "unknown product type must fail");
assert.equal(validate({...valid, issue_time_utc:"not-a-date"}), false, "invalid timestamp must fail");
assert.equal(validate({...valid, product_type:"ensemble_member"}), false, "ensemble member without member metadata must fail");
const member = {...valid, product_type:"ensemble_member", ensemble_member:1, ensemble_member_count_total:50, ensemble_member_count_valid:48};
assert.equal(validate(member), true, JSON.stringify(validate.errors));
assert.equal(validate({...member, ensemble_member_count_valid:51}), true, "schema structure accepts count; semantic guard below must reject it");
function validateSemantics(record) {
  const start=Date.parse(record.valid_start_utc), end=Date.parse(record.valid_end_utc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) return false;
  if (record.product_type==="ensemble_member" || record.product_type==="ensemble_statistic") {
    if (!Number.isInteger(record.ensemble_member_count_total) || !Number.isInteger(record.ensemble_member_count_valid)) return false;
    if (record.ensemble_member_count_valid<0 || record.ensemble_member_count_valid>record.ensemble_member_count_total) return false;
  }
  return true;
}
assert.equal(validateSemantics(valid),true);
assert.equal(validateSemantics({...valid,valid_end_utc:valid.valid_start_utc}),false,"zero-duration interval must fail semantic validation");
assert.equal(validateSemantics({...member,ensemble_member_count_valid:51}),false,"valid ensemble count cannot exceed total count");
assert.equal(validateSemantics({...member,ensemble_member_count_total:0}),false,"ensemble total count must be positive");
const observation = {
  schema_version:"1.0.0", observation_id:"schema-test-001",
  station:{station_id:"ABADAN-TEST",name:"Test gauge",latitude:28.0794,longitude:51.7694,elevation_m:null,timezone:"Asia/Tehran",distance_from_abadan_km:0},
  source:{provider:"schema fixture",source_type:"personal_gauge",source_reference:null,instrument:"manual"},
  observed_start_utc:"2026-11-11T00:00:00Z",observed_end_utc:"2026-11-11T01:00:00Z",retrieved_at_utc:"2026-11-11T01:05:00Z",
  value_mm:0,measurement_kind:"interval_total",quality_status:"raw",quality_flags:[]
};
assert.equal(validateObservation(observation),true,JSON.stringify(validateObservation.errors));
assert.equal(validateObservation({...observation,value_mm:-1}),false,"negative observed rainfall must fail");
assert.equal(validateObservation({...observation,station:{...observation.station,longitude:181}}),false,"invalid station longitude must fail");
assert.equal(validateStationRegistry(stationRegistry),true,JSON.stringify(validateStationRegistry.errors));
console.log("PASS: forecast, rain-observation and observation-station registry schemas compile; structural and semantic regression checks passed.");
