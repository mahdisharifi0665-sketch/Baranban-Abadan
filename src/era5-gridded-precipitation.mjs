const TARGET = Object.freeze({latitude:28.0801523,longitude:51.77113355});
const ISO_UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z?$/;
function validDate(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
function iso(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new TypeError("invalid_utc_timestamp");return d.toISOString();}
export function buildEra5ArchiveUrl({startDate,endDate,latitude=TARGET.latitude,longitude=TARGET.longitude}){
 if(!validDate(startDate)||!validDate(endDate)||endDate<startDate)throw new TypeError("invalid_date_range");
 if(!Number.isFinite(latitude)||latitude < -90||latitude>90||!Number.isFinite(longitude)||longitude < -180||longitude>180)throw new TypeError("invalid_coordinates");
 const u=new URL("https://archive-api.open-meteo.com/v1/archive");
 for(const [k,v] of Object.entries({latitude,longitude,start_date:startDate,end_date:endDate,hourly:"precipitation",models:"era5",timezone:"UTC",timeformat:"iso8601",precipitation_unit:"mm",cell_selection:"nearest"}))u.searchParams.set(k,String(v));
 return u.toString();
}
export function parseEra5PrecipitationResponse(payload,{retrievedAtUtc=new Date().toISOString(),target=TARGET}={}){
 if(!payload||typeof payload!=="object"||!payload.hourly||!Array.isArray(payload.hourly.time)||!Array.isArray(payload.hourly.precipitation))throw new TypeError("era5_hourly_payload_invalid");
 if(payload.hourly.time.length!==payload.hourly.precipitation.length)throw new TypeError("era5_hourly_array_length_mismatch");
 const retrieved=iso(retrievedAtUtc),gridLat=Number(payload.latitude),gridLon=Number(payload.longitude);
 if(!Number.isFinite(gridLat)||!Number.isFinite(gridLon))throw new TypeError("era5_resolved_grid_coordinates_missing");
 const records=payload.hourly.time.map((time,index)=>{
  if(typeof time!=="string"||!ISO_UTC.test(time))throw new TypeError("era5_timestamp_must_be_utc:"+time);
  const end=iso(time.endsWith("Z")?time:time+"Z"),start=iso(Date.parse(end)-3600000),raw=payload.hourly.precipitation[index];
  const missing=raw===null||raw===undefined;
  if(!missing&&(!Number.isFinite(raw)||raw<0))throw new TypeError("era5_precipitation_value_invalid:"+index);
  return {record_schema_version:"1.0.0",record_id:"ERA5-"+end.replace(/[-:]/g,"").replace(".000Z","Z"),source:{provider:"Open-Meteo Historical Weather API",dataset:"ERA5",source_type:"reanalysis_grid_estimate",source_url:"https://archive-api.open-meteo.com/v1/archive",variable:"precipitation",unit:"mm",nominal_grid_resolution_degrees:0.25,temporal_semantics:"preceding_hour_sum"},target:{name:"Abdan",latitude:target.latitude,longitude:target.longitude},grid_cell:{latitude:gridLat,longitude:gridLon,selection:"nearest"},interval_start_utc:start,interval_end_utc:end,retrieved_at_utc:retrieved,value_mm:missing?null:raw,quality_status:missing?"missing":"raw",quality_flags:missing?["source_value_missing"]:["reanalysis_not_ground_station","era5_nominal_grid_0_25_degree","nearest_grid_cell_selection"],};
 });
 return {archive_schema_version:"1.0.0",provider:"Open-Meteo Historical Weather API",dataset:"ERA5",target:{name:"Abdan",latitude:target.latitude,longitude:target.longitude},resolved_grid_cell:{latitude:gridLat,longitude:gridLon},requested_start_date:payload.hourly.time[0]?.slice(0,10)??null,requested_end_date:payload.hourly.time.at(-1)?.slice(0,10)??null,retrieved_at_utc:retrieved,record_count:records.length,records,limitations:["ERA5 is a reanalysis estimate, not an independent rain-gauge observation.","Nominal native resolution is about 0.25 degrees; this does not resolve the 5 km target radius.","Hourly precipitation is the sum over the preceding hour; timestamps label interval ends.","Missing source values remain null and are never converted to zero."]};
}
export async function fetchEra5Precipitation({startDate,endDate,latitude=TARGET.latitude,longitude=TARGET.longitude,fetchImpl=fetch,retrievedAtUtc=new Date().toISOString()}={}){
 const url=buildEra5ArchiveUrl({startDate,endDate,latitude,longitude});
 const response=await fetchImpl(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error("era5_archive_http_"+response.status+":"+String(await response.text()).slice(0,240));
 const payload=await response.json();
 return parseEra5PrecipitationResponse(payload,{retrievedAtUtc,target:{latitude,longitude}});
}
