const REQUIRED_COLUMNS = ["STATION", "DATE", "LATITUDE", "LONGITUDE", "NAME", "PRCP", "PRCP_ATTRIBUTES"];
const PERIOD_HOURS = Object.freeze({A:6, B:12, C:18, D:24, E:12, F:24, G:24});
const MISSING_PRCP = "99.99";
function parseCsvLine(line) {
  const cells=[]; let value="", quoted=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch === '"' ) { if (quoted && line[i+1] === '"' ) { value+='"'; i++; } else quoted=!quoted; }
    else if (ch === "," && !quoted) { cells.push(value); value=""; }
    else value+=ch;
  }
  if (quoted) throw new TypeError("unterminated_csv_quote");
  cells.push(value); return cells;
}
function nextUtcDay(date) { const [y,m,d]=date.split("-").map(Number); return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10); }
function finiteCoordinate(value,min,max) { const n=Number(value); return Number.isFinite(n)&&n>=min&&n<=max?n:null; }
export function parseNoaaGsodCsv(csv,{expectedStationId,retrievedAtUtc=new Date().toISOString(),stationDistanceKm=31.7}={}) {
  if (typeof csv!=="string"||!csv.trim()) throw new TypeError("gsod_csv_must_be_non_empty_text");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(retrievedAtUtc)||!Number.isFinite(Date.parse(retrievedAtUtc))) throw new TypeError("retrievedAtUtc_must_be_utc");
  const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim().length>0);
  if(lines.length<2) throw new TypeError("gsod_csv_has_no_data_rows");
  const headers=parseCsvLine(lines[0]).map(x=>x.trim().toUpperCase());
  for(const col of REQUIRED_COLUMNS) if(!headers.includes(col)) throw new TypeError("gsod_missing_column:"+col);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const cells=parseCsvLine(lines[i]); if(cells.length!==headers.length) throw new TypeError("gsod_csv_column_count_mismatch:"+i);
    const row=Object.fromEntries(headers.map((h,j)=>[h,(cells[j]??"").trim()]));
    const stationId=row.STATION.replace(/-/g,"");
    if(expectedStationId&&stationId!==String(expectedStationId).replace(/-/g,"")) throw new TypeError("unexpected_gsod_station:"+row.STATION);
    if(!/^\d{8,11}$/.test(stationId)) throw new TypeError("invalid_gsod_station_id");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.DATE)||!Number.isFinite(Date.parse(row.DATE+"T00:00:00Z"))) throw new TypeError("invalid_gsod_date:"+row.DATE);
    const latitude=finiteCoordinate(row.LATITUDE,-90,90), longitude=finiteCoordinate(row.LONGITUDE,-180,180);
    if(latitude===null||longitude===null) throw new TypeError("invalid_gsod_coordinates:"+row.DATE);
    const raw=row.PRCP, flag=(row.PRCP_ATTRIBUTES||"").trim().toUpperCase();
    const numeric=raw!==""&&raw!==MISSING_PRCP?Number(raw):null;
    if(numeric!==null&&(!Number.isFinite(numeric)||numeric<0)) throw new TypeError("invalid_gsod_precipitation:"+row.DATE);
    const missing=numeric===null||flag==="I", valueMm=missing?null:Number((numeric*25.4).toFixed(3));
    const periodHours=PERIOD_HOURS[flag]??null;
    let qualityStatus="suspect"; const qualityFlags=["noaa_gsod_daily_summary","regional_station_not_abadan","nominal_utc_date_label_not_exact_gauge_window"];
    if(missing){qualityStatus="missing";qualityFlags.push(flag==="I"?"gsod_no_precipitation_report_or_indicator":"gsod_precipitation_missing");}
    else if(periodHours===24){qualityStatus="raw";qualityFlags.push("gsod_24h_accumulation_flag");}
    else if(flag==="H") qualityFlags.push("gsod_zero_with_hourly_rain_indicator_incomplete");
    else if(periodHours!==null) qualityFlags.push("gsod_partial_day_accumulation");
    else qualityFlags.push(flag?"gsod_unrecognized_precipitation_flag":"gsod_accumulation_period_unspecified");
    if(flag==="T") qualityFlags.push("gsod_trace_flag");
    const end=nextUtcDay(row.DATE);
    rows.push({schema_version:"1.0.0",observation_id:"NOAA-GSOD-"+stationId+"-"+row.DATE,
      station:{station_id:"WMO-40872",name:row.NAME||"Bandar-e-Dayyer",latitude,longitude,elevation_m:4,timezone:"UTC",distance_from_abadan_km:stationDistanceKm},
      source:{provider:"NOAA National Centers for Environmental Information",source_type:"official_station",source_reference:"https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/",instrument:null,source_product:"Global Summary of the Day (GSOD)",raw_measurement_flag:flag||null,measurement_period_hours:periodHours},
      observed_start_utc:row.DATE+"T00:00:00Z",observed_end_utc:end+"T00:00:00Z",retrieved_at_utc:retrievedAtUtc,value_mm:valueMm,measurement_kind:"interval_total",quality_status:qualityStatus,quality_flags:[...new Set(qualityFlags)],time_window_basis:"nominal_utc_daily_label",
      notes:"ایستگاه بندر دیر در فاصله تقریبی 31.7 کیلومتری آبدان است و مشاهده مستقیم آبدان نیست. GSOD تصریح می‌کند مجموع بارش روزانه ممکن است به ساعت مشاهده و بخشی از روز قبل وابسته باشد؛ فقط پرچم‌های 24ساعته شناسایی می‌شوند و هیچ رکوردی خودکار accepted نمی‌شود."});
  }
  const ids=new Set(); for(const row of rows){if(ids.has(row.observation_id)) throw new TypeError("duplicate_gsod_station_date:"+row.observation_id);ids.add(row.observation_id);}
  return rows.sort((a,b)=>a.observed_start_utc.localeCompare(b.observed_start_utc));
}
export function summarizeNoaaGsodObservations(records){
  if(!Array.isArray(records)) throw new TypeError("records_must_be_array");
  return {record_count:records.length,numeric_precipitation_count:records.filter(x=>x.value_mm!==null).length,missing_count:records.filter(x=>x.quality_status==="missing").length,raw_24h_count:records.filter(x=>x.quality_flags.includes("gsod_24h_accumulation_flag")).length,suspect_count:records.filter(x=>x.quality_status==="suspect").length,accepted_count:records.filter(x=>x.quality_status==="accepted").length,last_record_date:records.at(-1)?.observed_start_utc.slice(0,10)??null};
}