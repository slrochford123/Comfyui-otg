// Existing Dialogue Replacement route, original synthetic reference only.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {audioTestClient} from "./audio-editing-test-client.mjs";
const runtime="/home/shawn-rochford/AI/runtime/test/unified-audio";
const root=path.join(runtime,"evidence",`dialogue-api-${Date.now()}`);fs.mkdirSync(root,{recursive:true});
const c=await audioTestClient(),report={startedAt:new Date().toISOString(),checks:[]};
try{
  let session=(await c.post({action:"new"})).session;
  const original=path.join(runtime,"evidence/native/conversation-30s.mp4");
  session=await c.upload(session,original,"original-qa-conversation-30s.mp4");
  session=await c.upload(session,path.join(runtime,"evidence/auk-3090-resident-r3/flash-female.wav"),"original-synthetic-reference.wav");
  const saved=await c.post({action:"save-voice",sessionId:session.id,assetId:session.assets.at(-1).id,name:"Original QA dialogue reference"});
  const models=await c.request("/api/voice/models"),voice=models.items.find(v=>v.voiceId===saved.voice.voiceId);assert(voice?.path);
  const handoff=await c.post({action:"prepare-dialogue",sessionId:session.id});
  const analysis=await c.request("/api/production/audio/analyze-clip",{sourcePath:handoff.source.path,sourceFileName:handoff.source.name,expectedSpeakerCount:2});
  assert(analysis.voices?.length);report.analysis={duration:analysis.durationSeconds,separation:analysis.separation.tool,diarization:analysis.diarization.tool,lanes:analysis.voices.length};
  report.checks.push("Authorized handoff to actual legacy speaker analysis");
  const dub=await c.request("/api/production/audio/dub-preview",{sourcePath:handoff.source.path,sourceFileName:handoff.source.name,title:"original_qa_dialogue_regression",voiceMappings:[{voiceId:"speaker_1",voicePath:voice.path,engine:"seed-vc",dubMode:"preserve_performance",segments:[{start:0,end:5}]}],audioClipAnalysis:analysis,dubMode:"preserve_performance"});
  fs.writeFileSync(path.join(root,"dub-response.json"),JSON.stringify({url:dub.previewVideoUrl,file:dub.previewVideoPath},null,2));
  const file=await c.download({url:dub.previewVideoUrl},path.join(root,"dialogue-replaced-30s.mp4"));
  const meta=JSON.parse(execFileSync("ffprobe",["-v","error","-count_frames","-show_streams","-show_format","-of","json",file]));
  assert(Math.abs(Number(meta.format.duration)-30)<.05);assert.equal(Number(meta.streams.find(s=>s.codec_type==="video").nb_read_frames),720);
  const hash=f=>execFileSync("ffmpeg",["-v","error","-i",f,"-map","0:v:0","-c:v","copy","-f","hash","-hash","sha256","-"]).toString().trim();assert.equal(hash(file),hash(original));
  report.checks.push("Real Seed-VC dialogue conversion and unchanged 30-second video stream");report.file=file;report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,"results.json"),JSON.stringify(report,null,2));await c.logout();console.log(JSON.stringify({root,passed:report.passed,error:report.error},null,2));}
