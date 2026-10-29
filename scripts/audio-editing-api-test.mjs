// Real TEST HTTP upload/session/processing tests. Generated credentials remain
// process-local and are never written, printed, or sent outside this TEST host.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";

const base=process.env.AUDIO_QA_BASE||"http://100.75.162.64:3308";
const gpu=process.env.AUDIO_QA_GPU||"rtx3090";
const engine=process.env.AUDIO_QA_SEPARATOR||"tiger";
assert(["rtx3090","rtx5060ti"].includes(gpu));
assert(["tiger","bandit"].includes(engine));
if(!/^http:\/\/100\.75\.162\.64:(3308|3001)$/.test(base))throw Error("Only the explicit local TEST application is permitted.");
const root="/home/shawn-rochford/AI/runtime/test/unified-audio/evidence";
const proof=path.join(root,`api-${Date.now()}`);fs.mkdirSync(proof,{recursive:true,mode:0o700});
const report={startedAt:new Date().toISOString(),base,gpu,checks:[],sessions:[]};
async function account(){
  const username=`audioqa_${crypto.randomBytes(5).toString("hex")}`;
  const password=crypto.randomBytes(24).toString("base64url");
  const signup=await fetch(`${base}/api/auth/signup`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,email:`${username}@test.invalid`,password})});
  assert.equal(signup.status,200,"TEST fixture account creation failed");
  const response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identifier:username,password})});
  assert.equal(response.status,200,"TEST fixture login failed");
  const cookie=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
  assert(cookie,"No authenticated TEST cookie");
  return {username,cookie};
}
const user=await account();
async function post(body){
  const res=await fetch(`${base}/api/edit-video/audio`,{method:"POST",headers:{cookie:user.cookie,"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json();assert(res.ok&&data.ok,data.error||`HTTP ${res.status}`);return data;
}
async function get(id){
  const res=await fetch(`${base}/api/edit-video/audio?session=${id}`,{headers:{cookie:user.cookie}});
  const data=await res.json();assert(res.ok&&data.ok,data.error);return data;
}
async function wait(id,job){
  const end=Date.now()+180000;
  while(Date.now()<end){
    const data=await get(id);const status=data.jobs.find(j=>j.id===job);
    if(status?.status==="completed")return data;
    if(status?.status==="failed"||status?.status==="canceled")throw Error(status.stage);
    await new Promise(r=>setTimeout(r,700));
  }throw Error("TEST operation timed out");
}
try{
  const created=await post({action:"new"});let session=created.session;report.sessions.push(session.id);
  const form=new FormData();form.set("session",session.id);form.set("file",new File([fs.readFileSync(path.join(root,"native/conversation-5s.mp4"))],"conversation.mp4",{type:"video/mp4"}));
  const uploaded=await fetch(`${base}/api/edit-video/audio`,{method:"POST",headers:{cookie:user.cookie},body:form});
  const result=await uploaded.json();assert(uploaded.ok&&result.ok,result.error);
  session=(await wait(session.id,result.job.id)).session;
  report.checks.push({name:"authenticated multipart video upload and source extraction",passed:true});
  const separated=await post({action:"process",sessionId:session.id,operation:"separate",params:{engine},gpu});
  session=(await wait(session.id,separated.job.id)).session;
  assert(Object.keys(session.stems).length===3,"Missing real AI stems");
  report.checks.push({name:`actual TEST API to ${gpu} ${engine} inference and persisted stems`,passed:true});
  const cached=await post({action:"process",sessionId:session.id,operation:"separate",params:{engine},gpu});assert.equal(cached.cached,true);
  report.checks.push({name:"separation cache avoids another inference",passed:true});
  for(let mask=0;mask<8;mask++){
    const edit={title:`Audio QA mix ${mask}`,tracks:Object.fromEntries(["speech","effects","music"].map((s,i)=>[s,{keep:!!(mask&(1<<i)),gain:1,solo:false}])),clips:[],ducking:false};
    session=(await post({action:"update",sessionId:session.id,revision:session.revision,edit})).session;
    const mixed=await post({action:"process",sessionId:session.id,operation:"mix"});
    session=(await wait(session.id,mixed.job.id)).session;
    const video=session.assets.filter(a=>a.origin==="edited-export").at(-1);
    const response=await fetch(`${base}${video.url}&download=1`,{headers:{cookie:user.cookie}});assert(response.ok);
    const file=path.join(proof,`mix-${mask}.mp4`);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
    const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-count_frames","-show_streams","-show_format","-of","json",file]));
    const stream=probe.streams.find(s=>s.codec_type==="video"),audio=probe.streams.find(s=>s.codec_type==="audio");
    assert.equal(Number(stream.nb_read_frames),120);assert.equal(stream.avg_frame_rate,"24/1");assert.equal(audio.channels,2);assert(Math.abs(Number(probe.format.duration)-5)<.05);
    const range=await fetch(`${base}${video.url}`,{headers:{cookie:user.cookie,range:"bytes=0-31"}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
    report.checks.push({name:`AI-stem combination ${mask}: HTTP export, stereo, frames, FPS, duration, ranged download`,passed:true});
  }
  const stale=await fetch(`${base}/api/edit-video/audio`,{method:"POST",headers:{cookie:user.cookie,"content-type":"application/json"},body:JSON.stringify({action:"update",sessionId:session.id,revision:0,edit:{title:"stale"}})});assert.equal(stale.status,409);
  const other=await account();
  const forbidden=await fetch(`${base}/api/edit-video/audio?session=${session.id}`,{headers:{cookie:other.cookie}});assert.equal(forbidden.status,404);
  const anonymous=await fetch(`${base}/api/edit-video/audio`);assert.equal(anonymous.status,401);
  await fetch(`${base}/api/auth/logout`,{method:"POST",headers:{cookie:other.cookie}});
  report.checks.push({name:"anonymous, cross-owner and stale revision protection",passed:true});
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(proof,"results.json"),JSON.stringify(report,null,2),{mode:0o600});
  await fetch(`${base}/api/auth/logout`,{method:"POST",headers:{cookie:user.cookie}}).catch(()=>{});
  console.log(JSON.stringify({proof,passed:report.passed,checks:report.checks.length,error:report.error},null,2));
}
