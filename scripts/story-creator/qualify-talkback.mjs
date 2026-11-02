// Real CPU inference only. Uses an isolated pinned worker and synthetic text.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const [runtime, output] = process.argv.slice(2);
if (!['/home/shawn-rochford/AI/runtime/test/story-talkback-20261101','/mnt/otg_bulk/story-talkback-20261101-qualification'].includes(runtime) || !output) throw Error('Explicit isolated runtime and new evidence folder required');
fs.mkdirSync(output, {mode:0o700});
async function call(endpoint, data={}) {
  return new Promise((resolve,reject) => {
    const body=Buffer.from(JSON.stringify({jobId:randomUUID(),...data}));
    const request=http.request({socketPath:path.join(runtime,'worker.sock'),path:endpoint,method:endpoint==='/health'?'GET':'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},response=>{
      const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{try{const value=JSON.parse(Buffer.concat(parts));if(!value.ok)throw Error(value.error);resolve(value);}catch(error){reject(error);}});
    });request.setTimeout(600000,()=>request.destroy(Error('bounded inference timeout')));request.on('error',reject);request.end(endpoint==='/health'?undefined:body);
  });
}
function wer(a,b){a=a.toLowerCase().match(/[a-z0-9]+/g)||[];b=b.toLowerCase().match(/[a-z0-9]+/g)||[];let p=b.map((_,i)=>i+1);p.unshift(0);for(let i=1;i<=a.length;i++){const r=[i];for(let j=1;j<=b.length;j++)r[j]=Math.min(r[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=r;}return p[b.length]/Math.max(1,a.length);}
const results={device:'cpu',paidApiCalls:0,gpuInference:false,runs:[],limitations:['ASR agreement does not establish subjective voice quality.','Cold means first model use in this worker, not cleared OS caches.']};
const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2),{mode:0o600});
const health=await call('/health');assert.equal(health.device,'cpu');assert.equal(health.gpuAvailable,false);assert.equal(health.busy,false);
const text='Hello. I am ready to help you tell your story. We can develop the characters and the next scene together.';
const cases=[...['af_heart','am_puck','bf_isabella','bm_fable'].flatMap(voice=>['first','repeat'].map(run=>({engine:'paradee',voice,run,text}))),
  {engine:'paradee',voice:'af_heart',run:'long',text:'Mara stepped into the quiet cafe as sunlight crossed the wooden floor. Elin greeted her from a table beside the window. They had not met since their journey through the northern mountains. A small blue notebook rested beside two cups of coffee. Inside it was a map showing the path to an abandoned lighthouse. Mara wondered whether they should travel there before winter arrived. Elin suggested asking the old boat keeper for advice. They agreed to prepare carefully and leave the following morning. Outside, a bicycle bell rang as a delivery rider passed the door. The friends finished their breakfast and wrote a list of supplies. Their plan needed warm coats, fresh water, and a reliable lantern. Neither of them knew what they would discover along the coast. For now, they were happy to begin another adventure together. This is the final sentence of the story.'},
  {engine:'kokoro',voice:'female',run:'regression',text},
  ...['first','repeat'].map(run=>({engine:'bark',voice:'female',run,text:'Hello. I am ready to help you tell your story.'}))];
try{
  for(const input of cases){
    const start=performance.now();const value=await call('/tts',input);const file=`${input.engine}-${input.voice}-${input.run}.wav`;
    const bytes=Buffer.from(value.audio,'base64');assert.equal(bytes.toString('ascii',0,4),'RIFF');assert(value.durationSeconds>0);
    fs.writeFileSync(path.join(output,file),bytes,{mode:0o600});
    const deliveredSeconds=(performance.now()-start)/1000;
    const recognized=await call('/transcribe',{audio:value.audio,language:'en'});
    const {audio,...metrics}=value;
    const row={...input,file,deliveredSeconds,...metrics,transcript:recognized.text,wordErrorRate:wer(input.text,recognized.text)};
    results.runs.push(row);console.log(JSON.stringify(row));save();
    if(input.run==='long')assert.match(recognized.text,/final sentence/i,'Long reply ending was lost');
  }
  const embedded=await call('/embed',{texts:['Mara has a sister named Elin.']});assert.equal(embedded.vectors[0].length,384);
  results.embedding=true;results.transcription=true;results.ok=true;save();
}catch(error){results.ok=false;results.error=error.stack;save();throw error;}
