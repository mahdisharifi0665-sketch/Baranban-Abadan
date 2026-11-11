// Pure precipitation calculations. All timestamps are UTC ISO-8601 instants.
// Calendar-day boundaries in Asia/Tehran must be converted to UTC by the caller.

function instant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new TypeError(`Invalid UTC ISO-8601 ${label} timestamp`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid ${label} timestamp`);
  const date = new Date(ms);
  const fraction = value.match(/\.(\d{1,3})Z$/)?.[1] || "";
  const expectedMilliseconds = Number((fraction + "00").slice(0,3));
  const fieldsMatch =
    date.getUTCFullYear() === Number(value.slice(0,4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5,7)) &&
    date.getUTCDate() === Number(value.slice(8,10)) &&
    date.getUTCHours() === Number(value.slice(11,13)) &&
    date.getUTCMinutes() === Number(value.slice(14,16)) &&
    date.getUTCSeconds() === Number(value.slice(17,19)) &&
    date.getUTCMilliseconds() === expectedMilliseconds;
  if (!fieldsMatch) throw new TypeError(`Invalid calendar ${label} timestamp`);
  return ms;
}

export function aggregatePrecipitation(intervals, window, expectedUnit = "mm") {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return {ok:false, reason:"no_intervals"};
  }
  try {
    const windowStart = instant(window.start, "window start");
    const windowEnd = instant(window.end, "window end");
    if (windowEnd <= windowStart) return {ok:false, reason:"invalid_window"};

    const sorted = [...intervals].sort((a,b) => instant(a.start,"interval start") - instant(b.start,"interval start"));
    let cursor = windowStart;
    let totalScaled = 0;
    let contributingIntervalCount = 0;

    for (const item of sorted) {
      const start = instant(item.start, "interval start");
      const end = instant(item.end, "interval end");
      if (end <= start) return {ok:false, reason:"invalid_interval"};
      if (end <= windowStart || start >= windowEnd) continue;
      if (start < windowStart || end > windowEnd) return {ok:false, reason:"interval_crosses_window_boundary"};
      if (item.unit !== expectedUnit) return {ok:false, reason:"unit_mismatch"};
      if (!Number.isFinite(item.value) || item.value < 0) return {ok:false, reason:"missing_or_invalid_value"};
      if (start < cursor) return {ok:false, reason:"overlap_or_duplicate"};
      if (start > cursor) return {ok:false, reason:"time_gap"};
      const scaledValue = Math.round(item.value * 1_000_000);
      if (!Number.isSafeInteger(scaledValue)) return {ok:false, reason:"numeric_overflow"};
      totalScaled += scaledValue;
      contributingIntervalCount++;
      if (!Number.isSafeInteger(totalScaled)) return {ok:false, reason:"numeric_overflow"};
      cursor = end;
    }

    if (cursor < windowEnd) return {ok:false, reason:"incomplete_window"};
    if (cursor > windowEnd) return {ok:false, reason:"interval_outside_window"};
    return {ok:true, totalMm:totalScaled / 1_000_000, intervalCount:contributingIntervalCount, coverageSeconds:(windowEnd-windowStart)/1000};
  } catch {
    return {ok:false, reason:"invalid_timestamp"};
  }
}

export const ENSEMBLE_COVERAGE_POLICY_DEFINITIONS = Object.freeze({
  "strict-100-v1": Object.freeze({minMemberCoverage:1, status:"strict-diagnostic"}),
  "candidate-90-v1": Object.freeze({minMemberCoverage:0.9, status:"candidate-uncalibrated"})
});

export function createEnsembleCoveragePolicy(totalMembers, policyId = "candidate-90-v1") {
  if (!Number.isInteger(totalMembers) || totalMembers < 1) return null;
  const definition = ENSEMBLE_COVERAGE_POLICY_DEFINITIONS[policyId];
  if (!definition) return null;
  return {
    policyId,
    policyStatus:definition.status,
    minMemberCoverage:definition.minMemberCoverage,
    minValidMembers:Math.ceil(totalMembers * definition.minMemberCoverage),
    totalMembers
  };
}

function coverageMetadata(config, totalMembers, validMembers, requiredMembers) {
  return {
    policyId:config.policyId || "custom-unversioned",
    policyStatus:config.policyStatus || "unclassified",
    validMembers,
    totalMembers,
    requiredMembers,
    coverageFraction:totalMembers ? validMembers / totalMembers : 0
  };
}

export function ensembleExceedance(members, window, thresholdMm, config) {
  if (!Number.isFinite(thresholdMm) || thresholdMm < 0) {
    return {probability:null, reason:"invalid_threshold", validMembers:0, totalMembers:Array.isArray(members)?members.length:0};
  }
  if (!config || !Number.isInteger(config.minValidMembers) || config.minValidMembers < 1 ||
      !Number.isFinite(config.minMemberCoverage) || config.minMemberCoverage <= 0 || config.minMemberCoverage > 1) {
    return {probability:null, reason:"coverage_policy_not_configured", validMembers:0, totalMembers:Array.isArray(members)?members.length:0};
  }
  if (!Array.isArray(members) || members.length === 0) {
    return {probability:null, reason:"no_members", validMembers:0, totalMembers:0};
  }

  const validTotals = [];
  for (const member of members) {
    const result = aggregatePrecipitation(member?.intervals, window);
    if (result.ok) validTotals.push(Math.round(result.totalMm * 1_000_000));
  }
  const totalMembers = members.length;
  const validMembers = validTotals.length;
  const requiredByFraction = Math.ceil(totalMembers * config.minMemberCoverage);
  const requiredMembers = Math.max(config.minValidMembers, requiredByFraction);
  if (validMembers < requiredMembers) {
    return {probability:null, reason:"insufficient_valid_members", ...coverageMetadata(config,totalMembers,validMembers,requiredMembers)};
  }
  const thresholdScaled = Math.round(thresholdMm * 1_000_000);
  if (!Number.isSafeInteger(thresholdScaled)) return {probability:null,reason:"invalid_threshold",...coverageMetadata(config,totalMembers,validMembers,requiredMembers)};
  const exceedances = validTotals.filter(total => total >= thresholdScaled).length;
  return {
    probability:exceedances / validMembers,
    exceedances,
    ...coverageMetadata(config,totalMembers,validMembers,requiredMembers),
    thresholdMm,
    comparison:">="
  };
}


export function ensembleDailyExceedance(memberTotals, thresholdMm, config) {
  if (!Array.isArray(memberTotals) || memberTotals.length===0) {
    return {probability:null,reason:"no_members",validMembers:0,totalMembers:Array.isArray(memberTotals)?memberTotals.length:0};
  }
  if (!Number.isFinite(thresholdMm) || thresholdMm<0) {
    return {probability:null,reason:"invalid_threshold",validMembers:0,totalMembers:memberTotals.length};
  }
  if (!config || !Number.isInteger(config.minValidMembers) || config.minValidMembers<1 ||
      !Number.isFinite(config.minMemberCoverage) || config.minMemberCoverage<=0 || config.minMemberCoverage>1) {
    return {probability:null,reason:"coverage_policy_not_configured",validMembers:0,totalMembers:memberTotals.length};
  }
  const valid=memberTotals.filter(v=>Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*1_000_000)));
  const totalMembers=memberTotals.length;
  const validMembers=valid.length;
  const requiredMembers=Math.max(config.minValidMembers,Math.ceil(totalMembers*config.minMemberCoverage));
  if (validMembers<requiredMembers) {
    return {probability:null,reason:"insufficient_valid_members",...coverageMetadata(config,totalMembers,validMembers,requiredMembers)};
  }
  const thresholdScaled=Math.round(thresholdMm*1_000_000);
  if(!Number.isSafeInteger(thresholdScaled))return {probability:null,reason:"invalid_threshold",...coverageMetadata(config,totalMembers,validMembers,requiredMembers)};
  const exceedances=valid.filter(v=>Math.round(v*1_000_000)>=thresholdScaled).length;
  return {probability:exceedances/validMembers,exceedances,...coverageMetadata(config,totalMembers,validMembers,requiredMembers),thresholdMm,comparison:">="};
}
