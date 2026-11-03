import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
const build=path.resolve(process.argv[2]||''),original=path.resolve(process.argv[3]||''),real=process.argv.includes('--real');
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/h3-nsfw-access-\d{8}-\w+\/build-\w+\/source$/);
assert(original.startsWith(path.dirname(path.dirname(build))+'/real-refcard-'));
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(built.exitCode,0);
const resume=process.argv.find(a=>a.startsWith('--resume='))?.slice(9);
const out=resume?fs.realpathSync(resume):fs.mkdtempSync(path.join(path.dirname(build),'browser-refcard-')),data=path.join(out,'data');
assert(out.startsWith(path.dirname(build)+'/browser-refcard-'));fs.mkdirSync(data,{recursive:true,mode:0o700});
const base='http://127.0.0.1:3397',report=resume?JSON.parse(fs.readFileSync(path.join(out,'results.json'))):{ok:false,suite:'character-refcard',buildId:built.buildId,realInference:real,paidCalls:0,prodChanged:false,managedTestChanged:false,out,checks:[],gpus:{},pageErrors:[]};
assert.equal(report.buildId,built.buildId);assert.equal(report.realInference,real);assert.equal(report.out,out);
if(resume){report.previousFailures=[...(report.previousFailures||[]),report.error].filter(Boolean);delete report.error;delete report.visibleFailure;report.ok=false;}
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+path.join(process.cwd(),'scripts/experiments/qa-refcard-network.cjs')};
if(real){
 const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
 for(const line of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){const i=line.indexOf('=');if(/^(OTG_MEDIA_|OTG_WORKER_CONTROL_STORE_DIR$)/.test(line.slice(0,i)))env[line.slice(0,i)]=line.slice(i+1);}
 assert(env.OTG_MEDIA_ADMISSION_CONFIG);env.OTG_MEDIA_GPU_QUEUE_DB='/home/shawn-rochford/AI/runtime/test/data/media-gpu-queue/queue.sqlite';env.OTG_MEDIA_GPU_ROUTING='1';
}else env.OTG_MEDIA_GPU_ROUTING='0';
let server,browser,page,context,other;const log=fs.openSync(path.join(out,'server.log'),resume?'a':'wx',0o600);
const pause=ms=>new Promise(r=>setTimeout(r,ms)),save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});
function start(){server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3397'],{cwd:build,env,stdio:['ignore',log,log]});}
async function ready(){for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Isolated server exited');try{if((await fetch(base+'/api/healthz')).ok)return;}catch{}await pause(200);}throw Error('Server readiness timeout');}
async function api(route,body,ctx=context){const r=await ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});const json=await r.json();assert(r.ok(),json.error||'HTTP '+r.status());return json;}
async function state(){return(await api('/api/h3/special/refmods/character-card')).card;}
async function waitCard(test,timeout=30000){const start=Date.now();for(;;){const c=await state();if(test(c))return c;if(c?.state==='attention')throw Error(c.error);if(Date.now()-start>timeout)throw Error('Card wait timed out: '+JSON.stringify(c));await pause(500);}}
async function open(){await page.goto(base+'/app?tab=characters');await page.getByRole('button',{name:/Ref Mod Gallery/}).click();await page.locator('[data-otg="refmod-gallery-create"]').click();await page.getByRole('button',{name:/^Character Create identity/}).click();await page.locator('[data-otg="character-refcard"]').waitFor();}
async function identity(ctx,existing){const name=existing||'refcard_http_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
 if(existing){assert(resume&&existing===report.owner&&/^refcard_http_[a-f0-9]{8}$/.test(existing));const db=new Database(path.join(data,'otg.db'));try{assert.equal(db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(await bcrypt.hash(password,10),existing).changes,1);}finally{db.close();}}else await api('/api/auth/signup',{username:name,password,email:name+'@test.invalid'},ctx);
 const p=await ctx.newPage();await p.goto(base+'/login');await p.getByPlaceholder('you@domain.com or username').fill(name);await p.locator('input[autocomplete="current-password"]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL('**/app');return{page:p,name};}
const record=name=>{report.checks.push(name);save();console.log(name);};
try{
 start();await ready();browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server']});
 context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36'});other=await browser.newContext();
 assert.equal((await context.request.get(base+'/api/h3/special/refmods/character-card')).status(),401);
 const user=await identity(context,resume?report.owner:undefined);page=user.page;page.setDefaultTimeout(20000);page.on('pageerror',e=>report.pageErrors.push(e.message));report.owner=user.name;
 await identity(other);await open();const panel=page.locator('[data-otg="character-refcard"]');
 let c;
 if(!resume){
 await panel.getByLabel('Character name',{exact:true}).fill('Bunny QA');c=await waitCard(c=>c?.name==='Bunny QA');
 assert.equal((await other.request.get(base+`/api/h3/special/refmods/character-card?id=${c.id}`)).status(),404);
 assert.equal((await context.request.post(base+'/api/h3/special/refmods/character-card',{headers:{Origin:'https://attacker.invalid'},data:{action:'create',id:crypto.randomUUID()}})).status(),403);
 // Android uses the existing app-wide Phone storage/Photos bridge.
 await panel.getByLabel('Add source image',{exact:true}).click();await page.getByRole('button',{name:'Phone storage',exact:true}).waitFor();
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Phone storage',exact:true}).click()]);await chooser.setFiles(original);
 c=await waitCard(c=>!!c?.original);assert.equal((await other.request.get(base+c.original.url)).status(),404);
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('[data-otg="refmod-gallery-create"]').click();await page.getByRole('button',{name:/^Character Create identity/}).click();await panel.getByAltText('Original character').waitFor();assert.equal(await panel.getByLabel('Character name',{exact:true}).inputValue(),'Bunny QA');record('Real sign-in, owner/CSRF denial, Android Phone storage picker, chunk upload, saved source and close/reopen');
 }
 if(real){
  for(const gpu of ['rtx3090','rtx5060ti']){
   if(!report.gpus[gpu]?.libraryName){
   if(gpu==='rtx5060ti'){await panel.getByRole('button',{name:'New card',exact:true}).click();await waitCard(c=>c?.name==='');await panel.getByLabel('Character name',{exact:true}).fill('Bunny QA '+gpu);await panel.getByLabel('Add source image',{exact:true}).setInputFiles(original);await waitCard(c=>!!c?.original&&c.name.includes(gpu));}
   await panel.getByText('Details & GPU',{exact:true}).click();await panel.getByRole('combobox',{name:/Rendering GPU/}).selectOption(gpu);await panel.getByLabel('Keep these character details',{exact:true}).fill('An illustrated white rabbit with one pink ear and one white ear, a purple vest and one gold button. Keep this recognizable character and its original style.');await waitCard(c=>c?.gpu===gpu&&c.description.includes('purple vest'));
   const started=Date.now();await panel.getByRole('button',{name:'Create four views',exact:true}).click();c=await waitCard(c=>c?.state==='generating');const acceptedIds=c.views.map(v=>v.id),id=c.id;
   // Background tab, then a real isolated web-process restart. Original queue
   // IDs and already-written files must survive; workers are never restarted.
   const elsewhere=await context.newPage();await elsewhere.goto('about:blank');await pause(3000);server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));start();await ready();await elsewhere.close();await page.bringToFront();await open();
   c=await waitCard(c=>c?.id===id&&c.state==='review',20*60*1000);assert.deepEqual(c.views.map(v=>v.id),acceptedIds);assert(c.views.every(v=>v.state==='ready'&&v.gpu===gpu));report.gpus[gpu]={cardId:id,viewIds:acceptedIds,secondsToViews:(Date.now()-started)/1000};save();
   assert.equal(await panel.getByRole('button',{name:'Regenerate',exact:true}).count(),4);assert.equal(await panel.getByRole('button',{name:'Remove',exact:true}).count(),4);
   if(gpu==='rtx3090'){
    const seed=c.views[0].seed,others=c.views.slice(1).map(v=>({id:v.id,seed:v.seed}));await panel.getByRole('button',{name:'Regenerate',exact:true}).first().click();await waitCard(c=>c.state==='generating');c=await waitCard(c=>c.state==='review',10*60*1000);assert.notEqual(c.views[0].seed,seed);assert.deepEqual(c.views.slice(1).map(v=>({id:v.id,seed:v.seed})),others);report.gpus[gpu].individualRegeneration=true;
   }
   await page.screenshot({path:path.join(out,'views-'+gpu+'.png'),fullPage:true});assert.equal(await panel.evaluate(e=>e.scrollWidth>e.clientWidth+2),false);
   await panel.getByRole('button',{name:'Approve 4 images & create RefMod',exact:true}).click();c=await waitCard(c=>c?.state==='completed',10*60*1000);report.gpus[gpu]={...report.gpus[gpu],libraryName:c.libraryName,characterId:c.characterId,tokens:c.tokenCount,previewUrl:c.previewUrl};save();
   }else c=(await api('/api/h3/special/refmods/character-card?id='+report.gpus[gpu].cardId)).card;
   assert.equal((await context.request.get(base+c.previewUrl)).status(),200);assert.equal((await other.request.get(base+c.previewUrl)).status(),404);
   const library=await api('/api/h3/special/refmods/library');assert(library.entries.some(e=>e.name===c.libraryName&&e.characterId===c.characterId));assert(!(await api('/api/h3/special/refmods/library',undefined,other)).entries.some(e=>e.name===c.libraryName));
   // Generate an actual short H3 video with the saved RefMod through the app API.
   const jobRoot=path.join(data,'h3-special/refmods-generation',report.owner,'jobs');
   const prior=resume&&fs.existsSync(jobRoot)?fs.readdirSync(jobRoot).map(f=>JSON.parse(fs.readFileSync(path.join(jobRoot,f)))).find(j=>j.input?.refMods?.some(m=>m.name===c.libraryName)&&j.status==='completed'):null;
   const submitted=prior?{job:{id:prior.id}}:await api('/api/h3/special/refmods/generation',{config:{mode:'h3-refmods',quality:'sh',orientation:'landscape',durationSeconds:5,prompt:'The same illustrated rabbit from <Video 1> stands in a quiet studio and slowly turns its head. Preserve the purple vest, gold button and the one pink ear and one white ear. No other characters, no text.',targetBackend:gpu,refMods:[{name:c.libraryName,category:'character',sourceKind:'video',strength:1,components:'Visual',copies:1,visualStrength:1,audioStrength:0}],turbo:true,h3Settings:{checkpointMode:'fasth3',renderMode:'turbo',combatLoraEnabled:false},seed:424242}});
   let job;const startedVideo=Date.now();for(let i=0;i<900;i++){job=(await api('/api/h3/special/refmods/generation?jobId='+submitted.job.id)).job;if(['failed','canceled','unknown'].includes(job.status))throw Error('H3 reuse failed: '+JSON.stringify(job));if(job.status==='completed')break;await pause(2000);}assert.equal(job.status,'completed');report.gpus[gpu].h3Job=job;report.gpus[gpu].h3Seconds=prior?(Date.parse(job.completedAt)-Date.parse(job.startedAt))/1000:(Date.now()-startedVideo)/1000;
   const video=await context.request.get(base+job.videoUrl);assert.equal(video.status(),200);assert.equal((await other.request.get(base+job.videoUrl)).status(),404);const output=path.join(out,'h3-'+gpu+'.mp4');fs.writeFileSync(output,await video.body());const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));
   // Existing H3 native alignment: 5s preset rounds 120 frames up to 124.
   // Verify the actual graph's native frame envelope, not an invented exact 5s.
   const videoStream=probe.streams.find(s=>s.codec_type==='video');assert.equal(Number(videoStream.nb_frames),124);assert.equal(videoStream.avg_frame_rate,'24/1');assert(Math.abs(Number(videoStream.duration)-124/24)<.002);report.nativeFiveSecondPreset={frames:124,fps:24,seconds:124/24,exactFiveSeconds:false};
   report.gpus[gpu].video={file:output,probe};execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-y','-ss','2','-i',output,'-frames:v','1','-threads','1',path.join(out,'h3-'+gpu+'.png')]);save();
   record(gpu+': UI → four real FIBO views → restart recovery → saved H3 RefMod → real 5-second H3 reuse');
  }
  // Exercise the owner's normal Gallery → Use in H3 route as well as the API.
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const remoteCard=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Bunny QA rtx5060ti',exact:true})}).first();
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/h3/smart-references?backend=rtx5060ti')&&r.status()===200),remoteCard.getByRole('button',{name:'Use in H3',exact:true}).click()]);
  const smart=page.locator('[data-otg="h3-smart-references"]');await smart.waitFor();
  await smart.locator('summary').filter({hasText:'Character & Scene References'}).click();await smart.getByText('Bunny QA rtx5060ti',{exact:true}).waitFor();
  report.useInH3Routing=true;record('Saved 5060 Ti card → Use in H3 → selected GPU capability check and readable character name');await open();
 }
 // The upload route must preserve every selected view and allow editing them.
 await panel.getByRole('button',{name:'New card',exact:true}).click();await waitCard(c=>c?.name==='');await panel.getByLabel('Character name',{exact:true}).fill('Uploaded bunny');await panel.getByRole('button',{name:'Upload 4–8 images',exact:true}).click();
 await panel.getByLabel('Add reference images',{exact:true}).setInputFiles(Array.from({length:8},(_,i)=>({name:'view-'+i+'.png',mimeType:'image/png',buffer:fs.readFileSync(original)})));c=await waitCard(c=>c?.views.length===8);const removed=c.views[0].id;
 let savedPreview;
 if(real){await panel.getByRole('button',{name:'Approve 8 images & create RefMod',exact:true}).click();c=await waitCard(c=>c.state==='completed',10*60*1000);const library=await api('/api/h3/special/refmods/library'),entry=library.entries.find(e=>e.name===c.libraryName);assert.equal(entry.shape[0],8);savedPreview={url:entry.previewPath,sha256:crypto.createHash('sha256').update(await(await context.request.get(base+entry.previewPath)).body()).digest('hex')};report.uploadedEightEncoding={libraryName:c.libraryName,shape:entry.shape,tokens:c.tokenCount};save();}
 await panel.getByRole('button',{name:'Remove',exact:true}).first().click();c=await waitCard(c=>c?.views.length===7);assert(!c.views.some(v=>v.id===removed));const before=c.views.map(v=>v.id);
 await panel.getByRole('button',{name:/Move .* down/}).first().click();c=await waitCard(c=>c?.views[0].id===before[1]);
 await panel.getByLabel(/Replace/).first().setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:fs.readFileSync(original)});c=await waitCard(c=>c?.views[0].label==='replacement.png');
 if(savedPreview){const old=await context.request.get(base+savedPreview.url);assert.equal(old.status(),200);assert.equal(crypto.createHash('sha256').update(await old.body()).digest('hex'),savedPreview.sha256);report.immutableSavedPreview=true;save();}
 await page.reload();await open();await panel.getByAltText('replacement.png').waitFor();assert.equal((await state()).views.length,7);
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'upload-review-desktop.png'),fullPage:true});assert.equal(await panel.evaluate(e=>e.scrollWidth>e.clientWidth+2),false);record('4–8 upload route, 8 retained, remove/reorder/replace, reload persistence, compact mobile and desktop layout');
 assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));report.ok=true;save();
}catch(error){report.error=String(error.stack||error);if(page){report.visibleFailure=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}save();throw error;}
finally{await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}fs.closeSync(log);console.log(JSON.stringify({results:path.join(out,'results.json'),ok:report.ok}));}
