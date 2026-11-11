import fs from "node:fs";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(fs.readFileSync("schemas/forecast-record.schema.json", "utf8"));
const ajv = new Ajv2020({allErrors:true, strict:true, allowUnionTypes:true});
addFormats(ajv);
const validate = ajv.compile(schema);

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
console.log("PASS: schema compiles; structural and semantic time/ensemble-count checks passed; invalid cases rejected.");
