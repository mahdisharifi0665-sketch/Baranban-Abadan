import assert from "node:assert/strict";
import {parseOgimetSynopCsv,aggregateComplete24h,summarizeOgimetSynop} from "../src/ogimet-synop-observations.mjs";
const csv=[
 "WMOIND,YEAR,MONTH,DAY,HOUR,MIN,REPORT",
 "40872,2026,11,10,18,00,AAXX 10181 40872 12960 02101 10347 20267 30013 40017 57008 60051==",
 "40872,2026,11,11,00,00,AAXX 11001 40872 12960 02101 10347 20267 30013 40017 57008 60021==",
 "40872,2026,11,11,06,00,AAXX 11061 40872 12960 02101 10347 20267 30013 40017 57008 60011==",
 "40872,2026,11,11,12,00,AAXX 11121 40872 12960 02101 10347 20267 30013 40017 57008 60031==",
 "40872,2026,11,11,18,00,AAXX 11181 40872 12960 02101 10347 20267 30013 40017 57008 6///4==",
 "40872,2026,11,11,21,00,AAXX 11211 40872 12960 02101 10347 20267 30013 40017 57008 69904=="
].join("\n");
const result=parseOgimetSynopCsv(csv,{retrievedAtUtc:"2026-11-11T22:00:00Z"});
assert.equal(result.reports.length,6);
assert.equal(result.observations.length,6);
assert.equal(result.observations[0].value_mm,5);
assert.equal(result.observations[0].source.measurement_period_hours,6);
assert.equal(result.observations[3].source.measurement_period_hours,6);
assert.equal(result.observations[4].value_mm,null);
assert.equal(result.observations[4].quality_status,"missing");
assert.equal(result.observations[5].value_mm,0);
assert.equal(result.observations[5].quality_status,"suspect");
const aggregate=aggregateComplete24h(result.observations,"2026-11-11T12:00:00Z");
assert.equal(aggregate.total_mm,11);
assert.equal(aggregate.coverage_hours,24);
assert.equal(aggregate.method,"exact_non_overlapping_synop_interval_sum");
assert.equal(aggregate.evidence_status,"raw_measured_intervals");
assert.equal(aggregate.observation_ids.length,4);
assert.equal(aggregateComplete24h(result.observations,"2026-11-11T18:00:00Z"),null);
assert.equal(summarizeOgimetSynop(result).raw_6h_count,4);
assert.equal(summarizeOgimetSynop(result).missing_count,1);
const zeroCsv="40872,2026,11,11,06,00,AAXX 11061 40872 32960 02101 10347 20267 30013 40017 57008==";
const zeroResult=parseOgimetSynopCsv(zeroCsv,{retrievedAtUtc:"2026-11-11T22:00:00Z"});
assert.equal(zeroResult.observations.length,1);
assert.equal(zeroResult.observations[0].value_mm,0);
assert.equal(zeroResult.observations[0].quality_status,"suspect");
assert.ok(zeroResult.observations[0].quality_flags.includes("synop_iR_3_no_precipitation"));
const inferredWindow=aggregateComplete24h([...result.observations.slice(0,2),zeroResult.observations[0],...result.observations.slice(2,4)],"2026-11-11T12:00:00Z",{allowInferredZero:true});
assert.ok(inferredWindow);
assert.equal(inferredWindow.evidence_status,"suspect_inferred_zero");
assert.throws(()=>parseOgimetSynopCsv("bad csv"),/ogimet_synop_csv_columns_invalid/);
assert.equal(parseOgimetSynopCsv(csv,{expectedStationId:"40858"}).observations.length,0);
console.log("PASS: OGIMET SYNOP decoding, WMO precipitation codes, exact tR intervals, and complete non-overlapping 24h aggregation.");