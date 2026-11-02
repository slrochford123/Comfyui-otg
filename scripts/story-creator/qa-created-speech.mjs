import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='/home/shawn-rochford/AI/research/release-qualification-20261101-DYHhxBWc';
const runtime='/home/shawn-rochford/AI/runtime/test/story-talkback-20261101';
async function call(endpoint,data={}){
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({jobId:crypto.randomUUID(),...data});
    const r=http.request({socketPath:path.join(runtime,'worker.sock'),path:endpoint,method:endpoint==='/health'?'GET':'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{const v=JSON.parse(text);assert(v.ok,v.error);resolve(v);}catch(e){reject(e);}});
    });r.setTimeout(120000,()=>r.destroy(Error('Transcription timeout')));r.on('error',reject);r.end(endpoint==='/health'?undefined:body);
  });
}
const report={paidCalls:0,gpuInference:false,checks:[],caveat:'Automated transcription is not a subjective voice-identity or listening-quality score.'};
assert.equal((await call('/health')).busy,false);
for(const [gpu,folder] of [['rtx3090','create-api-rtx3090-1793577198972'],['rtx5060ti','create-api-rtx5060ti-1793577253175']]){
  for(const [file,expected] of [['original-voice.wav','Welcome home. It is wonderful to see you.'],['character-new-dialogue.wav','The coffee is ready. Please sit beside the window.']]){
    const full='/home/shawn-rochford/AI/runtime/test/unified-audio/evidence/'+folder+'/'+file;
    const actual=await call('/transcribe',{audio:fs.readFileSync(full).toString('base64'),language:'en'});
    const words=s=>(s.toLowerCase().match(/[a-z]+/g)||[]).join(' ');
    report.checks.push({gpu,file:full,expected,transcript:actual.text,exactNormalizedMatch:words(expected)===words(actual.text)});
  }
}
report.ok=report.checks.every(c=>c.exactNormalizedMatch);
fs.writeFileSync(path.join(root,'created-speech-content.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
