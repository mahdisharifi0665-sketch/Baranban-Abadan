import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {haversineKm,validateObservationStationRegistry} from "../src/observation-station-registry.mjs";
const registry=JSON.parse(fs.readFileSync("data/observation-station-registry.json","utf8"));
const schema=JSON.parse(fs.readFileSync("schemas/observation-station-registry.schema.json","utf8"));
const ajv=new Ajv2020({allErrors:true,strict:true}); addFormats(ajv);
const validate=ajv.compile(schema);
assert.equal(validate(registry),true,JSON.stringify(validate.errors));
assert.equal(validateObservationStationRegistry(registry).valid,true);
assert.deepEqual(registry.target,{name:"Abdan",latitude:28.0801523,longitude:51.77113355});
assert.ok(Math.abs(haversineKm(registry.target,registry.stations[0])-31.7)<1);
assert.equal(validateObservationStationRegistry({...registry,stations:[{...registry.stations[0],direct_abadan_gauge:true}]}).valid,false);
assert.equal(validateObservationStationRegistry({...registry,stations:[{...registry.stations[0],operational_ingestion_enabled:true}]}).valid,false);
assert.equal(validateObservationStationRegistry({...registry,stations:[{...registry.stations[0],archive_ingestion_enabled:false}]}).valid,false);
assert.equal(validateObservationStationRegistry({...registry,stations:[{...registry.stations[0],distance_from_abadan_km:2}]}).valid,false);
assert.equal(validateObservationStationRegistry({...registry,stations:[registry.stations[0],registry.stations[0]]}).valid,false);
const dayyer=registry.stations.find(s=>s.station_id==="WMO-40872");
assert.equal(dayyer.precipitation_status,"verified_live_synop_feed");
assert.equal(dayyer.noaa_gsod_station_id,"40872099999");
assert.equal(dayyer.archive_ingestion_enabled,true);
assert.equal(dayyer.direct_abadan_gauge,false);
const jam=registry.stations.find(s=>s.station_id==="ICAO-OIBJ");
assert.equal(jam.precipitation_status,"not_available_from_referenced_feed");
const ncm=registry.providers.find(p=>p.provider_id==="SA-NCM-WEATHER-API");
assert.equal(ncm.status,"credential_gated_candidate");
const wis2=registry.providers.find(p=>p.provider_id==="IRIMO-WIS2-SYNOP");
assert.equal(wis2.status,"advertised_wis2_feed_unverified");
assert.ok(wis2.notes.includes("have not been tested"));
const noaa=registry.providers.find(p=>p.provider_id==="NOAA-GSOD");
assert.equal(noaa.status,"verified_public_daily_archive");
const ogimet=registry.providers.find(p=>p.provider_id==="OGIMET-SYNOP");
assert.equal(ogimet.status,"verified_public_synop_feed");
const local=registry.stations.find(s=>s.station_id==="LOCAL-ABADAN-RAIN-GAUGE-REPORTED");
assert.ok(local);
assert.equal(local.direct_abadan_gauge,true);
assert.equal(local.coordinates_verified,false);
assert.equal(local.precipitation_status,"manual_reports_only");
assert.equal(local.operational_ingestion_enabled,false);
assert.equal(local.archive_ingestion_enabled,false);
assert.equal(validateObservationStationRegistry({...registry,stations:registry.stations.map(s=>s.station_id===local.station_id?{...s,direct_abadan_gauge:false}:s)}).valid,false);
assert.equal(validateObservationStationRegistry({...registry,stations:registry.stations.map(s=>s.station_id===local.station_id?{...s,coordinates_verified:true}:s)}).valid,false);
assert.equal(validateObservationStationRegistry({...registry,stations:registry.stations.map(s=>s.station_id===local.station_id?{...s,archive_ingestion_enabled:true}:s)}).valid,false);
const localProvider=registry.providers.find(p=>p.provider_id==="ABADAN-LOCAL-GAUGE-SECONDARY-REPORTS");
assert.equal(localProvider.status,"manual_reports_only");

for (const [id, distance, country] of [
  ["WMO-40592", 367.1, "Kuwait"],
  ["WMO-40594", 335.0, "Kuwait"],
  ["WMO-40562", 369.8, "Kuwait"],
  ["WMO-40595", 304.2, "Kuwait"],
  ["WMO-40596", 312.2, "Kuwait"]
]) {
  const station = registry.stations.find(s => s.station_id === id);
  assert.ok(station, `missing registered regional station ${id}`);
  assert.equal(station.country, country);
  assert.equal(station.direct_abadan_gauge, false);
  assert.equal(station.operational_ingestion_enabled, false);
  assert.equal(station.archive_ingestion_enabled, false);
  assert.equal(station.precipitation_status, "historical_archive_candidate");
  assert.ok(Math.abs(haversineKm(registry.target, station) - distance) < 0.2);
}
const kuwait = registry.providers.find(p => p.provider_id === "KUWAIT-MET-STATION-CATALOG");
assert.equal(kuwait.status, "historical_context_only");
for (const station of registry.stations.filter(s => s.country === "Kuwait" || s.station_id === "ICAO-OTBD" || s.station_id === "ICAO-OIKQ")) {
  assert.equal(station.station_role, "distant_synoptic_context");
  assert.equal(station.operational_ingestion_enabled, false);
  assert.equal(station.archive_ingestion_enabled, false);
  assert.ok(station.distance_from_abadan_km > 250);
}
assert.equal(registry.target.name, "Abdan");
assert.equal(registry.distance_policy_km.local_network_max, 100);
assert.equal(registry.distance_policy_km.regional_support_max, 250);
assert.ok(kuwait.notes.includes("هیچ feed بارش"));

console.log("PASS: observation station registry schema, provenance, distance, source status and archive-only ingestion guards.");
