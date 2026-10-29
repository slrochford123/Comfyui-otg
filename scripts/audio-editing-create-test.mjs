// Real authenticated TEST creation -> voice/character persistence -> timeline ->
// export test. All credentials are disposable process-local values, never logged.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
const base=process.env.AUDIO_QA_BASE||"http://100.75.162.64:3308";
const gpu=process.env.AUDIO_QA_GPU||"rtx3090";
assert(/^http:\/\/100\.75\.162\.64:(3308|3001)$/.test(base));
assert(["rtx3090","rtx5060ti"].includes(gpu));
const runtime="/home/shawn-rochford/AI/runtime/test/unified-audio";
const proof=path.join(runtime,"evidence",`create-api-${gpu}-${Date.now()}`);
fs.mkdirSync(proof,{recursive:true,mode:0o700});
const report={gpu,base,checks:[],sessions:[],startedAt:new Date().toISOString()};
const username=`audioqa_${crypto.randomBytes(5).toString("hex")}`,password=crypto.randomBytes(24).toString("base64url");
let cookie="";
async function request(route,body){
  const res=await fetch(base+route,{method:body?"POST":"GET",headers:{cookie,...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await res.json();assert(res.ok&&data.ok!==false,data.error||`HTTP ${res.status}`);return data;
}
const post=body=>request("/api/edit-video/audio",body);
const get=id=>request(`/api/edit-video/audio?session=${id}`);
async function wait(id,job){
  const deadline=Date.now()+600000;
  while(Date.now()<deadline){
    const data=await get(id),state=data.jobs.find(j=>j.id===job);
    if(state?.status==="completed")return data.session;
    if(["failed","canceled"].includes(state?.status))throw Error(state.stage);
    await new Promise(r=>setTimeout(r,1000));
  }throw Error("Isolated TEST creation exceeded its qualification timeout");
}
async function upload(session,file,name){
  const form=new FormData();form.set("session",session.id);form.set("file",new File([fs.readFileSync(file)],name));
  const res=await fetch(base+"/api/edit-video/audio",{method:"POST",headers:{cookie},body:form}),data=await res.json();
  assert(res.ok&&data.ok,data.error);return data.job?await wait(session.id,data.job.id):data.session;
}
async function generate(session,operation,params,assetId){
  const data=await post({action:"process",sessionId:session.id,operation,params,assetId,gpu});
  return wait(session.id,data.job.id);
}
async function download(session,asset,name){
  const res=await fetch(base+asset.url+"&download=1",{headers:{cookie}});assert(res.ok);
  const file=path.join(proof,name);fs.writeFileSync(file,Buffer.from(await res.arrayBuffer()));return file;
}
function inspect(file,duration,frames){
  const info=JSON.parse(execFileSync("ffprobe",["-v","error","-count_frames","-show_streams","-show_format","-of","json",file]));
  assert(Math.abs(Number(info.format.duration)-duration)<.05);
  const video=info.streams.find(s=>s.codec_type==="video");
  if(video){assert.equal(Number(video.nb_read_frames),frames);assert.equal(video.avg_frame_rate,"24/1");}
  return info;
}
try{
  await request("/api/auth/signup",{username,email:username+"@test.invalid",password});
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identifier:username,password})});
  assert(login.ok);cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");assert(cookie);
  let session=(await post({action:"new"})).session;report.sessions.push(session.id);
  session=await upload(session,path.join(runtime,"evidence/native/conversation-30s.mp4"),"qa-30s.mp4");
  session=await generate(session,"speech",{text:"Welcome home. It is wonderful to see you.",description:"A warm, clear adult female voice, calm and natural.",variant:"flash",seconds:5,seed:2424});
  const original=session.assets.filter(a=>a.origin==="AuK-flash").at(-1);assert(original);
  await download(session,original,"original-voice.wav");
  const name="Original QA Character "+Date.now();
  const saved=await post({action:"save-voice",sessionId:session.id,assetId:original.id,name,newCharacterName:name,text:"Welcome home. It is wonderful to see you."});
  assert(saved.voice?.voiceId);
  const characters=await request("/api/characters"),character=characters.items.find(c=>c.name===name);
  assert(character?.referenceAudioPath,"Character voice association was not persisted");
  const voices=await request("/api/voice/models");assert(voices.items.some(v=>v.voiceId===saved.voice.voiceId));
  report.checks.push({name:"new AuK voice saved to existing Voice Library and Character Library and reloaded",passed:true});
  session=await generate(session,"speech",{text:"The coffee is ready. Please sit beside the window.",characterId:character.id,variant:"flash",seconds:5,seed:2424});
  const cloned=session.assets.filter(a=>a.origin==="AuK-flash").at(-1);assert(cloned.id!==original.id);
  await download(session,cloned,"character-new-dialogue.wav");
  report.checks.push({name:"actual app reloaded character reference and generated different dialogue without training",passed:true});
  session=(await post({action:"update",sessionId:session.id,revision:session.revision,edit:{title:name,tracks:Object.fromEntries(["speech","effects","music"].map(k=>[k,{keep:false,gain:1,solo:false}])),ducking:false,clips:[{id:crypto.randomUUID(),assetId:cloned.id,lane:"speech",start:2,trimStart:0,length:cloned.duration,gain:1,fadeIn:.05,fadeOut:.1,loop:false,muted:false}]}})).session;
  session=await generate(session,"mix",{});
  const video=session.assets.filter(a=>a.origin==="edited-export").at(-1);
  const exported=await download(session,video,"character-dialogue-30s.mp4");inspect(exported,30,720);
  const hash=file=>execFileSync("ffmpeg",["-v","error","-i",file,"-map","0:v:0","-c:v","copy","-f","hash","-hash","sha256","-"]).toString().trim();
  assert.equal(hash(exported),hash(path.join(runtime,"evidence/native/conversation-30s.mp4")));
  report.checks.push({name:"short inserted dialogue preserves 30-second video, all 720 frames, 24 FPS and visual bitstream",passed:true});
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(proof,"results.json"),JSON.stringify(report,null,2),{mode:0o600});
  if(cookie)await fetch(base+"/api/auth/logout",{method:"POST",headers:{cookie}}).catch(()=>{});
  console.log(JSON.stringify({proof,passed:report.passed,error:report.error,checks:report.checks.length},null,2));
}
