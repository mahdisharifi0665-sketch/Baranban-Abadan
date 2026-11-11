// Pure precipitation calculations. All timestamps are UTC ISO-8601 instants.
// Calendar-day boundaries in Asia/Tehran must be converted to UTC by the caller.

function instant(value, label) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$/.test(value)) {
    throw new TypeError(`Invalid UTC ISO-8601 ${label} timestamp`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid ${label} timestamp`);
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

    for (const item of sorted) {
      const start = instant(item.start, "interval start");
      const end = instant(item.end, "interval end");
      if (end <= start) return {ok:false, reason:"invalid_interval"};
      if (item.unit !== expectedUnit) return {ok:false, reason:"unit_mismatch"};
      if (!Number.isFinite(item.value) || item.value < 0) return {ok:false, reason:"missing_or_invalid_value"};
      if (start < windowStart || end > windowEnd) return {ok:false, reason:"interval_outside_window"};
      if (start < cursor) return {ok:false, reason:"overlap_or_duplicate"};
      if (start > cursor) return {ok:false, reason:"time_gap"};
      totalScaled += Math.round(item.value * 1_000_000);
      cursor = end;
    }

    if (cursor < windowEnd) return {ok:false, reason:"incomplete_window"};
    if (cursor > windowEnd) return {ok:false, reason:"interval_outside_window"};
    return {ok:true, totalMm:totalScaled / 1_000_000, intervalCount:sorted.length, coverageSeconds:(windowEnd-windowStart)/1000};
  } catch {
    return {ok:false, reason:"invalid_timestamp"};
  }
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
    return {probability:null, reason:"insufficient_valid_members", validMembers, totalMembers, requiredMembers};
  }
  const thresholdScaled = Math.round(thresholdMm * 1_000_000);
  const exceedances = validTotals.filter(total => total >= thresholdScaled).length;
  return {
    probability:exceedances / validMembers,
    exceedances,
    validMembers,
    totalMembers,
    requiredMembers,
    thresholdMm,
    comparison:">="
  };
}
