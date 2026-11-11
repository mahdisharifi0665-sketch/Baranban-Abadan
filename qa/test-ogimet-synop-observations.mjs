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
const extremeCsv=[
 "40872,2026,11,11,12,00,AAXX 11121 40872 11658 62103 10294 20229 30157 40162 55009 60051 70562 82570 333 82635==",
 "40872,2026,11,11,18,00,AAXX 11181 40872 11658 60001 70562 82570=="
].join("\n");
const extreme=parseOgimetSynopCsv(extremeCsv,{retrievedAtUtc:"2026-11-11T22:00:00Z"});
const high=extreme.observations.find(x=>x.value_mm===210);
assert.ok(high);
assert.equal(high.quality_status,"suspect");
assert.ok(high.quality_flags.includes("suspect_high_accumulation_requires_independent_confirmation"));
assert.equal(aggregateComplete24h(extreme.observations,"2026-11-11T18:00:00Z"),null);
const safeOverlap=aggregateComplete24h([...result.observations.slice(0,4),high],"2026-11-11T12:00:00Z");
assert.equal(safeOverlap.total_mm,11);
assert.equal(safeOverlap.evidence_status,"raw_measured_intervals");
assert.ok(!safeOverlap.observation_ids.includes(high.observation_id));
const repeatedHighAmount=parseOgimetSynopCsv("40872,2026,11,11,03,00,AAXX 11031 40872 42960 66666==",{retrievedAtUtc:"2026-11-11T22:00:00Z"});
assert.equal(repeatedHighAmount.observations[0].value_mm,666);
assert.equal(repeatedHighAmount.observations[0].quality_status,"suspect");
assert.ok(repeatedHighAmount.observations[0].quality_flags.includes("suspect_repeated_high_amount_666"));
assert.ok(repeatedHighAmount.observations[0].quality_flags.includes("synop_ir_indicator_conflicts_with_group6"));
const sectionConflict=parseOgimetSynopCsv("40872,2026,11,11,03,00,AAXX 11031 40872 22960 60051 333 82635==",{retrievedAtUtc:"2026-11-11T22:00:00Z"});
assert.equal(sectionConflict.observations[0].quality_status,"suspect");
assert.ok(sectionConflict.observations[0].quality_flags.includes("synop_ir_section_location_conflict"));
const traceTenth=parseOgimetSynopCsv("40872,2026,11,11,03,00,AAXX 11031 40872 12960 69916==",{retrievedAtUtc:"2026-11-11T22:00:00Z"});
assert.equal(traceTenth.observations[0].value_mm,0.1);
assert.equal(traceTenth.observations[0].quality_status,"raw");
assert.ok(!traceTenth.observations[0].quality_flags.includes("suspect_high_accumulation_requires_independent_confirmation"));
assert.equal(summarizeOgimetSynop(extreme).high_amount_suspect_count,1);
assert.equal(summarizeOgimetSynop(repeatedHighAmount).repeated_666_suspect_count,1);
const censored=parseOgimetSynopCsv("40872,2026,11,11,03,00,AAXX 11031 40872 12960 69891==",{retrievedAtUtc:"2026-11-11T22:00:00Z"});
assert.equal(censored.observations[0].value_mm,989);
assert.equal(censored.observations[0].quality_status,"suspect");
assert.ok(censored.observations[0].quality_flags.includes("synop_989mm_or_more_censored"));
console.log("PASS: OGIMET SYNOP decoding, WMO precipitation codes, exact tR intervals, and complete non-overlapping 24h aggregation.");