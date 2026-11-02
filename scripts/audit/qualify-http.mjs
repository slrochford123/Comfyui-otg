// Real local HTTP/FFmpeg rehearsal. No browser automation, GPU work or paid API calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3'), bcrypt = require('bcryptjs');
const evidence = path.resolve(process.argv[2] || ''), build = path.resolve(process.argv[3] || '');
const standalone = process.argv[4] === '--standalone';
if (!evidence.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-') || !build.startsWith(evidence+'/build-') || !fs.existsSync(path.join(build,'.next/BUILD_ID'))) throw Error('Expected completed isolated build');
const root = fs.mkdtempSync(path.join(evidence,'http-qa-')), data = path.join(root,'data'); fs.mkdirSync(data,{mode:0o700});
const result = {checks:[],gpuInferencePerformed:false,paidApiCalls:0,prodChanged:false,root,build,standalone,buildId:fs.readFileSync(path.join(build,'.next/BUILD_ID'),'utf8').trim()};
const record = (name,detail=true) => {result.checks.push({name,detail}); console.log(name);};
const base = 'http://127.0.0.1:3339';
await new Promise((resolve,reject)=>{const p=net.createServer();p.once('error',reject);p.listen(3339,'127.0.0.1',()=>p.close(resolve));});
const adminId=crypto.randomUUID(),adminPassword=crypto.randomBytes(24).toString('base64url');
const db=new Database(path.join(data,'otg.db'));
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,created_at TEXT,username TEXT)');
db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(adminId,'qa-admin@example.invalid',bcrypt.hashSync(adminPassword,12),new Date().toISOString(),'qa-admin');db.close();
const config=path.join(root,'engines.json');
fs.writeFileSync(config,JSON.stringify({python:'/usr/bin/python3',ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe',verified:{},notes:['CPU-only qualification fixture; AI engines deliberately unavailable.']}),{mode:0o600});
const log=fs.openSync(path.join(root,'server.log'),'w',0o600);
const server=spawn(process.execPath,standalone?['server.js']:['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3339'],{cwd:build,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',PORT:'3339',HOSTNAME:'127.0.0.1',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),AUTH_COOKIE_NAME:'audit_qa_session',ADMIN_USER_IDS:adminId,
  OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_PERSISTENT_DATA_ROOT:data,OTG_RUNTIME_ROOT:path.join(root,'runtime'),OTG_CONFIG_ROOT:path.join(root,'config'),OTG_DEVICE_OUTPUT_ROOT:path.join(data,'devices'),OTG_WORKER_CONTROL_STORE_DIR:path.join(data,'worker-control'),OTG_MEDIA_GPU_QUEUE_DB:path.join(data,'media-gpu-queue/queue.sqlite'),
  OTG_AUDIO_EDITING_ENABLED:'1',OTG_AUDIO_ENGINE_CONFIG:config,OTG_AUDIO_WORKER_SCRIPT:path.join(build,'scripts/audio-editing-worker.py'),OTG_MEDIA_GPU_ROUTING:'0',OPENAI_API_KEY:'',OPENAI_KILL_SWITCH:'true',OTG_ALLOW_ANY_USER:'false',COMFY_URL:'http://127.0.0.1:1',COMFYUI_URL:'http://127.0.0.1:1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+path.resolve('scripts/audit/offline-guard.cjs')}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function call(route,cookie='',body,method) {
  const response=await fetch(base+route,{method:method||(body===undefined?'GET':'POST'),headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {response,value:await response.json()};
}
async function login(username,password){const r=await call('/api/auth/login','',{identifier:username,password});assert.equal(r.response.status,200,JSON.stringify(r.value));return r.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
async function account(){const name='audit_'+crypto.randomBytes(5).toString('hex'),password=crypto.randomBytes(24).toString('base64url');assert.equal((await call('/api/auth/signup','',{username:name,email:name+'@test.invalid',password})).response.status,200);return {name,cookie:await login(name,password)};}
const audio='/api/edit-video/audio';
async function waitJob(cookie,session,id){const until=Date.now()+60000;while(Date.now()<until){const r=await call(`${audio}?session=${session}`,cookie);assert.equal(r.response.status,200,JSON.stringify(r.value));const j=r.value.jobs.find(x=>x.id===id);if(j?.status==='completed')return r.value;assert(!['failed','canceled'].includes(j?.status),JSON.stringify(j));await pause(200);}throw Error('CPU job timeout');}
try {
  let ready=false;for(let i=0;i<60;i++){try{ready=(await fetch(base+'/api/healthz')).ok;if(ready)break;}catch{}await pause(500);}assert(ready);record('candidate HTTP health');
  for(const [route,method] of [['Image','GET'],['comfy-image','GET'],['comfy/view','GET'],['comfy/history-image','GET'],['production/comfy-cache','GET'],['comfy-upload','POST'],['otg/generate','POST'],['queue/next','POST'],['queue/queue/next','POST'],['sync','POST'],['device-jobs/log','POST'],['characters/default-image','POST'],['jobs/queue','GET'],['debug-env','GET'],['envcheck','GET'],['vision-prompt','POST'],['enhance','POST'],['format-prompt','POST'],['ollama-ai/plan','POST'],['ollama-ai/write','POST'],['voice-lab/elevenlabs/design-preview','POST']]) {
    assert.equal((await fetch(base+'/api/'+route,{method})).status,401,route);
  }record('21 anonymous route denials');
  const a=await account(),b=await account(),admin=await login('qa-admin',adminPassword);record('signup and login without administrator escalation');
  assert.equal((await call('/api/debug-env',a.cookie)).response.status,403);
  const diagnostic=await call('/api/debug-env',admin);assert.equal(diagnostic.response.status,200);assert(!JSON.stringify(diagnostic.value).includes('/home/'));record('immutable admin authority and redacted diagnostics');
  const shell=await fetch(base+'/app',{headers:{cookie:a.cookie}});assert.equal(shell.status,200);const html=await shell.text();assert(html.includes('/_next/'));
  assert.equal(shell.headers.get('x-content-type-options'),'nosniff');assert(shell.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"));record('authenticated shell and security headers');
  assert.equal((await call('/api/otg/generate',a.cookie,{})).response.status,410);record('unused raw submission route safely retired');
  const created=await call(audio,a.cookie,{action:'new'});assert.equal(created.response.status,200);const session=created.value.session.id;
  assert.equal((await call(`${audio}?session=${session}`,b.cookie)).response.status,404);record('audio session owner isolation');
  const clip=path.join(root,'source.mp4');execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ac','2',clip]);
  const form=new FormData();form.set('session',session);form.set('file',new Blob([fs.readFileSync(clip)],{type:'video/mp4'}),'source.mp4');
  const uploaded=await fetch(base+audio,{method:'POST',headers:{cookie:a.cookie},body:form});const up=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(up));
  let state=await waitJob(a.cookie,session,up.job.id);record('streaming upload and real CPU audio extraction');
  const originalHash=crypto.createHash('sha256').update(fs.readFileSync(clip)).digest('hex');
  const source=state.session.assets.find(x=>x.id===state.session.sourceId);
  assert.equal((await fetch(base+source.url,{headers:{cookie:b.cookie}})).status,404);
  const range=await fetch(base+source.url,{headers:{cookie:a.cookie,range:'bytes=0-15'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);
  const head=await fetch(base+source.url,{method:'HEAD',headers:{cookie:a.cookie}});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);record('real owned video Range and HEAD; cross-owner denial');
  // Synthesized, labeled stem fixtures exercise mixing—not AI separation quality.
  const sessionRoot=path.join(data,'audio-editing',crypto.createHash('sha256').update(a.name).digest('hex'),session);
  const sf=path.join(sessionRoot,'session.json');const seeded=JSON.parse(fs.readFileSync(sf,'utf8'));
  for(const [kind,freq] of [['speech',330],['effects',660],['music',990]]){
    const file=path.join(sessionRoot,kind+'.wav');execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=48000`,'-t','5','-ac','2',file]);
    const id=crypto.randomUUID();seeded.assets.push({id,file,name:kind+'.wav',kind:'audio',duration:5,channels:2,sampleRate:48000,origin:'synthetic QA stem'});seeded.stems[kind]=id;
  }seeded.revision++;fs.writeFileSync(sf,JSON.stringify(seeded));
  const outputs=[];
  for(let mask=0;mask<8;mask++){
    state=(await call(`${audio}?session=${session}`,a.cookie)).value;
    const tracks=Object.fromEntries(['speech','effects','music'].map((kind,i)=>[kind,{...state.session.tracks[kind],keep:Boolean(mask&(1<<i)),gain:1,solo:false}]));
    const update=await call(audio,a.cookie,{action:'update',sessionId:session,revision:state.session.revision,edit:{tracks}});assert.equal(update.response.status,200,JSON.stringify(update.value));
    const start=await call(audio,a.cookie,{action:'process',sessionId:session,operation:'mix',gpu:'cpu'});assert.equal(start.response.status,200,JSON.stringify(start.value));
    state=await waitJob(a.cookie,session,start.value.job.id);const job=state.jobs.find(j=>j.id===start.value.job.id),asset=job.assets.find(x=>x.kind==='video');assert(asset);
    const delivered=await fetch(base+`${audio}?session=${session}&asset=${asset.id}`,{headers:{cookie:a.cookie}});assert.equal(delivered.status,200);
    const file=path.join(root,`mix-${mask}.mp4`);fs.writeFileSync(file,Buffer.from(await delivered.arrayBuffer()));
    const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));const video=probe.streams.find(s=>s.codec_type==='video'),sound=probe.streams.find(s=>s.codec_type==='audio');
    assert.equal(video.nb_frames,'120');assert.equal(video.r_frame_rate,'24/1');assert(Math.abs(Number(probe.format.duration)-5)<0.1);assert.equal(sound?.channels,2);
    outputs.push({mask,file,frames:video.nb_frames,duration:probe.format.duration,channels:sound.channels});
  }record('all eight CPU keep/remove mixes preserve duration, 120 frames, 24 FPS and stereo',outputs);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(clip)).digest('hex'),originalHash);record('original source unchanged');
  result.ok=true;
}catch(error){result.ok=false;result.error=error.stack||String(error);console.error(error);process.exitCode=1;}
finally {
  server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),pause(10000)]);if(server.exitCode===null&&!server.signalCode)server.kill('SIGKILL');fs.closeSync(log);
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({ok:result.ok,checks:result.checks.length,root}));
}
