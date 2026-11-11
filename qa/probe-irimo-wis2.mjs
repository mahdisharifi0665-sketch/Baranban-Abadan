import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import mqtt from "mqtt";
const topic="origin/a/wis2/ir-irimo/data/recommended/weather/surface-based-observations/synop";
const metadataUrl="https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items/urn%3Awmo%3Amd%3Air-irimo%3Areco.surface-based-observations.synop?f=html";
const brokers=[
 {id:"meteo-fr",url:"mqtts://everyone:everyone@globalbroker.meteo.fr:8883"},
 {id:"noaa-nws",url:"mqtts://everyone:everyone@wis2globalbroker.nws.noaa.gov:8883"},
 {id:"cma",url:"mqtts://everyone:everyone@gb.wis.cma.cn:8883"},
 {id:"inmet",url:"mqtts://everyone:everyone@globalbroker.inmet.gov.br:8883"}
];
const runId=process.env.GITHUB_RUN_ID||"manual";
function collectLinks(value,out=[],depth=0){if(depth>8||value===null||typeof value!=="object")return out;if(Array.isArray(value)){for(const x of value)collectLinks(x,out,depth+1);return out;}if(typeof value.href==="string")out.push({rel:typeof value.rel==="string"?value.rel:null,href:value.href,type:typeof value.type==="string"?value.type:null});for(const v of Object.values(value))if(v&&typeof v==="object")collectLinks(v,out,depth+1);return out;}
function probeBroker(broker){
 return new Promise(resolve=>{
  const messages=[],started=Date.now();let connected=false,subscribed=false,finished=false,error=null,client;
  const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);try{client?.end(true);}catch{}resolve({broker_id:broker.id,connected,subscribed,error,elapsed_ms:Date.now()-started,message_count:messages.length,station_40872_message_count:messages.filter(m=>m.station_40872_match).length,messages});};
  let timer=setTimeout(finish,45000);
  try{
   client=mqtt.connect(broker.url,{connectTimeout:10000,reconnectPeriod:0,keepalive:15,clean:true,clientId:"baranban-abadan-"+runId+"-"+broker.id});
   client.on("connect",()=>{connected=true;client.subscribe(topic,{qos:0},err=>{if(err){error=String(err);return finish();}subscribed=true;});});
   client.on("message",(receivedTopic,payload)=>{const raw=payload.toString("utf8");let parsed=null;try{parsed=JSON.parse(raw);}catch{}const searchable=raw+" "+JSON.stringify(parsed||{});messages.push({received_at_utc:new Date().toISOString(),topic:receivedTopic,payload_sha256:createHash("sha256").update(payload).digest("hex"),payload_bytes:payload.length,station_40872_match:/(?:\b40872\b|0-20000-0-40872)/.test(searchable),wigos_station_hints:[...new Set(searchable.match(/0-\d{5}-0-\d{4,6}/g)||[])].slice(0,10),links:collectLinks(parsed||{}).slice(0,12),message_preview:raw.slice(0,1800)});if(messages.length>=50)finish();});
   client.on("error",err=>{error=String(err);finish();});
   client.on("close",()=>{if(!finished&&!connected){error=error||"connection_closed_before_connect";finish();}});
  }catch(err){error=String(err);clearTimeout(timer);finish();}
  // The timer is cleared by finish; every broker probe has a strict 45-second bound.
 });
}
const results=await Promise.all(brokers.map(probeBroker));
const uniqueMessages=new Map();for(const result of results)for(const m of result.messages){const key=m.payload_sha256;if(!uniqueMessages.has(key))uniqueMessages.set(key,m);}
const all=[...uniqueMessages.values()];
const status=all.some(m=>m.station_40872_match)?"station_40872_notification_seen":results.some(r=>r.subscribed)?"subscribed_no_station_40872_notification_during_window":results.some(r=>r.connected)?"connected_but_subscription_unverified":"broker_connection_failed";
const report={schema_version:"1.0.0",generated_at_utc:new Date().toISOString(),provider:"IRIMO WIS2 SYNOP",status,topic,metadata_url:metadataUrl,policy:"recommended",brokers:results.map(({messages,...x})=>x),unique_message_count:all.length,station_40872_notification_count:all.filter(m=>m.station_40872_match).length,messages:all.slice(0,50),limitations:["A successful MQTT subscription verifies notification transport only; it does not prove station-specific completeness or decode precipitation values.","WIS2 notification payloads may point to external BUFR data objects. This probe records notification metadata and hashes only; no BUFR decoding or operational ingestion is enabled.","No WIS2 message is treated as an Abadan observation unless its station identifier and metadata are independently verified."]};
const output="artifacts/observation-archive/irimo-wis2-probe.json";fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({output,status,brokers:report.brokers.map(x=>({broker_id:x.broker_id,connected:x.connected,subscribed:x.subscribed,error:x.error,message_count:x.message_count,station_40872_message_count:x.station_40872_message_count})),unique_message_count:report.unique_message_count},null,2));
