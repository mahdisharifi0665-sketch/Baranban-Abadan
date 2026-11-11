const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateRainObservation(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return {valid:false, errors:["record_must_be_object"]};
  for (const key of ["observation_id","station","source","observed_start_utc","observed_end_utc","retrieved_at_utc","value_mm","measurement_kind","quality_status","quality_flags"]) {
    if (record[key] === undefined || record[key] === null) errors.push("missing_"+key);
  }
  if (typeof record.observation_id !== "string" || !record.observation_id.trim()) errors.push("invalid_observation_id");
  if (record.schema_version !== "1.0.0") errors.push("unsupported_schema_version");
  for (const key of ["observed_start_utc","observed_end_utc","retrieved_at_utc"]) {
    if (typeof record[key] !== "string" || !ISO_WITH_ZONE.test(record[key]) || !Number.isFinite(Date.parse(record[key]))) errors.push("invalid_"+key);
  }
  if (record.station) {
    const s=record.station;
    if (typeof s.station_id!=="string" || !s.station_id.trim()) errors.push("invalid_station_id");
    if (!Number.isFinite(s.latitude)||s.latitude < -90||s.latitude > 90) errors.push("invalid_latitude");
    if (!Number.isFinite(s.longitude)||s.longitude < -180||s.longitude > 180) errors.push("invalid_longitude");
    if (typeof s.timezone!=="string"||!s.timezone.trim()) errors.push("invalid_station_timezone");
  }
  if (record.source) {
    if (typeof record.source.provider!=="string" || !record.source.provider.trim() ||
        !["official_station","personal_gauge","api","manual_report","gridded_estimate"].includes(record.source.source_type)) errors.push("invalid_source");
    if (record.source.measurement_period_hours!==undefined && record.source.measurement_period_hours!==null &&
        (!Number.isInteger(record.source.measurement_period_hours)||record.source.measurement_period_hours<1||record.source.measurement_period_hours>72)) errors.push("invalid_measurement_period_hours");
  }
  if (record.value_mm !== null && (!Number.isFinite(record.value_mm)||record.value_mm<0)) errors.push("invalid_rain_value");
  if (!["interval_total","cumulative_counter"].includes(record.measurement_kind)) errors.push("invalid_measurement_kind");
  if (!["raw","accepted","suspect","rejected","missing"].includes(record.quality_status)) errors.push("invalid_quality_status");
  if (!Array.isArray(record.quality_flags)) errors.push("quality_flags_must_be_array");
  if (record.time_window_basis!==undefined && !["exact_interval","nominal_utc_daily_label","unknown"].includes(record.time_window_basis)) errors.push("invalid_time_window_basis");
  const start=Date.parse(record.observed_start_utc), end=Date.parse(record.observed_end_utc);
  if (Number.isFinite(start)&&Number.isFinite(end)&&end<=start) errors.push("non_positive_observation_interval");
  if (record.quality_status==="missing" && record.value_mm!==null) errors.push("missing_observation_must_have_null_value");
  if (record.quality_status!=="missing" && record.value_mm===null) errors.push("non_missing_observation_must_have_value");
  if (record.measurement_kind==="cumulative_counter" && record.counter_reset===undefined) errors.push("counter_reset_status_required");
  return {valid:errors.length===0, errors};
}

export function auditRainObservationSeries(records, {expectedIntervalSeconds=null}={}) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  const findings=[];
  const groups=new Map();
  records.forEach((record,index)=>{
    const stationId=record?.station?.station_id ?? "__missing_station__";
    if (!groups.has(stationId)) groups.set(stationId,[]);
    groups.get(stationId).push({record,index,start:Date.parse(record?.observed_start_utc),end:Date.parse(record?.observed_end_utc)});
  });
  for (const [stationId,items] of groups) {
    items.sort((a,b)=>a.start-b.start || a.end-b.end);
    const seen=new Set();
    for (const item of items) {
      const key=[item.record?.observed_start_utc,item.record?.observed_end_utc].join("|");
      if (seen.has(key)) findings.push({code:"duplicate_interval",index:item.index,station_id:stationId});
      seen.add(key);
      const check=validateRainObservation(item.record);
      for (const code of check.errors) findings.push({code,index:item.index,station_id:stationId});
    }
    for (let i=1;i<items.length;i++) {
      const prev=items[i-1],cur=items[i];
      if (!Number.isFinite(prev.end)||!Number.isFinite(cur.start)) continue;
      if (cur.start<prev.end) findings.push({code:"overlapping_intervals",index:cur.index,station_id:stationId});
      if (expectedIntervalSeconds!==null && cur.start-prev.start>expectedIntervalSeconds*1000)
        findings.push({code:"time_gap",index:cur.index,station_id:stationId,gap_seconds:(cur.start-prev.start)/1000});
      if (prev.record?.measurement_kind==="cumulative_counter" && cur.record?.measurement_kind==="cumulative_counter" &&
          Number.isFinite(prev.record.value_mm)&&Number.isFinite(cur.record.value_mm) &&
          cur.record.value_mm<prev.record.value_mm && cur.record.counter_reset!==true)
        findings.push({code:"unflagged_counter_reset",index:cur.index,station_id:stationId});
    }
  }
  return {valid:findings.length===0,record_count:records.length,findings};
}
