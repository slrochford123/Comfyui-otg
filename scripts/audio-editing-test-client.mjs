import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";

export async function audioTestClient(){
  const base=process.env.AUDIO_QA_BASE||"http://100.75.162.64:3308";
  assert(/^http:\/\/100\.75\.162\.64:(3308|3001)$/.test(base));
  const username=`audioqa_${crypto.randomBytes(5).toString("hex")}`,password=crypto.randomBytes(24).toString("base64url");
  const signup=await fetch(base+"/api/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,email:username+"@test.invalid",password})});assert(signup.ok);
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({identifier:username,password})});assert(login.ok);
  const cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");assert(cookie);
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
      await new Promise(r=>setTimeout(r,800));
    }throw Error("TEST operation timed out");
  }
  async function upload(session,file,name){
    const form=new FormData();form.set("session",session.id);form.set("file",new File([fs.readFileSync(file)],name));
    const res=await fetch(base+"/api/edit-video/audio",{method:"POST",headers:{cookie},body:form}),data=await res.json();assert(res.ok&&data.ok,data.error);
    return data.job?wait(session.id,data.job.id):data.session;
  }
  async function generate(session,operation,params={},assetId,gpu="rtx3090"){
    const data=await post({action:"process",sessionId:session.id,operation,params,assetId,gpu});
    return wait(session.id,data.job.id);
  }
  async function download(asset,file){
    const res=await fetch(base+asset.url+"&download=1",{headers:{cookie}});assert(res.ok);
    fs.writeFileSync(file,Buffer.from(await res.arrayBuffer()));return file;
  }
  return {base,post,get,upload,generate,download,request,
    postForm:async(route,form)=>{const res=await fetch(base+route,{method:"POST",headers:{cookie},body:form});const data=await res.json();assert(res.ok&&data.ok!==false,data.error||`HTTP ${res.status}`);return data;},
    postStatus:async body=>{const res=await fetch(base+"/api/edit-video/audio",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};},
    logout:()=>fetch(base+"/api/auth/logout",{method:"POST",headers:{cookie}})};
}
