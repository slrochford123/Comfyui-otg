// Bounded longer-dialogue and expressive-speech integration checks; all voices original.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {audioTestClient} from "./audio-editing-test-client.mjs";
const gpu=process.env.AUDIO_QA_GPU||"rtx3090";assert(["rtx3090","rtx5060ti"].includes(gpu));
const runtime="/home/shawn-rochford/AI/runtime/test/unified-audio";
const root=path.join(runtime,"evidence",`speech-quality-${gpu}-${Date.now()}`);fs.mkdirSync(root,{recursive:true});
const c=await audioTestClient(),report={gpu,startedAt:new Date().toISOString(),cases:[]};
const cases=[
  {name:"long-dialogue",text:"Welcome to our studio. Today we will prepare a scene with two friends meeting at a quiet cafe. The music should remain gentle, the footsteps should sound natural, and every spoken word should stay clear.",description:"A natural, clear adult male voice, warm and conversational.",expression:"",variant:"flash"},
  {name:"soft-dialogue",text:"Please come inside. You are safe here with me.",description:"A soft, comforting adult female voice, clear and natural.",expression:"A gentle quiet whisper, calm and reassuring.",variant:"base"},
  {name:"happy-dialogue",text:"That is a lovely surprise. I am so happy.",description:"A warm, natural adult female voice, friendly and relaxed.",expression:"Happy, with a brief natural laugh between phrases.",variant:"flash"},
];
try{
  let session=(await c.post({action:"new"})).session;report.sessionId=session.id;
  for(const test of cases.filter(test=>!process.env.AUDIO_QA_CASES||process.env.AUDIO_QA_CASES.split(",").includes(test.name))){
    session=await c.generate(session,"speech",{...test,seconds:5,seed:3232},undefined,gpu);
    const asset=session.assets.filter(a=>a.origin===`AuK-${test.variant}`).at(-1);assert(asset);
    const file=await c.download(asset,path.join(root,test.name+".wav"));
    report.cases.push({...test,file,duration:asset.duration,status:"generated; speech/content evaluation pending"});
    if(test.name==="long-dialogue")assert(asset.duration>8,"Long dialogue was not assembled beyond one short segment");
    if(test.name==="soft-dialogue"){
      session=await c.generate(session,"enhance",{engine:"mossformer",target:"speech",strength:.35},asset.id,gpu);
      const clean=session.assets.filter(a=>a.origin==="MossFormer2-SE-48K").at(-1);assert(Math.abs(clean.duration-asset.duration)<.001);
      const cleaned=await c.download(clean,path.join(root,"soft-dialogue-enhanced.wav"));
      report.cases.push({...test,name:"soft-dialogue-enhanced",file:cleaned,duration:clean.duration,status:"generated; speech/content evaluation pending"});
    }
    fs.writeFileSync(path.join(root,"progress.json"),JSON.stringify(report,null,2));
  }report.processingPassed=true;
}catch(error){report.processingPassed=false;report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,"results.json"),JSON.stringify(report,null,2));await c.logout();console.log(JSON.stringify({root,processingPassed:report.processingPassed,error:report.error},null,2));}
