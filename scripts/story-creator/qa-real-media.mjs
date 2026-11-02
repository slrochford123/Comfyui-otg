// Real local models through the exact candidate UI/API; local mocked director, no paid OpenAI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import Database from 'better-sqlite3';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||'');
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/experimental-tabs-\d{8}-\w+\/build-\w+\/source$/);
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'real-story-media-')),data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
const base='http://127.0.0.1:3308',report={ok:false,suite:'story-media-real',buildId:meta.buildId,realInference:true,paidCalls:0,checks:[],jobs:[],pageErrors:[]};
const external=process.env.STORY_QA_EXTERNAL==='1';
if(external)report.controller='isolated-production-host';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),record=name=>{report.checks.push(name);console.log(name);};
const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const live=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(v=>v.includes('=')).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
assert.equal(live.OTG_ENV,'test');assert.equal(live.OTG_MEDIA_GPU_ROUTING,'1');assert(live.OTG_MEDIA_ADMISSION_CONFIG);
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_API_KEY:'local-director-fixture',OPENAI_BASE_URL:'http://127.0.0.1:3391/v1',OPENAI_KILL_SWITCH:'0',NEXT_TELEMETRY_DISABLED:'1'};
if(process.env.STORY_QA_MODE==='prod'){env.OTG_ENV='prod';env.OTG_STORY_MEDIA_ENABLED='1';report.environment='prod';}
if(process.env.STORY_QA_MODE==='prod')env.OTG_PRIVATE_RESEARCH_MEDIA='1';
if(process.env.STORY_QA_REMOTE_CONFIG){env.OTG_STORY_QWEN_REMOTE_CONFIG=fs.realpathSync(process.env.STORY_QA_REMOTE_CONFIG);report.speechTransport='restricted-ssh';}
for(const key of ['OTG_MEDIA_GPU_ROUTING','OTG_MEDIA_ADMISSION_CONFIG','OTG_RUNTIME_ROOT','OTG_CONFIG_ROOT','OTG_VOICE_GPU_LOCK_FILE','OTG_MEDIA_3090_IMAGE_URL','OTG_MEDIA_3090_H3_URL','OTG_MEDIA_5060_URL','COMFYUI_IMAGE_URL','COMFYUI_VIDEO_URL','OTG_ASSET_IMAGE_COMFY_URL','OTG_ASSET_MAGE_COMFY_URL','OTG_CHARACTER_IMAGE_COMFY_URL','OTG_CHARACTER_MAGE_COMFY_URL','OTG_CHARACTER_IMAGE_FALLBACK_COMFY_URL'])if(live[key])env[key]=live[key];
// Never load a real provider key. Only loopback may receive the director request.
const provider=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const request=JSON.parse(body);const text=request.input.at(-1).content;
  const call={type:'function_call',id:'fc_local',call_id:'call_local',name:'create_story_media',arguments:JSON.stringify({operation:'image',subject:'character',name:'Buzzy',prompt:'A high-quality storybook character portrait of Buzzy, a charming white bunny with one pink left ear and one white right ear, big expressive eyes, full body, soft studio lighting, simple light blue background. No text.',sourceId:'',text:'',evidence:text})};
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{id:'resp_local',status:'completed',output:[call],usage:{input_tokens:50,output_tokens:80}}})+'\n\n');
});await new Promise(r=>provider.listen(3391,external?'100.75.162.64':'127.0.0.1',r));
const log=fs.openSync(path.join(out,'server.log'),'wx',0o600),server=external?null:spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3308'],{cwd:build,env,stdio:['ignore',log,log]});
let browser,context,page,projectId,active;
async function api(route,body){const r=await context.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});const result=await r.json();assert(r.ok(),result.error||`HTTP ${r.status()}`);return result;}
async function wait(id){
  active=id;const start=Date.now();
  for(let i=0;i<900;i++){
    const result=(await api('/api/story-creator/media?projectId='+projectId)).media.find(m=>m.id===id);assert(result);
    if(['failed','canceled','unknown'].includes(result.status))throw Error(`${result.engine}: ${result.error||result.status}`);
    if(result.status==='ready'){
      const response=await context.request.get(base+result.url+'&download=1');assert.equal(response.status(),200);
      const extension=result.command.operation==='voice'?'.wav':result.command.operation==='video'?'.mp4':'.png';
      const file=path.join(out,result.command.operation+'-'+id+extension);fs.writeFileSync(file,await response.body(),{mode:0o600});
      const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
      report.jobs.push({id,engine:result.engine,operation:result.command.operation,seconds:(Date.now()-start)/1000,file,probe,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});active=null;return result;
    }
    await sleep(2000);
  }throw Error('Job exceeded qualification wait; do not retry automatically.');
}
async function createFromCard(source,operation,prompt,text=''){
  const article=page.locator('article').filter({has:page.locator(`[src="${source.url}"]`)});
  await article.getByRole('button',{name:operation==='edit'?'Edit':operation==='video'?'Animate · 5 sec':source.command.operation==='voice'?'New dialogue':'Give a voice',exact:true}).click();
  await article.getByLabel(operation==='edit'?'What should change?':operation==='video'?'What happens in the video?':'Describe the voice or delivery',{exact:true}).fill(prompt);
  if(operation==='voice')await article.getByLabel('Dialogue',{exact:true}).fill(text);
  const posted=page.waitForResponse(r=>r.url()===base+'/api/story-creator/media'&&r.request().postDataJSON()?.action==='create');
  await article.getByRole('button',{name:'Create',exact:true}).click();const response=await posted;assert(response.ok(),await response.text());
  const job=(await response.json()).media;console.log(JSON.stringify({operation,id:job.id,out}));return wait(job.id);
}
try {
  for(const url of ['http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188']){const q=await fetch(url+'/queue',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());assert.deepEqual(q,{queue_running:[],queue_pending:[]},'Wait for existing owner jobs before qualification');}
  for(let i=0;i<100;i++){if(server&&server.exitCode!==null)throw Error('Candidate exited');try{if((await fetch(base+'/api/healthz')).ok)break;}catch{}await sleep(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});context=await browser.newContext({viewport:{width:412,height:915}});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));
  const username='storyreal_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');report.owner=username;
  await api('/api/auth/signup',{username,password,email:username+'@test.invalid'});await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
  projectId=(await api('/api/story-creator/projects',{title:'Buzzy real media qualification',format:'short film',genre:'Family'})).project.id;report.projectId=projectId;
  await page.goto(base+'/app?tab=machine');await page.locator('article').filter({has:page.getByRole('heading',{name:'Buzzy real media qualification',exact:true})}).getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByPlaceholder('Tell the Story Director what happens next...').fill('Generate a character image of Buzzy, a white bunny with one pink ear.');await page.getByRole('button',{name:'Send',exact:true}).click();
  let id;for(let i=0;i<100;i++){id=(await api('/api/story-creator/media?projectId='+projectId)).media[0]?.id;if(id)break;await sleep(300);}assert(id);
  console.log(JSON.stringify({operation:'image',id,out}));const image=await wait(id);assert.equal(report.jobs[0].probe.streams[0].width,1024);record('Real Krea 2 Turbo image delivered through Storyteller');
  await page.reload();await page.getByRole('img',{name:'Buzzy',exact:true}).waitFor();await page.getByRole('button',{name:'Save to Characters',exact:true}).click();await page.getByRole('button',{name:'Saved to Characters',exact:true}).waitFor();
  const character=(await api('/api/story-creator/media?projectId='+projectId)).characters.find(c=>c.name==='Buzzy');assert(character&&!character.hasVoice);record('Real generated character saved without a voice and recovered after reload');
  const edit=await createFromCard(image,'edit','Keep Buzzy the same white bunny with one pink ear. Change only the plain background to a sunny green meadow with small flowers.');assert.notEqual(report.jobs.at(-1).sha256,report.jobs[0].sha256);record('Real Fibo 2.0 edit of the exact Krea output; original preserved');
  const voice=await createFromCard(image,'voice','A cheerful, gentle adult storybook narrator with clear English pronunciation and a warm natural tone.','Hello, my name is Buzzy. Let us explore the meadow together.');
  const audio=report.jobs.at(-1).probe;assert(Number(audio.format.duration)>1);record('Real Qwen3-TTS voice design and playable audio');
  await api('/api/story-creator/media',{action:'save-voice',projectId,id:voice.id,characterId:character.id});
  const second=await createFromCard(voice,'voice','Keep the same warm, friendly voice.','The flowers are beautiful today. Follow me along the path.');assert(Number(report.jobs.at(-1).probe.format.duration)>1);record('Saved character reference reused for different Qwen3-TTS dialogue');
  const video=await createFromCard(edit,'video','Buzzy the white bunny with one pink ear gently waves at the camera and takes a small step in the sunny meadow. Stable full-body view, subtle natural movement, no text.');
  const stream=report.jobs.at(-1).probe.streams.find(s=>s.codec_type==='video');assert(stream);assert.equal(stream.width,608);assert.equal(stream.height,352);assert(Math.abs(Number(stream.duration)-5)<0.1);record('Real FastH3 five-second preview from the edited character image');
  assert.equal(stream.nb_frames,'120');assert.equal(stream.avg_frame_rate,'24/1');
  const decoded=execFileSync('/usr/bin/ffmpeg',['-v','error','-i',report.jobs.at(-1).file,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8',timeout:30000}).split('\n').filter(line=>line&&!line.startsWith('#'));
  assert.equal(decoded.length,120);assert(new Set(decoded.map(line=>line.split(',').at(-1).trim())).size>20);record('All 120 frames decode with motion; exactly five seconds at 24 FPS');
  const cancellation=await api('/api/story-creator/media',{action:'create',projectId,sourceId:voice.id,operation:'voice',prompt:'The same warm, clear narrator.',text:'This is a controlled cancellation test. '.repeat(15),requestKey:crypto.randomUUID()});
  active=cancellation.media.id;
  for(let i=0;i<30;i++){
    const current=(await api('/api/story-creator/media?projectId='+projectId)).media.find(m=>m.id===active);
    if(current.status==='submitting'){await sleep(100);continue;}
    assert(['queued','running','canceled'].includes(current.status));
    if(current.status!=='canceled')await api('/api/story-creator/media',{action:'cancel',projectId,id:active});
    const done=(await api('/api/story-creator/media?projectId='+projectId)).media.find(m=>m.id===active);
    assert.equal(done.status,'canceled');active=null;break;
  }
  assert.equal(active,null);record('Canceled only the owned speech request and released its GPU admission');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.screenshot({path:path.join(out,'real-media-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  for(const element of await page.locator('audio,video').all()){await element.evaluate(async media=>{await media.play();media.pause();});}
  assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));report.ok=true;
}catch(error){report.error=String(error);process.exitCode=1;if(page){report.visible=await page.locator('body').innerText().catch(()=> 'unavailable');await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}}
finally {
  if(active&&context){await api('/api/story-creator/media',{action:'cancel',projectId,id:active}).catch(()=>{});for(let i=0;i<30;i++){const r=await api('/api/story-creator/media?projectId='+projectId).catch(()=>null);if(r&&['ready','failed','canceled'].includes(r.media.find(m=>m.id===active)?.status)){active=null;break;}await sleep(1000);}}
  if(browser)await browser.close();
  let leased=false,quiet=0;const queueFile=path.join(data,'media-gpu-queue/queue.sqlite');
  for(let i=0;i<40;i++){if(fs.existsSync(queueFile)){const db=new Database(queueFile,{readonly:true});try{leased=!!db.prepare("SELECT 1 FROM media_jobs WHERE status NOT IN ('completed','failed','canceled') OR admissionToken IS NOT NULL LIMIT 1").get();}finally{db.close();}}quiet=leased?0:quiet+1;if(quiet>=3)break;await sleep(1000);}
  if(!active&&!leased){if(server){server.kill('SIGTERM');await Promise.race([once(server,'exit'),sleep(5000)]);}provider.close();fs.closeSync(log);}else{report.keptServerAlive={pid:server?.pid,active,leased};console.log('Original worker retained for exact-job reconciliation.');}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,out,error:report.error,keptServerAlive:report.keptServerAlive}));
}
