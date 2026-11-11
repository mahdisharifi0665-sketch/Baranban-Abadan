const PERIOD_HOURS=Object.freeze({1:6,2:12,3:18,4:24,5:1,6:2,7:3,8:9,9:15});
const SUSPECT_AMOUNT_LIMITS_MM=Object.freeze({1:100,2:150,3:150,4:200,5:50,6:50,7:75,8:150,9:150});
function parseCsvRecord(line){const fields=[];let value="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(ch===","&&!quoted){fields.push(value);value="";}else value+=ch;}if(quoted)throw new TypeError("unterminated_synop_csv_quote");fields.push(value);return fields;}
function utcStamp(y,m,d,h,min){const stamp=String(y).padStart(4,"0")+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0")+"T"+String(h).padStart(2,"0")+":"+String(min).padStart(2,"0")+":00Z";if(!Number.isFinite(Date.parse(stamp)))throw new TypeError("invalid_synop_timestamp:"+stamp);return new Date(Date.parse(stamp)).toISOString();}
function decodeRRR(code){if(code==="///")return {value_mm:null,status:"missing",flags:["synop_precipitation_not_measured"]};if(code==="000")return {value_mm:0,status:"raw",flags:[]};const n=Number(code);if(!Number.isInteger(n)||n<0||n>999)throw new TypeError("invalid_synop_rrr:"+code);if(n===990)return {value_mm:0,status:"suspect",flags:["synop_trace_less_than_0_05mm"]};if(n>=991)return {value_mm:Number(((n-990)/10).toFixed(1)),status:"raw",flags:[]};if(n===989)return {value_mm:989,status:"suspect",flags:["synop_989mm_or_more_censored"]};return {value_mm:n,status:"raw",flags:[]};}
export function parseOgimetSynopCsv(csv,{expectedStationId="40872",retrievedAtUtc=new Date().toISOString(),stationDistanceKm=31.7,zeroIntervalHoursByUtcHour={0:6,6:6,12:6,18:6}}={}){
 if(typeof csv!=="string"||!csv.trim())throw new TypeError("ogimet_synop_csv_empty");
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(retrievedAtUtc)||!Number.isFinite(Date.parse(retrievedAtUtc)))throw new TypeError("retrievedAtUtc_must_be_utc");
 const lines=csv.trim().split(/\r?\n/).filter(Boolean),reports=[],observations=[],warnings=[];
 for(const line of lines){const f=parseCsvRecord(line);if(f[0]?.trim().toUpperCase()==="WMOIND")continue;if(f.length<7)throw new TypeError("ogimet_synop_csv_columns_invalid");
  const station=f[0].trim();if(station!==String(expectedStationId))continue;
  const end=utcStamp(f[1],f[2],f[3],f[4],f[5]),message=f.slice(6).join(",").trim();
  const tokens=message.replace(/=+$/g,"").split(/\s+/).filter(Boolean);const stationIndex=tokens.indexOf(station);
  if(stationIndex<0){warnings.push({code:"station_id_not_found_in_synop_message",end});continue;}
  const indicator=tokens[stationIndex+1]||"",iR=/^\d{5}$/.test(indicator)?Number(indicator[0]):null;
  reports.push({station_id:station,end_utc:end,iR,message});
  const section3Index=tokens.indexOf("333");const groups=[];for(let i=0;i<tokens.length;i++){const match=tokens[i].match(/^6(\d{3}|\/{3})(\d)$/);if(match)groups.push({group:tokens[i],rrr:match[1],tR:Number(match[2]),ordinal:i});}
  if(groups.length===0){
   if(iR===3){
    const hour=Number(end.slice(11,13)),zeroHours=zeroIntervalHoursByUtcHour[hour];
    if(Number.isInteger(zeroHours)&&zeroHours>0){
     const start=new Date(Date.parse(end)-zeroHours*3600000).toISOString();
     observations.push({schema_version:"1.0.0",observation_id:"OGIMET-SYNOP-"+station+"-"+end.replace(/[-:]/g,"").replace(".000Z","Z")+"-ir3-zero",
      station:{station_id:"WMO-40872",name:"Bandar-e-Dayyer",latitude:27.8333,longitude:51.9333,elevation_m:4,timezone:"UTC",distance_from_abadan_km:stationDistanceKm},
      source:{provider:"OGIMET (WMO GTS redistribution)",source_type:"official_station",source_reference:"https://www.ogimet.com/cgi-bin/getsynop",instrument:null,source_product:"SYNOP FM-12",raw_measurement_flag:"iR=3;RRR omitted;period="+zeroHours+"h inferred from main synoptic schedule",measurement_period_hours:zeroHours},
      observed_start_utc:start,observed_end_utc:end,retrieved_at_utc:retrievedAtUtc,value_mm:0,measurement_kind:"interval_total",quality_status:"suspect",quality_flags:["ogimet_getsynop_raw_wmo_synop","regional_station_not_abadan","synop_iR_3_no_precipitation","period_inferred_from_main_synoptic_schedule"],time_window_basis:"exact_interval",
      notes:"کد iR=3 نشان می‌دهد گروه بارش حذف شده و مقدار بارش صفر است؛ طول بازه 6ساعته از ساعت اصلی سینوپتیکی ایستگاه استنباط شده، بنابراین رکورد suspect باقی می‌ماند و فقط در تجمیع تشخیصی مجاز است."});
    } else warnings.push({code:"zero_period_not_inferred_for_intermediate_synoptic_hour",end});
   } else if(iR===1||iR===2||iR===0)warnings.push({code:"precipitation_group_indicated_but_absent",end});
   continue;
  }
  for(const g of groups){const hours=PERIOD_HOURS[g.tR];if(!hours){warnings.push({code:"synop_precipitation_period_unresolved",end,group:g.group});continue;}
   const decoded=decodeRRR(g.rrr),endMs=Date.parse(end),start=new Date(endMs-hours*3600000).toISOString();
   const flags=["ogimet_getsynop_raw_wmo_synop","regional_station_not_abadan","synop_tr_"+g.tR,...decoded.flags];let qualityStatus=decoded.status;if(iR!==null)flags.push("synop_iR_"+iR);
   const numericRrr=g.rrr==="///"?null:Number(g.rrr),limit=SUSPECT_AMOUNT_LIMITS_MM[g.tR];
   if(g.rrr==="666"){qualityStatus="suspect";flags.push("suspect_repeated_station_code_666");}
   if(numericRrr!==null&&Number.isFinite(numericRrr)&&Number.isFinite(limit)&&numericRrr>limit){qualityStatus="suspect";flags.push("suspect_high_accumulation_requires_independent_confirmation");}
   if(iR===3||iR===4){qualityStatus="suspect";flags.push("synop_ir_indicator_conflicts_with_group6");}const groupInSection3=section3Index>=0&&g.ordinal>section3Index;if((iR===1&&groupInSection3)||(iR===2&&!groupInSection3)){qualityStatus="suspect";flags.push("synop_ir_section_location_conflict");}
   observations.push({schema_version:"1.0.0",observation_id:"OGIMET-SYNOP-"+station+"-"+end.replace(/[-:]/g,"").replace(".000Z","Z")+"-tr"+g.tR+"-"+g.ordinal,
    station:{station_id:"WMO-40872",name:"Bandar-e-Dayyer",latitude:27.8333,longitude:51.9333,elevation_m:4,timezone:"UTC",distance_from_abadan_km:stationDistanceKm},
    source:{provider:"OGIMET (WMO GTS redistribution)",source_type:"official_station",source_reference:"https://www.ogimet.com/cgi-bin/getsynop",instrument:null,source_product:"SYNOP FM-12",raw_measurement_flag:"RRR="+g.rrr+";tR="+g.tR+";iR="+(iR??"unknown"),measurement_period_hours:hours},
    observed_start_utc:start,observed_end_utc:end,retrieved_at_utc:retrievedAtUtc,value_mm:decoded.value_mm,measurement_kind:"interval_total",quality_status:qualityStatus,quality_flags:[...new Set(flags)],time_window_basis:"exact_interval",
    notes:"مشاهده خام SYNOP ایستگاه بندر دیر؛ بازه tR دقیقاً به زمان گزارش ختم می‌شود. ایستگاه در فاصله تقریبی 31.7 کیلومتری آبدان است و جانشین باران‌سنج محلی آبدان نیست. داده‌های خام بدون هم‌ترازسازی یا پرکردن خلأها نگهداری می‌شوند."});
  }
 }
 const ids=new Set();for(const o of observations){if(ids.has(o.observation_id))throw new TypeError("duplicate_synop_precipitation_interval:"+o.observation_id);ids.add(o.observation_id);}
 observations.sort((a,b)=>a.observed_end_utc.localeCompare(b.observed_end_utc)||a.observed_start_utc.localeCompare(b.observed_start_utc));
 return {reports,observations,warnings};
}
export function aggregateComplete24h(records,windowEndUtc,{allowInferredZero=false}={}){
 if(!Array.isArray(records))throw new TypeError("records_must_be_array");const end=Date.parse(windowEndUtc);if(!Number.isFinite(end))throw new TypeError("invalid_24h_window_end");const start=end-86400000;
 const usable=records.filter(r=>r.time_window_basis==="exact_interval"&&(["raw","accepted"].includes(r.quality_status)||(allowInferredZero&&r.quality_status==="suspect"&&r.quality_flags.includes("synop_iR_3_no_precipitation")))&&Number.isFinite(r.value_mm)&&Number.isFinite(Date.parse(r.observed_start_utc))&&Number.isFinite(Date.parse(r.observed_end_utc))&&Date.parse(r.observed_start_utc)>=start&&Date.parse(r.observed_end_utc)<=end);
 const byStart=new Map();for(const r of usable){const s=Date.parse(r.observed_start_utc),e=Date.parse(r.observed_end_utc);if(e<=s)continue;if(!byStart.has(s))byStart.set(s,[]);byStart.get(s).push({record:r,end:e});}
 for(const [intervalStart,list] of byStart)list.sort((a,b)=>(b.end-intervalStart)-(a.end-intervalStart));
 const memo=new Map();function walk(cursor){if(cursor===end)return [];if(cursor>end||memo.has(cursor))return memo.get(cursor)??null;const options=byStart.get(cursor)||[];for(const item of options){const rest=walk(item.end);if(rest!==null){const path=[item.record,...rest];memo.set(cursor,path);return path;}}memo.set(cursor,null);return null;}
 const path=walk(start);if(path===null)return null;const containsInferredZero=path.some(r=>r.quality_flags.includes("synop_iR_3_no_precipitation"));return {window_start_utc:new Date(start).toISOString(),window_end_utc:new Date(end).toISOString(),total_mm:Number(path.reduce((sum,r)=>sum+r.value_mm,0).toFixed(3)),coverage_hours:24,method:"exact_non_overlapping_synop_interval_sum",evidence_status:containsInferredZero?"suspect_inferred_zero":"raw_measured_intervals",contains_inferred_zero:containsInferredZero,observation_ids:path.map(r=>r.observation_id),station_id:path[0]?.station?.station_id??null};
}
export function summarizeOgimetSynop(result){const reports=result.reports||[],obs=result.observations||[];const periodCounts=Object.fromEntries([...new Set(obs.map(x=>x.source.measurement_period_hours))].sort((a,b)=>a-b).map(h=>[String(h),obs.filter(x=>x.source.measurement_period_hours===h).length]));const inferredZeroCount=obs.filter(x=>x.quality_flags.includes("synop_iR_3_no_precipitation")).length;const indicatorCounts=Object.fromEntries([...new Set(reports.map(x=>x.iR))].map(k=>[String(k),reports.filter(x=>x.iR===k).length]));return {report_count:reports.length,indicator_counts:indicatorCounts,period_counts:periodCounts,inferred_zero_count:inferredZeroCount,precipitation_interval_count:obs.length,raw_24h_count:obs.filter(x=>x.source.measurement_period_hours===24&&x.quality_status==="raw").length,raw_6h_count:obs.filter(x=>x.source.measurement_period_hours===6&&x.quality_status==="raw").length,missing_count:obs.filter(x=>x.quality_status==="missing").length,suspect_count:obs.filter(x=>x.quality_status==="suspect").length,warning_count:(result.warnings||[]).length,last_report_utc:reports.at(-1)?.end_utc??null,last_precipitation_report_utc:obs.at(-1)?.observed_end_utc??null};}