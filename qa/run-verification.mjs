import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {buildVerificationPairs,scoreVerificationPairs} from "../src/forecast-observation-verification.mjs";
const token=process.env.GITHUB_TOKEN,repository=process.env.GITHUB_REPOSITORY;
if(!token||!repository)throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required for forecast artifact verification");
const observationPath="artifacts/observation-archive/ogimet-synop-40872.json";
if(!fs.existsSync(observationPath))throw new Error("OGIMET observation archive missing: "+observationPath);
const observationArchive=JSON.parse(fs.readFileSync(observationPath,"utf8"));
const observedWindows=observationArchive.daily_non_overlapping_24h||[];
const headers={authorization:"Bearer "+token,accept:"application/vnd.github+json","x-github-api-version":"2022-11-28"};
const api="https://api.github.com/repos/"+repository+"/actions/artifacts?per_page=100";
console.log("Listing GitHub forecast archive artifacts");
const listing=await fetch(api,{headers,signal:AbortSignal.timeout(20000)});
if(!listing.ok)throw new Error("GitHub Actions artifact listing failed: HTTP "+listing.status+" "+(await listing.text()).slice(0,400));
const listingJson=await listing.json(),cutoff=Date.now()-30*86400000;
console.log("Artifact inventory returned "+(listingJson.artifacts||[]).length+" records");
const artifacts=(listingJson.artifacts||[]).filter(a=>a.name?.startsWith("baranban-forecast-archive-")&&!a.expired&&Date.parse(a.created_at)>=cutoff&&a.archive_download_url).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,20);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"baranban-verification-"));
const archives=[],downloadErrors=[];
console.log("Forecast artifacts selected for verification: "+artifacts.length+"; observation windows: "+observedWindows.length);
async function loadArtifact(artifact){try{console.log("Downloading forecast artifact "+artifact.id);const response=await fetch(artifact.archive_download_url,{headers,signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error("download HTTP "+response.status);const zipPath=path.join(temp,String(artifact.id)+".zip");fs.writeFileSync(zipPath,Buffer.from(await response.arrayBuffer()));const names=execFileSync("unzip",["-Z1",zipPath],{encoding:"utf8",timeout:20000}).split(/\r?\n/).filter(x=>x.endsWith(".json"));if(!names.length)throw new Error("artifact zip contains no JSON archive");for(const name of names){const raw=execFileSync("unzip",["-p",zipPath,name],{encoding:"utf8",maxBuffer:60*1024*1024,timeout:20000});const parsed=JSON.parse(raw);if(parsed.archive_schema_version==="1.0.0"&&Array.isArray(parsed.products))archives.push(parsed);}return;}catch(error){downloadErrors.push({artifact_id:artifact.id,name:artifact.name,error:String(error)});}}
for(let i=0;i<artifacts.length;i+=4)await Promise.all(artifacts.slice(i,i+4).map(loadArtifact));
const localDir="artifacts/forecast-archive";if(fs.existsSync(localDir)){for(const name of fs.readdirSync(localDir).filter(x=>x.endsWith(".json"))){const parsed=JSON.parse(fs.readFileSync(path.join(localDir,name),"utf8"));archives.push(parsed);}}
archives.sort((a,b)=>Date.parse(a.generated_at_utc)-Date.parse(b.generated_at_utc));
const pairs=[],pairErrors=[];for(const archive of archives){const built=buildVerificationPairs(archive,observedWindows,{timezone:observationArchive.target?.timezone||"Asia/Tehran"});pairs.push(...built.pairs);pairErrors.push(...built.errors.map(e=>({...e,archive_id:archive.archive_id})));}
console.log("Loaded "+archives.length+" forecast archives; paired "+pairs.length+" regional 24h observations");
const metrics=scoreVerificationPairs(pairs,{minimumSamples:30});
const status=pairs.length===0?"awaiting_forecast_observation_overlap":pairs.length<30?"collecting_samples":"preliminary_regional_proxy";
const report={report_schema_version:"1.0.0",generated_at_utc:new Date().toISOString(),status,repository,forecast_artifacts_listed:artifacts.length,forecast_archives_loaded:archives.length,observation_archive_id:observationArchive.archive_id,observation_report_count:observationArchive.summary?.report_count??null,observation_precipitation_intervals:observationArchive.summary?.precipitation_interval_count??null,available_non_overlapping_24h_windows:observedWindows.length,forecast_observation_pair_count:pairs.length,forecast_archive_ids:[...new Set(archives.map(a=>a.archive_id))],download_errors:downloadErrors,product_errors:pairErrors,metrics,pairs,limitations:["Bandar-e-Dayyer is a regional proxy 31.7 km from Abadan, not a direct Abadan rain gauge.","Only exact non-overlapping 24-hour windows ending at 18:00 UTC are paired; no missing intervals are filled.","Forecast issue time is archive retrieval time because authoritative model initialization time is not exposed.","Regional-proxy scores do not approve calibration or operational probability policy."]};
const output="artifacts/verification/verification-report.json";fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
fs.rmSync(temp,{recursive:true,force:true});
console.log(JSON.stringify({output,status,forecast_artifacts_listed:artifacts.length,forecast_archives_loaded:archives.length,available_non_overlapping_24h_windows:observedWindows.length,forecast_observation_pair_count:pairs.length,download_errors:downloadErrors.length,product_errors:pairErrors.length,groups:metrics.groups.map(g=>({type:g.type,model:g.model,lead_bin:g.lead_bin,sample_count:g.sample_count,status:g.status}))},null,2));