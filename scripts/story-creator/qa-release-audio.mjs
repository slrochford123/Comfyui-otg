// Exact active TEST artifact, isolated data and private loopback listener.
// Uses existing shared physical-GPU admission; never restarts managed services.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import {createRequire} from 'node:module';
const Database=createRequire(import.meta.url)('better-sqlite3');
const root=process.argv[2];
const profile=process.argv[3]||'separation';assert(['separation','creation','generation','image'].includes(profile));
assert(/^\/home\/shawn-rochford\/AI\/research\/release-qualification-[\w-]+$/.test(root||''));
const out=fs.mkdtempSync(path.join(root,'audio-'));
const data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
// Dedicated copied worker code; reuse installed models/venv read-only. The live
// TEST and PROD workers and their engine configurations are not overwritten.
const engineFile=path.join(out,'engines.json');
const engines=JSON.parse(fs.readFileSync('/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json','utf8'));
engines.remote.root='/mnt/otg_bulk/release-audio-qualification-20261101/runtime/test/unified-audio';
fs.writeFileSync(engineFile,JSON.stringify(engines,null,2),{mode:0o600});
const target=fs.realpathSync(process.argv[4]||'/home/shawn-rochford/AI/deploy/otg-test/current');
assert(target.startsWith('/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-'));
const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const live=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(v=>v.includes('=')).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
assert.equal(live.OTG_ENV,'test');assert(live.OTG_MEDIA_ADMISSION_CONFIG);
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(3308,'127.0.0.1',()=>s.close(resolve));});
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',PORT:'3308',HOSTNAME:'127.0.0.1',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),AUTH_COOKIE_NAME:'release_audio_qa',ADMIN_USER_IDS:'',ADMIN_IDENTIFIERS:'',
  OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_PERSISTENT_DATA_ROOT:data,OTG_RUNTIME_ROOT:path.join(out,'runtime'),OTG_CONFIG_ROOT:path.join(out,'config'),OTG_DEVICE_OUTPUT_ROOT:path.join(data,'devices'),OTG_WORKER_CONTROL_STORE_DIR:path.join(data,'worker-control'),OTG_MEDIA_GPU_QUEUE_DB:path.join(data,'media-gpu-queue/queue.sqlite'),
  OTG_AUDIO_EDITING_ENABLED:'1',OTG_AUDIO_ENGINE_CONFIG:engineFile,OTG_MEDIA_GPU_ROUTING:'1',OTG_MEDIA_ADMISSION_CONFIG:live.OTG_MEDIA_ADMISSION_CONFIG,
  OTG_VOICE_GPU_LOCK_FILE:'/home/shawn-rochford/AI/runtime/test/voice-gpu.lock',OPENAI_API_KEY:'',OPENAI_ADMIN_API_KEY:'',OPENAI_KILL_SWITCH:'true',NEXT_TELEMETRY_DISABLED:'1',STORY_CREATOR_CPU_ROOT:live.STORY_CREATOR_CPU_ROOT};
const result={ok:false,out,target,profile,prodChanged:false,managedTestChanged:false,checks:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const log=fs.openSync(path.join(out,'server.log'),'w',0o600);
const server=spawn(process.execPath,['server.js'],{cwd:target,env,stdio:['ignore',log,log]});
async function idle(){for(const url of ['http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188']){const r=await fetch(url+'/queue',{signal:AbortSignal.timeout(5000)});assert(r.ok);const q=await r.json();assert.deepEqual(q.queue_running,[]);assert.deepEqual(q.queue_pending,[]);}}
try{
  let ready=false;for(let i=0;i<60;i++){try{ready=(await fetch('http://127.0.0.1:3308/api/healthz')).ok;}catch{}if(ready)break;await pause(500);}assert(ready);
  for(const gpu of ['rtx3090','rtx5060ti']){
    await idle();console.log('Running real '+profile+' qualification on '+gpu);
    const script={separation:'audio-editing-api-test.mjs',creation:'audio-editing-create-test.mjs',generation:'audio-editing-generation-test.mjs',image:'story-creator/qa-native-image.mjs'}[profile];
    const child=spawn(process.execPath,['scripts/'+script],{cwd:process.cwd(),env:{...process.env,AUDIO_QA_BASE:'http://127.0.0.1:3308',AUDIO_QA_GPU:gpu,AUDIO_QA_SEPARATOR:'bandit'},stdio:['ignore','pipe','pipe']});
    let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output+=b;process.stdout.write(b);});
    const code=await new Promise(r=>child.once('exit',r));fs.writeFileSync(path.join(out,gpu+'.log'),output,{mode:0o600});result.checks.push({gpu,exitCode:code});assert.equal(code,0);
  }
  result.ok=true;
}catch(error){result.error=error.stack;console.error(error.message);process.exitCode=1;}
finally{
  // Completion of a test client does not mean the dispatcher's durable release
  // intent has been acknowledged. Keep the isolated server until that drains.
  let drained=false;
  for(let i=0;i<40;i++){
    const file=path.join(data,'media-gpu-queue/queue.sqlite');
    if(!fs.existsSync(file)){drained=true;break;}
    const db=new Database(file,{readonly:true});
    try{drained=!db.prepare("SELECT 1 FROM media_jobs WHERE status NOT IN ('completed','failed','canceled') OR admissionToken IS NOT NULL LIMIT 1").get();}finally{db.close();}
    if(drained)break;await pause(500);
  }
  result.reservationsReleased=drained;
  if(drained){
    server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),pause(5000)]);
    if(server.exitCode===null&&!server.signalCode)server.kill('SIGKILL');
  }else{
    result.cleanupPending=true;result.serverPid=server.pid;result.ok=false;process.exitCode=1;
    console.error('Isolated QA work/reservation remains; server retained for safe reconciliation.');server.unref();
  }
  fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({ok:result.ok,out}));
}
