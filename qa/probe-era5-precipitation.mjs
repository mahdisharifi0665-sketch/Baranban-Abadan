import fs from "node:fs";
import path from "node:path";
import {fetchEra5Precipitation} from "../src/era5-gridded-precipitation.mjs";
const now=new Date(),end=new Date(now.getTime()-6*86400000),start=new Date(end.getTime()-2*86400000);
const date=d=>d.toISOString().slice(0,10),startDate=date(start),endDate=date(end);
const output="artifacts/observation-archive/era5-gridded-precipitation.json";
fs.mkdirSync(path.dirname(output),{recursive:true});
try{
 const archive=await fetchEra5Precipitation({startDate,endDate});
 const finite=archive.records.filter(x=>x.value_mm!==null).length;
 const report={...archive,probe_status:archive.record_count>0?"success":"empty_response",valid_value_count:finite,missing_value_count:archive.record_count-finite};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({output,status:report.probe_status,dataset:"ERA5",requested_start:startDate,requested_end:endDate,records:archive.record_count,valid_values:finite,missing_values:archive.record_count-finite,resolved_grid_cell:archive.resolved_grid_cell},null,2));
}catch(error){
 const report={archive_schema_version:"1.0.0",provider:"Open-Meteo Historical Weather API",dataset:"ERA5",probe_status:"unavailable",requested_start:startDate,requested_end:endDate,retrieved_at_utc:new Date().toISOString(),error:String(error),records:[],limitations:["Provider unavailable during this probe; no values were synthesized.","ERA5 is a reanalysis estimate, not an independent station observation."]};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({output,status:"unavailable",error:String(error)},null,2));
}
