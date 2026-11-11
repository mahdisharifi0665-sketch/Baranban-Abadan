import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {parseNoaaGsodCsv,summarizeNoaaGsodObservations} from "../src/noaa-gsod-observations.mjs";
const stationId="40872099999";
const currentYear=new Date().getUTCFullYear();
const years=[2025,...(currentYear>2025?[currentYear]:[])];
const retrievedAtUtc=new Date().toISOString();
const sources=[];
for(const year of years){
 const url="https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/"+year+"/"+stationId+".csv";
 const response=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{"user-agent":"Baranban-Abadan/5.1 observation-quality-probe"}});
 if(!response.ok){if(year===2025) throw new Error("NOAA GSOD historical reference fetch failed: HTTP "+response.status+" at "+url);sources.push({year,url,http_status:response.status,available:false,reason:"current_year_file_not_available"});continue;}
 const raw=await response.text(); if(raw.length<100) throw new Error("NOAA GSOD response too small for "+year);
 const observations=parseNoaaGsodCsv(raw,{expectedStationId:stationId,retrievedAtUtc});
 const summary=summarizeNoaaGsodObservations(observations); if(observations.length===0) throw new Error("NOAA GSOD file contains no observations for "+year);
 sources.push({year,url,http_status:response.status,available:true,payload_sha256:createHash("sha256").update(raw).digest("hex"),payload_bytes:Buffer.byteLength(raw),summary,observations});
}
const document={archive_schema_version:"1.0.0",archive_id:"baranban-abadan-noaa-gsod-"+retrievedAtUtc.replace(/[-:.]/g,""),generated_at_utc:retrievedAtUtc,target:{name:"Abadan",latitude:28.0801523,longitude:51.77113355,timezone:"Asia/Tehran"},station:{station_id:"WMO-40872",name:"Bandar-e-Dayyer",latitude:27.8333,longitude:51.9333,distance_from_abadan_km:31.7,direct_abadan_gauge:false},provider:"NOAA NCEI Global Summary of the Day",sources,acceptance:{accepted_records:0,note:"Raw GSOD records are not promoted to accepted observations automatically. Daily summary labels are not exact local rolling-24h windows; only 24-hour source flags are identified, and all records remain raw/suspect/missing pending independent QC."}};
const output="artifacts/observation-archive/noaa-gsod-40872.json";
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(document,null,2)+"\n");
console.log(JSON.stringify({output,generated_at_utc:retrievedAtUtc,sources:sources.map(({observations,...source})=>source)},null,2));