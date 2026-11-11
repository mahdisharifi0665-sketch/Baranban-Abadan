import assert from "node:assert/strict";
import {aggregatePrecipitation, ensembleExceedance, ensembleDailyExceedance, createEnsembleCoveragePolicy} from "../src/precipitation-core.mjs";

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
const numericOverflow=series(Array(24).fill(0)); numericOverflow[0]={...numericOverflow[0],value:Number.MAX_VALUE};
assert.equal(aggregatePrecipitation(numericOverflow,window).reason,"numeric_overflow","finite values that overflow fixed-point scaling must be rejected");
assert.equal(ensembleDailyExceedance([Number.MAX_VALUE,5,0],5,{minValidMembers:2,minMemberCoverage:0.5}).validMembers,2,"unsafe daily member totals must not enter the ensemble denominator");
assert.equal(ensembleDailyExceedance([1,2],Number.MAX_VALUE,{minValidMembers:2,minMemberCoverage:1}).reason,"invalid_threshold");
assert.equal(ensembleExceedance([{intervals:numericOverflow}],window,5,{minValidMembers:1,minMemberCoverage:1}).probability,null);

const wrongUnit=series(Array(24).fill(0)); wrongUnit[4]={...wrongUnit[4],unit:"mm/h"};
assert.equal(aggregatePrecipitation(wrongUnit,window).reason,"unit_mismatch");
assert.equal(aggregatePrecipitation(series(Array(24).fill(0)),{start:t(24),end:t(0)}).reason,"invalid_window");
const twoDays=series([...Array(24).fill(0.1),...Array(24).fill(0.2)]);
const secondDay=aggregatePrecipitation(twoDays,{start:t(24),end:t(48)});
assert.equal(secondDay.ok,true,"intervals outside the target window must be ignored");
assert.equal(secondDay.totalMm,4.8);
const forecastWithTailNulls=[...series([...Array(24).fill(0.1),...Array(24).fill(0.2)])];
for (let i=45;i<48;i++) forecastWithTailNulls[i]={...forecastWithTailNulls[i],value:null};
const firstDayDespiteFutureNulls=aggregatePrecipitation(forecastWithTailNulls,{start:t(0),end:t(24)});
assert.equal(firstDayDespiteFutureNulls.ok,true,"missing values outside the requested window must not invalidate this day");
assert.equal(firstDayDespiteFutureNulls.totalMm,2.4);
const boundaryCross=[...series(Array(24).fill(0)),{start:t(23),end:t(25),value:1,unit:"mm"}];
assert.equal(aggregatePrecipitation(boundaryCross,{start:t(24),end:t(48)}).reason,"interval_crosses_window_boundary");
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

const dailyTotals=[5,4.9,null,10,-0.1];
const dailyProb=ensembleDailyExceedance(dailyTotals,5,{minValidMembers:3,minMemberCoverage:0.6});
assert.equal(dailyProb.validMembers,3);
assert.equal(dailyProb.probability,2/3);
assert.equal(ensembleDailyExceedance(dailyTotals,5,{minValidMembers:5,minMemberCoverage:1}).probability,null);
assert.equal(ensembleDailyExceedance(dailyTotals,5).reason,"coverage_policy_not_configured");
assert.equal(ensembleDailyExceedance(dailyTotals,-1,{minValidMembers:1,minMemberCoverage:0.1}).reason,"invalid_threshold");
console.log("PASS: daily ensemble exceedance excludes null and negative member totals and enforces coverage policy.");


// Versioned ensemble coverage policy regression tests.
for (const [n,expected] of [[51,46],[31,28],[40,36]]) {
  const policy=createEnsembleCoveragePolicy(n,"candidate-90-v1");
  assert.equal(policy.minValidMembers,expected, `90% policy ceiling for N=${n}`);
  assert.equal(policy.policyStatus,"candidate-uncalibrated");
}
assert.equal(createEnsembleCoveragePolicy(0,"candidate-90-v1"),null);
assert.equal(createEnsembleCoveragePolicy(51,"unknown-policy"),null);
const policy51=createEnsembleCoveragePolicy(51,"candidate-90-v1");
const below51=Array(45).fill(0).concat(Array(6).fill(null));
const at51=Array(46).fill(0).concat(Array(5).fill(null));
const rejected51=ensembleDailyExceedance(below51,5,policy51);
assert.equal(rejected51.probability,null);
assert.equal(rejected51.reason,"insufficient_valid_members");
assert.equal(rejected51.requiredMembers,46);
assert.equal(rejected51.coverageFraction,45/51);
const accepted51=ensembleDailyExceedance(at51,5,policy51);
assert.equal(accepted51.probability,0);
assert.equal(accepted51.validMembers,46);
assert.equal(accepted51.totalMembers,51);
assert.equal(accepted51.requiredMembers,46);
assert.equal(accepted51.policyId,"candidate-90-v1");
assert.equal(accepted51.policyStatus,"candidate-uncalibrated");
assert.equal(accepted51.coverageFraction,46/51);
for (const [n,required] of [[31,28],[40,36]]) {
  const policy=createEnsembleCoveragePolicy(n);
  assert.equal(ensembleDailyExceedance(Array(required-1).fill(1).concat(Array(n-required+1).fill(null)),5,policy).probability,null);
  assert.equal(ensembleDailyExceedance(Array(required).fill(1).concat(Array(n-required).fill(null)),5,policy).probability,0);
}
const mixedInvalid=[0,5,4.999,10,25,null,undefined,NaN,Infinity,-0.01];
const mixedPolicy=createEnsembleCoveragePolicy(mixedInvalid.length,"candidate-90-v1");
assert.equal(mixedPolicy.minValidMembers,9);
const mixedResult=ensembleDailyExceedance(mixedInvalid,5,{...mixedPolicy,minValidMembers:5,minMemberCoverage:0.5});
assert.equal(mixedResult.validMembers,5);
assert.equal(mixedResult.exceedances,3);
assert.equal(mixedResult.probability,3/5);
assert.ok(mixedResult.probability>=0 && mixedResult.probability<=1);
for (const threshold of [5,10,25]) {
  const vals=[threshold-0.001,threshold,threshold+0.001];
  const result=ensembleDailyExceedance(vals,threshold,{minValidMembers:3,minMemberCoverage:1});
  assert.equal(result.exceedances,2, `inclusive threshold comparison at ${threshold}mm`);
  assert.equal(result.probability,2/3);
}
const fractional=ensembleDailyExceedance([4.999999,5],5,{minValidMembers:2,minMemberCoverage:1});
assert.equal(fractional.exceedances,1);
assert.equal(ensembleDailyExceedance([],5,createEnsembleCoveragePolicy(1)).reason,"no_members");
assert.equal(ensembleDailyExceedance([1],NaN,{minValidMembers:1,minMemberCoverage:1}).reason,"invalid_threshold");
console.log("PASS: versioned strict-100/candidate-90 coverage policies, ceil boundaries, invalid members, inclusive 5/10/25mm thresholds and metadata.");
