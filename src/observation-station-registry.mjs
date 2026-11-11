import fs from "node:fs";
import path from "node:path";

const ALLOWED_STATUS = new Set([
  "historical_archive_candidate","not_available_from_referenced_feed",
  "requires_live_parameter_verification","not_yet_verified","verified_sparse_daily_archive"
]);

export function haversineKm(a,b) {
  const rad=value=>value*Math.PI/180;
  const dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);
  const lat1=rad(a.latitude),lat2=rad(b.latitude);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371.0088*2*Math.asin(Math.sqrt(h));
}

export function validateObservationStationRegistry(registry,{distanceToleranceKm=1.0}={}) {
  const errors=[];
  if(!registry||typeof registry!=="object"||Array.isArray(registry)) return {valid:false,errors:["registry_must_be_object"]};
  if(registry.registry_version!=="1.0.0") errors.push("unsupported_registry_version");
  const target=registry.target;
  if(!target||target.name!=="Abadan"||target.latitude!==28.0794||target.longitude!==51.7694) errors.push("invalid_abadan_reference");
  if(!Array.isArray(registry.stations)) errors.push("stations_must_be_array");
  if(!Array.isArray(registry.providers)) errors.push("providers_must_be_array");
  if(!Array.isArray(registry.stations)||!Array.isArray(registry.providers)) return {valid:false,errors};
  const ids=new Set();
  for(const station of registry.stations){
    if(!station||typeof station!=="object"){errors.push("invalid_station_record");continue;}
    if(!station.station_id||ids.has(station.station_id)) errors.push("missing_or_duplicate_station_id");
    ids.add(station.station_id);
    if(!Number.isFinite(station.latitude)||station.latitude < -90||station.latitude > 90) errors.push("invalid_station_latitude:"+station.station_id);
    if(!Number.isFinite(station.longitude)||station.longitude < -180||station.longitude > 180) errors.push("invalid_station_longitude:"+station.station_id);
    if(!ALLOWED_STATUS.has(station.precipitation_status)) errors.push("invalid_precipitation_status:"+station.station_id);
    if(station.direct_abadan_gauge!==false) errors.push("external_station_cannot_be_direct_abadan_gauge:"+station.station_id);
    if(station.operational_ingestion_enabled!==false) errors.push("external_station_cannot_be_operational_forecast_truth:"+station.station_id);
    if(station.archive_ingestion_enabled===true&&station.precipitation_status!=="verified_sparse_daily_archive") errors.push("unverified_archive_ingestion_enabled:"+station.station_id);
    if(station.precipitation_status==="verified_sparse_daily_archive"&&station.archive_ingestion_enabled!==true) errors.push("verified_archive_not_enabled:"+station.station_id);
    if(target&&Number.isFinite(station.latitude)&&Number.isFinite(station.longitude)&&Number.isFinite(station.distance_from_abadan_km)){
      const actual=haversineKm(target,station);
      if(Math.abs(actual-station.distance_from_abadan_km)>distanceToleranceKm) errors.push("station_distance_mismatch:"+station.station_id);
    }else errors.push("missing_station_distance:"+station.station_id);
    if(!Array.isArray(station.source_urls)||station.source_urls.length===0) errors.push("missing_station_provenance:"+station.station_id);
    if(typeof station.evidence_note!=="string"||station.evidence_note.length<10) errors.push("missing_station_evidence_note:"+station.station_id);
  }
  const providerIds=new Set();
  for(const provider of registry.providers){
    if(!provider?.provider_id||providerIds.has(provider.provider_id)) errors.push("missing_or_duplicate_provider_id");
    providerIds.add(provider?.provider_id);
    if(!provider?.source_url||!provider?.status||!provider?.capability||!provider?.access_requirement) errors.push("incomplete_provider_provenance:"+provider?.provider_id);
  }
  return {valid:errors.length===0,errors};
}

export function loadObservationStationRegistry(filePath="data/observation-station-registry.json"){
  const resolved=path.resolve(filePath),registry=JSON.parse(fs.readFileSync(resolved,"utf8"));
  const result=validateObservationStationRegistry(registry);
  if(!result.valid) throw new Error("Invalid observation station registry: "+result.errors.join(", "));
  return registry;
}
