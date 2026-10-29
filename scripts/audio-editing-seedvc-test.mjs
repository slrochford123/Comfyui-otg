// Actual legacy Seed-VC regression using only two original synthetic QA voices.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {audioTestClient} from "./audio-editing-test-client.mjs";
const runtime="/home/shawn-rochford/AI/runtime/test/unified-audio";
for(const port of [8188,8189]){
  const res=await fetch(`http://100.75.162.64:${port}/queue`);assert(res.ok);const q=await res.json();assert(q.queue_running.length===0&&q.queue_pending.length===0,"Existing GPU work is active; no conversion started");
}
const proof=path.join(runtime,"evidence",`seedvc-api-${Date.now()}`);fs.mkdirSync(proof,{recursive:true});
const c=await audioTestClient(),report={startedAt:new Date().toISOString(),engine:"seed-vc",source:"Original synthetic QA speech; no real human cloned"};
try{
  let session=(await c.post({action:"new"})).session;
  const target=path.join(runtime,"evidence/auk-3090-resident-r3/flash-female.wav");
  const performance=path.join(runtime,"evidence/auk-3090-resident-r3/flash-male.wav");
  session=await c.upload(session,target,"authorized-original-synthetic-reference.wav");
  const saved=await c.post({action:"save-voice",sessionId:session.id,assetId:session.assets.at(-1).id,name:"Original synthetic QA conversion reference"});assert(saved.voice.voiceId);
  const library=await c.request("/api/voice/models"),voice=library.items.find(v=>v.voiceId===saved.voice.voiceId);assert(voice?.path);
  const form=new FormData();form.set("performance_audio",new File([fs.readFileSync(performance)],"original-synthetic-performance.wav"));form.set("voice_path",voice.path);form.set("engine","seed-vc");form.set("dub_mode","preserve_performance");form.set("title","original_synthetic_seedvc_qa");
  const result=await c.postForm("/api/voice/dub",form);assert.equal(result.conversionMode,"seed-vc-reference");assert.equal(result.sourceSpeechMode,"source-performance");
  const file=await c.download({url:result.url},path.join(proof,"converted.wav"));
  const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",file]));
  report.duration=Number(probe.format.duration);assert(Math.abs(report.duration-5)<.2);report.passed=true;report.file=file;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(proof,"results.json"),JSON.stringify(report,null,2));await c.logout();console.log(JSON.stringify({proof,passed:report.passed,error:report.error},null,2));}
