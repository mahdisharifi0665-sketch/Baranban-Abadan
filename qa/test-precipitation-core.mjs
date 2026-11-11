import assert from "node:assert/strict";
import {aggregatePrecipitation, ensembleExceedance} from "../src/precipitation-core.mjs";

const H = 60*60*1000;
const t = h => new Date(Date.parse("2026-11-11T00:00:00Z")+h*H).toISOString();
const window = {start:t(0),end:t(24)};
const series = values => values.map((value,i)=>({start:t(i),end:t(i+1),value,unit:"mm"}));

const sum = aggregatePrecipitation(series(Array(24).fill(0.25)),window);
assert.equal(sum.ok,true);
assert.equal(sum.totalMm,6);
assert.equal(sum.intervalCount,24);

for (const amount of [0,4.9,5,5.1,9.9,10,10.1,24.9,25,25.1]) {
  const result=aggregatePrecipitation(series([amount,...Array(23).fill(0)]),window);
  assert.equal(result.ok,true);
  assert.equal(result.totalMm,amount);
}
const thresholdMembers=[4.9,5,9.9,10,24.9,25,25.1].map((amount,i)=>({id:String(i),intervals:series([amount,...Array(23).fill(0)])}));
const thresholdConfig={minValidMembers:7,minMemberCoverage:1};
assert.equal(ensembleExceedance(thresholdMembers,window,5,thresholdConfig).probability,6/7);
assert.equal(ensembleExceedance(thresholdMembers,window,10,thresholdConfig).probability,4/7);
assert.equal(ensembleExceedance(thresholdMembers,window,25,thresholdConfig).probability,2/7);
assert.equal(aggregatePrecipitation(series(Array(23).fill(0)),window).reason,"incomplete_window");
const gap=series(Array(24).fill(0)); gap[12]={...gap[12],start:t(13),end:t(14)};
assert.equal(aggregatePrecipitation(gap,window).reason,"time_gap");
const overlap=series(Array(24).fill(0)); overlap[12]={...overlap[12],start:t(11),end:t(13)};
assert.equal(aggregatePrecipitation(overlap,window).reason,"overlap_or_duplicate");
const duplicate=series(Array(24).fill(0)); duplicate[12]={...duplicate[11]};
assert.equal(aggregatePrecipitation(duplicate,window).reason,"overlap_or_duplicate");
const missing=series(Array(24).fill(0)); missing[4]={...missing[4],value:null};
assert.equal(aggregatePrecipitation(missing,window).reason,"missing_or_invalid_value");
const negative=series(Array(24).fill(0)); negative[4]={...negative[4],value:-0.1};
assert.equal(aggregatePrecipitation(negative,window).reason,"missing_or_invalid_value");
const wrongUnit=series(Array(24).fill(0)); wrongUnit[4]={...wrongUnit[4],unit:"mm/h"};
assert.equal(aggregatePrecipitation(wrongUnit,window).reason,"unit_mismatch");
assert.equal(aggregatePrecipitation(series(Array(24).fill(0)),{start:t(24),end:t(0)}).reason,"invalid_window");
const localTimeSeries=series(Array(24).fill(0)); localTimeSeries[0]={...localTimeSeries[0],start:"2026-11-11T00:00:00"};
assert.equal(aggregatePrecipitation(localTimeSeries,window).reason,"invalid_timestamp");
assert.equal(aggregatePrecipitation(series(Array(24).fill(0.1)),window).totalMm,2.4);
assert.equal(aggregatePrecipitation(series([4.999999,...Array(23).fill(0)]),window).totalMm,4.999999);

const members=[
 {id:"m1",intervals:series([5,...Array(23).fill(0)])},
 {id:"m2",intervals:series([4.9,...Array(23).fill(0)])},
 {id:"m3",intervals:series([10,...Array(23).fill(0)])},
 {id:"m4",intervals:series([0,...Array(23).fill(0)])}
];
assert.equal(ensembleExceedance(members,window,5).probability,null);
const p=ensembleExceedance(members,window,5,{minValidMembers:4,minMemberCoverage:1});
assert.equal(p.probability,0.5);
assert.equal(p.exceedances,2);
assert.equal(p.validMembers,4);
assert.equal(ensembleExceedance([...members,{id:"bad",intervals:series(Array(23).fill(0))}],window,5,{minValidMembers:5,minMemberCoverage:1}).probability,null);
assert.equal(ensembleExceedance(members,window,5,{minValidMembers:5,minMemberCoverage:0.5}).probability,null);
assert.equal(ensembleExceedance(members,window,-1,{minValidMembers:1,minMemberCoverage:1}).reason,"invalid_threshold");
const incompleteMember={id:"partial",intervals:series(Array(23).fill(0))};
const allPartial=ensembleExceedance([incompleteMember,incompleteMember],window,5,{minValidMembers:1,minMemberCoverage:1});
assert.equal(allPartial.probability,null);
assert.equal(allPartial.reason,"insufficient_valid_members");
console.log("PASS: precipitation core tests (interval coverage, gaps, overlaps, nulls, units, thresholds, ensemble denominator and coverage policy).");
