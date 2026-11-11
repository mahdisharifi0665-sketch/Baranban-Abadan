import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {parseOgimetSynopCsv,summarizeOgimetSynop} from "../src/ogimet-synop-observations.mjs";
import {loadObservationStationRegistry} from "../src/observation-station-registry.mjs";

const registry=loadObservationStationRegistry();
const stations=registry.stations.filter(s=>s.country==="Kuwait"&&s.wmo_id&&s.station_id.startsWith("WMO-"));
const now=new Date(),beginDate=new Date(now.getTime()-24*60*60*1000);
const stamp=d=>d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,"0")+String(d.getUTCDate()).padStart(2,"0")+String(d.getUTCHours()).padStart(2,"0")+String(d.getUTCMinutes()).padStart(2,"0");
const begin=stamp(beginDate),end=stamp(now),retrievedAtUtc=now.toISOString();
const results=[];
for(const station of stations){
 const wmo=station.wmo_id;
 const url="https://www.ogimet.com/cgi-bin/getsynop?block="+wmo+"&begin="+begin+"&end="+end+"&lang=eng&header=yes";
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{"user-agent":"BaranYar-Abadan/6.0.0 regional-station-discovery"}});
  if(!response.ok){results.push({station_id:station.station_id,wmo_id:wmo,name:station.name,distance_from_abadan_km:station.distance_from_abadan_km,status:"http_error",http_status:response.status,url});continue;}
  const raw=await response.text();
  if(raw.length<40||raw.includes("Status: 501 Sorry")){results.push({station_id:station.station_id,wmo_id:wmo,name:station.name,distance_from_abadan_km:station.distance_from_abadan_km,status:"empty_or_rate_limited",payload_bytes:Buffer.byteLength(raw),payload_sha256:createHash("sha256").update(raw).digest("hex"),url});continue;}
  const parsed=parseOgimetSynopCsv(raw,{expectedStationId:wmo,retrievedAtUtc});
  const summary=summarizeOgimetSynop(parsed);
  results.push({station_id:station.station_id,wmo_id:wmo,name:station.name,distance_from_abadan_km:station.distance_from_abadan_km,status:parsed.reports.length?"reports_received":"no_reports_in_window",url,payload_bytes:Buffer.byteLength(raw),payload_sha256:createHash("sha256").update(raw).digest("hex"),report_count:parsed.reports.length,precipitation_group_count:parsed.observations.length,summary,warnings:parsed.warnings,reports:parsed.reports,observations:parsed.observations});
 }catch(error){results.push({station_id:station.station_id,wmo_id:wmo,name:station.name,distance_from_abadan_km:station.distance_from_abadan_km,status:"request_failed",url,error:String(error)});}
}
const archive={schema_version:"1.0.0",generated_at_utc:retrievedAtUtc,provider:"OGIMET getsynop / WMO GTS",target:registry.target,requested_window:{begin_utc:begin,end_utc:end},purpose:"station discovery only; not operational precipitation ingestion or Abadan ground truth",acceptance_policy:"A report in this short probe proves transport only. Do not promote a station to accepted/archive ingestion until repeated coverage, exact observation periods, precipitation groups, QC flags, provenance and historical completeness are verified.",station_results:results};
const output="artifacts/observation-archive/ogimet-kuwait-station-discovery.json";
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(archive,null,2)+"\n");
console.log(JSON.stringify({output,generated_at_utc:retrievedAtUtc,requested_window:archive.requested_window,station_results:results.map(({reports,observations,warnings,summary,...x})=>({...x,summary,warning_count:warnings?.length||0,precipitation_observation_count:observations?.length||0}))},null,2));
