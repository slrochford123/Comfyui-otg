import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {audioTestClient} from "./audio-editing-test-client.mjs";
const runtime="/home/shawn-rochford/AI/runtime/test/unified-audio";
const gpu=process.env.AUDIO_QA_GPU||"cpu";assert(["cpu","rtx5060ti"].includes(gpu));
const root=path.join(runtime,"evidence",`cancel-api-${gpu}-${Date.now()}`);fs.mkdirSync(root,{recursive:true});
const c=await audioTestClient(),report={checks:[],startedAt:new Date().toISOString()};
try{
  let session=(await c.post({action:"new"})).session;
  session=await c.upload(session,path.join(runtime,"evidence/native/conversation-30s.mp4"),"qa-cancel-30s.mp4");report.sessionId=session.id;
  const body={action:"process",sessionId:session.id,operation:"separate",gpu,params:{engine:"bandit"}};
  const starts=await Promise.all([c.postStatus(body),c.postStatus(body)]);
  assert.equal(starts.filter(r=>r.status===200).length,1,"Concurrent operation admission was not exclusive");
  assert.equal(starts.filter(r=>r.status!==200).length,1);
  const job=starts.find(r=>r.status===200).data.job;
  if(gpu!=="cpu"){
    let started=false;
    for(let i=0;i<120;i++){
      const data=await c.get(session.id),state=data.jobs.find(j=>j.id===job.id);
      if(/Loading BandIt|Separating/.test(state?.stage||"")){started=true;break;}
      if(["failed","canceled","completed"].includes(state?.status))throw Error("Remote worker was not active at cancellation test: "+state.stage);
      await new Promise(r=>setTimeout(r,500));
    }
    assert(started,"Remote model did not begin within the bounded cancellation qualification");
  }
  await c.post({action:"cancel",sessionId:session.id,jobId:job.id});
  let terminal;
  for(let i=0;i<40;i++){
    const data=await c.get(session.id);terminal=data.jobs.find(j=>j.id===job.id);
    if(terminal?.status==="canceled"){session=data.session;break;}
    await new Promise(r=>setTimeout(r,300));
  }
  assert.equal(terminal?.status,"canceled");assert(session.sourceId);assert.equal(Object.keys(session.stems).length,0);
  const again=await c.post({action:"cancel",sessionId:session.id,jobId:job.id});assert.equal(again.job.status,"canceled");
  report.checks.push({name:"exclusive admission, real owned-worker cancellation, idempotent cancel, original and session retained",passed:true});
  // Retry with CPU mix, no repeated model inference or GPU allocation.
  session=(await c.post({action:"update",sessionId:session.id,revision:session.revision,edit:{title:"Cancellation recovery",tracks:Object.fromEntries(["speech","music","effects"].map(s=>[s,{keep:false,gain:1,solo:false}])),clips:[],ducking:false}})).session;
  session=await c.generate(session,"mix",{},undefined,"cpu");assert(session.assets.some(a=>a.origin==="edited-export"));
  report.checks.push({name:"subsequent operation succeeds after cancellation without restarting a service",passed:true});report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,"results.json"),JSON.stringify(report,null,2));await c.logout();console.log(JSON.stringify({root,passed:report.passed,error:report.error},null,2));}
