// Real authenticated HTTP speech tests; no paid calls or media GPU operations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const [evidence,build]=process.argv.slice(2),live=process.argv.includes('--live');
const runtime=process.env.STORY_CREATOR_CPU_ROOT;
if(!evidence?.startsWith('/home/shawn-rochford/AI/research/story-talkback-')||!build?.startsWith(evidence+'/build-')||!runtime?.endsWith('/story-talkback-20261101'))throw Error('Explicit TEST evidence, build and CPU runtime required');
const out=fs.mkdtempSync(path.join(evidence,live?'live-speech-qa-':'speech-http-qa-'));
const data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
const buildId=fs.readFileSync(path.join(build,'.next/BUILD_ID'),'utf8').trim();
const base=live?'http://127.0.0.1:3001':'http://127.0.0.1:3338';
const result={ok:false,live,base,buildId,checks:[],speech:[],paidApiCalls:0,gpuInference:false,accountNames:[]};
const record=name=>{result.checks.push(name);console.log(name);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const log=fs.openSync(path.join(out,'server.log'),'w',0o600);
let server;
const cookies=[];
if(!live) server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3338'],{cwd:build,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),AUTH_COOKIE_NAME:'talkback_qa_session',OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_PERSISTENT_DATA_ROOT:data,OTG_RUNTIME_ROOT:path.join(out,'runtime'),OTG_CONFIG_ROOT:path.join(out,'config'),OTG_DEVICE_OUTPUT_ROOT:path.join(data,'devices'),OTG_WORKER_CONTROL_STORE_DIR:path.join(data,'worker-control'),OTG_MEDIA_GPU_QUEUE_DB:path.join(data,'media-gpu-queue/queue.sqlite'),OTG_AUDIO_EDITING_ENABLED:'0',OTG_MEDIA_GPU_ROUTING:'0',STORY_CREATOR_CPU_ROOT:runtime,OPENAI_API_KEY:'',OPENAI_KILL_SWITCH:'true',OTG_ALLOW_ANY_USER:'false',COMFY_URL:'http://127.0.0.1:1',COMFYUI_URL:'http://127.0.0.1:1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+path.resolve('scripts/audit/offline-guard.cjs')}});
async function call(route,cookie='',body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(30000),headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,value:await r.json(),headers:r.headers};}
async function account(){const name='talkbackqa_'+crypto.randomBytes(5).toString('hex'),password=crypto.randomBytes(24).toString('base64url');let r=await call('/api/auth/signup','',{username:name,email:name+'@test.invalid',password});assert.equal(r.status,200,JSON.stringify(r.value));r=await call('/api/auth/login','',{identifier:name,password});assert.equal(r.status,200);const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');cookies.push(cookie);result.accountNames.push(name);return cookie;}
async function speech(cookie,projectId,messageId,engine,voice){const start=performance.now();const input={projectId,messageId,engine,voice};const created=await call('/api/story-creator/speech',cookie,input);assert.equal(created.status,202,JSON.stringify(created.value));const duplicate=await call('/api/story-creator/speech',cookie,input);assert.equal(duplicate.status,200);assert.equal(duplicate.value.job.id,created.value.job.id);const jobId=created.value.job.id;const until=Date.now()+600000;
  while(Date.now()<until){const state=await call(`/api/story-creator/speech?projectId=${projectId}&jobId=${jobId}`,cookie);assert.equal(state.status,200);if(state.value.job.status==='completed'){const r=await fetch(base+state.value.url,{headers:{cookie}});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.toString('ascii',0,4),'RIFF');const file=engine+'-'+voice+'-'+messageId+'.wav';fs.writeFileSync(path.join(out,file),bytes,{mode:0o600});result.speech.push({engine,voice,file,duration:state.value.job.durationSeconds,deliveredSeconds:(performance.now()-start)/1000,jobId});return {...state.value,bytes};}assert(!['failed','cancelled'].includes(state.value.job.status),JSON.stringify(state.value));await pause(300);}throw Error('Speech timed out');}
