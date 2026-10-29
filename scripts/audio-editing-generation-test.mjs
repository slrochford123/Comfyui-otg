// Qualify generated assets, cleanup, source handoff, overlapping tracks, ducking,
// gallery/library persistence and exact-duration export through authenticated HTTP.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {audioTestClient} from "./audio-editing-test-client.mjs";
const gpu=process.env.AUDIO_QA_GPU||"rtx3090";assert(["rtx3090","rtx5060ti"].includes(gpu));
const runtime="/home/shawn-rochford/AI/runtime/test/unified-audio";
const proof=path.join(runtime,"evidence",`generation-api-${gpu}-${Date.now()}`);fs.mkdirSync(proof,{recursive:true});
const c=await audioTestClient(),report={gpu,checks:[],sessions:[],startedAt:new Date().toISOString()};
const check=name=>{report.checks.push({name,passed:true});fs.writeFileSync(path.join(proof,"progress.json"),JSON.stringify(report,null,2));};
try{
  let session=(await c.post({action:"new"})).session;report.sessions.push(session.id);
  session=await c.upload(session,path.join(runtime,"evidence/stock/lion-silent-16s.mp4"),"lion-silent-16s.mp4");
  assert(!session.assets.some(a=>a.origin==="original-soundtrack"));check("silent source imported without fabricating original audio");
  session=await c.generate(session,"music",{prompt:"Instrumental gentle cafe jazz, piano and upright bass, no singing or speech.",seconds:12,seed:4242},undefined,gpu);
  const music=session.assets.filter(a=>a.origin.startsWith("ACE-Step")).at(-1);assert(music?.suggestedLane==="music");await c.download(music,path.join(proof,"music.wav"));check("real private ACE-Step music generated through app and assigned Music lane");
  session=await c.generate(session,"effects",{mode:"manual",prompt:"A wooden door opening then closing softly, one bell chime, no speech, no music.",seconds:4,seed:2323},undefined,gpu);
  const manual=session.assets.filter(a=>a.origin==="Sony Woosh-DFlow").at(-1);assert(manual);await c.download(manual,path.join(proof,"manual-effects.wav"));check("real prompted manual effects through app");
  session=await c.generate(session,"effects",{mode:"automatic",prompt:"A lion roaring in time with visible mouth movements, natural outdoor ambience, no music, no speech.",start:0,seconds:16,seed:4242},undefined,gpu);
  const auto=session.assets.filter(a=>a.origin==="Sony Woosh-DVFlow-8s").at(-1);assert(auto&&Math.abs(auto.duration-16)<.001);await c.download(auto,path.join(proof,"automatic-16s.wav"));check("real video-conditioned effects across 16-second overlapping windows through app");
  session=await c.upload(session,path.join(runtime,"evidence/auk-3090-resident-r3/flash-male.wav"),"original-synthetic-voice.wav");
  const speech=session.assets.filter(a=>a.origin==="upload"&&a.kind==="audio").at(-1);assert(speech);
  session=await c.generate(session,"enhance",{target:"speech",engine:"mossformer",strength:.35},speech.id,gpu);
  const enhanced=session.assets.filter(a=>a.origin==="MossFormer2-SE-48K").at(-1);assert(enhanced&&Math.abs(enhanced.duration-speech.duration)<.001);await c.download(enhanced,path.join(proof,"enhanced-speech.wav"));check("neural speech restoration through app preserves sample duration");
  for(const target of ["music","effects"]){
    session=await c.generate(session,"enhance",{target,engine:"ffmpeg",strength:.25},target==="music"?music.id:manual.id,"cpu");
    assert(session.assets.some(a=>a.origin==="enhance-ffmpeg"&&a.suggestedLane===target));
  }check("track-specific music and effects cleanup through app");
  const clip=(asset,lane,start,gain,length=asset.duration,loop=false)=>({id:crypto.randomUUID(),assetId:asset.id,lane,start,trimStart:0,length,gain,fadeIn:.1,fadeOut:.2,loop,muted:false});
  session=(await c.post({action:"update",sessionId:session.id,revision:session.revision,edit:{title:"Generated audio integration QA",tracks:Object.fromEntries(["speech","effects","music"].map(s=>[s,{keep:false,gain:1,solo:false}])),ducking:true,clips:[clip(music,"music",0,.2,16,true),clip(auto,"effects",0,.6),clip(manual,"effects",6,.4),clip(enhanced,"speech",2,1)]}})).session;
  session=await c.generate(session,"mix",{},undefined,"cpu");
  const video=session.assets.filter(a=>a.origin==="edited-export").at(-1);assert(video);
  const file=await c.download(video,path.join(proof,"generated-multitrack-16s.mp4"));
  const meta=JSON.parse(execFileSync("ffprobe",["-v","error","-count_frames","-show_streams","-show_format","-of","json",file]));
  assert(Math.abs(Number(meta.format.duration)-16)<.05);assert.equal(meta.streams.find(s=>s.codec_type==="audio").channels,2);
  const hash=f=>execFileSync("ffmpeg",["-v","error","-i",f,"-map","0:v:0","-c:v","copy","-f","hash","-hash","sha256","-"]).toString().trim();
  assert.equal(hash(file),hash(path.join(runtime,"evidence/stock/lion-silent-16s.mp4")));check("overlapping generated dialogue/music/effects, fades, loop and ducking export retains original 16-second video bitstream");
  await c.post({action:"save-gallery",sessionId:session.id,assetId:video.id});
  await c.post({action:"save-gallery",sessionId:session.id,assetId:music.id});
  const library=await c.request("/api/edit-video/audio?library=1");assert(library.items.some(a=>a.origin==="Saved audio"));check("edited video saved to owner gallery and generated audio to existing library");
  const handoff=await c.post({action:"prepare-dialogue",sessionId:session.id});assert(handoff.source?.path&&handoff.source.url);check("existing source passed to Dialogue Replacement without browser re-upload");
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(proof,"results.json"),JSON.stringify(report,null,2));await c.logout();console.log(JSON.stringify({proof,passed:report.passed,error:report.error,checks:report.checks.length},null,2));}