try{
  let ready=false;for(let i=0;i<40;i++){try{ready=(await fetch(base+'/api/healthz')).ok;if(ready)break;}catch{}await pause(500);}assert(ready);
  if(live){const marker=await call('/story-talkback.json');assert.equal(marker.value.buildId,buildId);record('exact live TEST build marker');}
  assert.equal((await call('/api/story-creator/speech?projectId=missing')).status,401);
  const owner=await account(),other=await account();
  const project=await call('/api/story-creator/projects',owner,{title:'Talkback automated QA '+new Date().toISOString(),format:'short film',genre:'Drama'});assert.equal(project.status,201);const projectId=project.value.project.id;result.projectId=projectId;
  const cap=await call('/api/story-creator/speech?projectId='+projectId,owner);assert.equal(cap.value.capabilities.defaultEngine,'paradee');for(const engine of ['paradee','kokoro','bark'])assert(cap.value.capabilities.engines[engine]);record('authenticated model availability and Paradee default');
  const prompt='Hello. I am ready to help you tell your story. We can develop the characters and the next scene together.';
  const msg=await call('/api/story-creator/messages',owner,{projectId,role:'assistant',content:prompt});const messageId=msg.value.message.id;
  const bad=await call('/api/story-creator/speech',owner,{projectId,messageId,engine:'paradee',voice:'male'});assert.equal(bad.status,400);
  assert.equal((await call('/api/story-creator/speech',owner,{projectId,messageId,engine:'paradee',voice:'af_heart',padding:'x'.repeat(9000)})).status,413);record('invalid model voice pair and oversized JSON rejected');
  for(const voice of ['af_heart','am_puck','bf_isabella','bm_fable']){
    const done=await speech(owner,projectId,messageId,'paradee',voice);
    const cached=await call('/api/story-creator/speech',owner,{projectId,messageId,engine:'paradee',voice});assert.equal(cached.status,200);assert.equal(cached.value.job.id,done.job.id);
    const range=await fetch(base+done.url,{headers:{cookie:owner,range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
    assert.equal((await fetch(base+done.url,{headers:{cookie:other}})).status,404);
  }record('four real Paradee voices, in-flight deduplication, cache reuse, Range and owner isolation');
  const longText='Mara stepped into the quiet cafe as sunlight crossed the wooden floor. Elin greeted her from a table beside the window. They had not met since their journey through the northern mountains. A small blue notebook rested beside two cups of coffee. Inside it was a map showing the path to an abandoned lighthouse. Mara wondered whether they should travel there before winter arrived. Elin suggested asking the old boat keeper for advice. They agreed to prepare carefully and leave the following morning. Outside, a bicycle bell rang as a delivery rider passed the door. The friends finished their breakfast and wrote a list of supplies. Their plan needed warm coats, fresh water, and a reliable lantern. Neither of them knew what they would discover along the coast. For now, they were happy to begin another adventure together. This is the final sentence of the story.';
  if(!live){const longMsg=await call('/api/story-creator/messages',owner,{projectId,role:'assistant',content:longText});const done=await speech(owner,projectId,longMsg.value.message.id,'paradee','af_heart');const form=new FormData();form.set('projectId',projectId);form.set('language','en');form.set('audio',new File([done.bytes],'talkback.wav',{type:'audio/wav'}));const r=await fetch(base+'/api/story-creator/transcribe',{method:'POST',headers:{cookie:owner},body:form});const transcription=await r.json();assert.equal(r.status,200,JSON.stringify(transcription));assert.match(transcription.text,/final sentence/i);result.longTranscript=transcription.text;result.longSource=longText;record('real long unique reply and local transcription through app');
    const barkMsg=await call('/api/story-creator/messages',owner,{projectId,role:'assistant',content:'Hello. I am ready to help you tell your story.'});
    for(const voice of ['female','male'])await speech(owner,projectId,barkMsg.value.message.id,'bark',voice);record('real Bark female and male inference through authenticated app');
    const normal=await call('/api/story-creator/messages',owner,{projectId,role:'assistant',content:prompt});await speech(owner,projectId,normal.value.message.id,'kokoro','female');record('Kokoro regression through app');
  }
  const cancelMsg=await call('/api/story-creator/messages',owner,{projectId,role:'assistant',content:longText.repeat(10)});
  const queued=await call('/api/story-creator/speech',owner,{projectId,messageId:cancelMsg.value.message.id,engine:'paradee',voice:'af_heart'});assert.equal(queued.status,202);
  const cancel=await call('/api/story-creator/speech',owner,{projectId,jobId:queued.value.job.id,action:'cancel'});assert.equal(cancel.status,200);
  for(let i=0;i<30;i++){const state=await call(`/api/story-creator/speech?projectId=${projectId}&jobId=${queued.value.job.id}`,owner);if(state.value.job.status==='cancelled')break;if(i===29)throw Error('Cancellation failed');await pause(250);}record('bounded cancellation preserves written reply');
  result.ok=true;
}catch(error){result.error=error.stack;console.error(error.message);process.exitCode=1;}
finally{
  for(const cookie of cookies)await call('/api/auth/logout',cookie,{}).catch(()=>{});
  if(server){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),pause(5000)]);if(server.exitCode===null&&!server.signalCode)server.kill('SIGKILL');}
  fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({ok:result.ok,checks:result.checks.length,out,live}));
}
