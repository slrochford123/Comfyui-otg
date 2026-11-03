// Exact built app, real authentication and browser flows, disposable accounts.
// One non-explicit real GPU run, then a queued revocation check. No paid APIs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import Database from 'better-sqlite3';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/h3-nsfw-access-\d{8}-\w+\/build-\w+\/source$/.test(build))throw Error('Exact isolated build required');
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const evidence=path.resolve(build,'../..'),out=fs.mkdtempSync(path.join(path.dirname(build),'browser-access-'));
const data=path.join(out,'data'),lab=path.join(out,'lab');for(const dir of [data,lab])fs.mkdirSync(dir,{mode:0o700});
const configText=fs.readFileSync(path.join(evidence,'runtime-candidate.json'),'utf8');
// Preserve nanosecond checkpoint timestamps exactly (beyond JS safe integers).
fs.writeFileSync(path.join(lab,'runtime.json'),configText,{mode:0o600});
const base='http://127.0.0.1:3396',log=fs.openSync(path.join(out,'server.log'),'wx',0o600);
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_EXPERIMENTS_ROOT:lab,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1'};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3396'],{cwd:build,env,stdio:['ignore',log,log]});
const report={ok:false,suite:'h3-nsfw-access',buildId:meta.buildId,realInference:true,paidCalls:0,prodChanged:false,checks:[],pageErrors:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let browser,user,admin,page,adminPage,activeJob,sessionId,busyQueue;
async function call(ctx,route,body){return ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});}
const record=name=>{report.checks.push(name);console.log(name);};
async function identity(ctx,prefix,administrator=false){
  const username=prefix+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  const signup=await call(ctx,'/api/auth/signup',{username,password,email:username+'@test.invalid'});assert.equal(signup.status(),200,await signup.text());
  const db=new Database(path.join(data,'otg.db'));let id;
  try{id=db.prepare('SELECT id FROM users WHERE username=?').get(username).id;if(administrator)db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(id,new Date().toISOString());}finally{db.close();}
  const p=await ctx.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>report.pageErrors.push(e.message));
  await p.goto(base+'/login');await p.getByPlaceholder('you@domain.com or username').fill(username);await p.locator('input[autocomplete="current-password"]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL('**/app');return {page:p,username,id};
}
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Fixture exited');try{if((await fetch(base+'/api/healthz')).ok)break;}catch{}await delay(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});
  user=await browser.newContext({viewport:{width:412,height:915}});admin=await browser.newContext({viewport:{width:1440,height:1000}});
  assert.equal((await call(user,'/api/h3/nsfw')).status(),401);
  const u=await identity(user,'nsfwqa_');page=u.page;const a=await identity(admin,'adminqa_',true);adminPage=a.page;
  assert.equal((await call(user,'/api/h3/nsfw')).status(),403);assert.equal((await call(user,'/api/experiments')).status(),403);
  assert.equal((await (await call(user,'/api/h3/nsfw/access')).json()).access.enabled,false);
  await page.goto(base+'/app?tab=h3');await page.getByRole('button',{name:'H3 · Text to Image',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'H3 NSFW',exact:true}).count(),0);
  record('Existing/new non-admin defaults disabled; no button, no API or Testing access');
  await page.goto(base+'/app?tab=settings');const access=page.getByRole('region',{name:'H3 NSFW access',exact:true});await access.waitFor();
  await access.getByRole('checkbox').check();await access.getByRole('button',{name:'Request NSFW approval',exact:true}).click();await access.getByText('Pending administrator approval',{exact:true}).waitFor();
  assert.equal((await call(user,'/api/h3/nsfw')).status(),403);
  assert.equal((await call(user,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:true,version:0})).status(),403);
  assert.equal((await admin.request.post(base+'/api/admin/h3-nsfw-access',{headers:{Origin:'https://untrusted.invalid'},data:{userId:u.id,enabled:true,version:0}})).status(),403);
  await adminPage.goto(base+'/app/admin/users');const toggle=adminPage.getByRole('switch',{name:'H3 NSFW access for '+u.username,exact:true});await toggle.waitFor();await adminPage.getByText('Approval requested',{exact:false}).waitFor();
  const enabled=adminPage.waitForResponse(r=>r.url().endsWith('/api/admin/users')&&r.status()===200);await toggle.click();await enabled;
  assert.equal((await (await call(user,'/api/h3/nsfw/access')).json()).access.enabled,true);
  assert.equal(await adminPage.getByRole('switch',{name:'H3 NSFW access for '+a.username,exact:true}).isDisabled(),true);
  record('Actual Settings request and Admin Users enable switch; no self-grant, CSRF rejected, admins always enabled');
  await page.goto(base+'/app?tab=h3');await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();const panel=page.getByRole('region',{name:'H3 NSFW workspace',exact:true});await panel.waitFor();
  const catalog=await (await call(user,'/api/h3/nsfw')).json();assert.equal(catalog.catalog.length,2);assert(catalog.catalog.every(m=>m.kind==='h3-admin'));
  assert.equal((await call(user,'/api/h3/nsfw',{action:'create',experiment:'pika-flex'})).status(),403);
  const testing=(await (await call(admin,'/api/experiments',{action:'create',experiment:'pika-flex'})).json()).session;
  assert.equal((await call(admin,'/api/h3/nsfw?export='+testing.id)).status(),404);
  await panel.getByRole('button',{name:'New generation session',exact:true}).click();
  await panel.getByRole('button',{name:'Text → video',exact:true}).click();await panel.getByLabel('Scene prompt',{exact:true}).fill('A small red paper boat floats slowly on a calm sunlit pond. Gentle ripples, fixed camera. Quiet water ambience. No people, no text.');
  await panel.getByLabel('Duration in seconds',{exact:true}).fill('2');await panel.getByLabel('Resolution',{exact:true}).selectOption('0.2');
  const png=path.join(out,'reference.png');execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=red:s=128x128','-frames:v','1','-threads','1',png]);
  const uploaded=page.waitForResponse(r=>r.url().includes('/api/h3/nsfw/assets?')&&r.request().method()==='POST');await panel.getByLabel('Attach private file',{exact:true}).setInputFiles(png);assert.equal((await uploaded).status(),201);
  await panel.getByText('Private asset validated and saved. No generation was started.',{exact:true}).waitFor();
  let session=(await (await call(user,'/api/h3/nsfw')).json()).sessions[0];sessionId=session.id;
  const assetId=session.assets[0].id;assert.equal((await call(admin,'/api/h3/nsfw?export='+sessionId)).status(),404);assert.equal((await call(admin,'/api/h3/nsfw/assets?id='+assetId)).status(),404);
  const range=await user.request.get(base+'/api/h3/nsfw/assets?id='+assetId,{headers:{Range:'bytes=0-7'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,8);
  const file=await call(user,'/api/h3/nsfw/assets?id='+assetId+'&download=1');assert.equal(crypto.createHash('sha256').update(await file.body()).digest('hex'),session.assets[0].sha256);
  assert.equal((await call(user,'/api/h3/nsfw',{...session,action:'update',settings:{...session.settings,loras:['arbitrary.safetensors']}})).status(),400);
  await panel.getByRole('button',{name:catalog.catalog.find(c=>c.id==='eros-beta7').title,exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Native · 20',exact:true}).isDisabled(),true);
  await panel.getByRole('button',{name:'Save plan',exact:true}).click();await panel.getByText('Plan saved. No generation or promotion occurred.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'PRISM-PIKA',exact:true}).click();await panel.getByRole('button',{name:'Save plan',exact:true}).click();await panel.getByText('Plan saved. No generation or promotion occurred.',{exact:true}).waitFor();
  session=(await (await call(user,'/api/h3/nsfw')).json()).sessions.find(s=>s.id===sessionId);assert.equal(session.assets[0].id,assetId);assert.match(session.settings.prompt,/paper boat/);
  assert.equal(await panel.getByRole('button',{name:'Native · 20',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'nsfw-mobile.png'),fullPage:true});
  record('Two models and compact H3 controls; prompt/references retained on switch; owner-only range/download; no unqualified LoRA injection');
  // Check GPU queues and production health immediately before the one GPU generation.
  report.preflight={prod:JSON.parse(execFileSync('/usr/bin/ssh',['-o','BatchMode=yes','otg-slr',"curl -fsS http://127.0.0.1:3000/api/healthz"],{encoding:'utf8'})),queues:[]};
  for(const url of ['http://100.75.162.64:8188/queue','http://100.75.162.64:8189/queue','http://100.98.212.116:8188/queue']){const q=await(await fetch(url,{signal:AbortSignal.timeout(6000)})).json();assert.equal(q.queue_running.length+q.queue_pending.length,0,'Owner queue busy');report.preflight.queues.push({url,running:q.queue_running.length,pending:q.queue_pending.length});}
  report.preflight.gpu=execFileSync('/usr/bin/nvidia-smi',['--query-gpu=uuid,memory.free,memory.total','--format=csv,noheader,nounits'],{encoding:'utf8'}).trim();
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/h3/nsfw')&&r.request().postDataJSON()?.action==='generate');await panel.getByRole('button',{name:'Generate private H3 video',exact:true}).click();const response=await submitted;assert.equal(response.status(),202,await response.text());activeJob=(await response.json()).job.id;report.jobId=activeJob;console.log(JSON.stringify({jobId:activeJob,evidence:out}));
  let completed;
  for(let i=0;i<900;i++){await delay(2000);const current=await(await call(user,'/api/h3/nsfw?jobs='+sessionId)).json();const j=current.jobs.find(j=>j.id===activeJob);if(['failed','canceled','needs_attention'].includes(j.state))throw Error(j.stage);if(j.state==='completed'&&j.output){completed=j;break;}}
  assert(completed,'Real generation time limit');report.result=completed;activeJob=null;
  const request=JSON.parse(fs.readFileSync(path.join(lab,'jobs',report.jobId,'request.json')));assert.deepEqual(request.authorization,{userId:u.id,version:1});
  await panel.getByText('Video complete',{exact:true}).waitFor();const video=panel.locator('video').last();await video.evaluate(v=>v.play());await delay(600);assert.equal(await video.evaluate(v=>v.paused),false);await video.evaluate(v=>v.pause());
  const output=await call(user,'/api/h3/nsfw/assets?id='+completed.output+'&download=1');assert.equal(output.status(),200);const outputFile=path.join(out,'approved-user-h3-2s.mp4');fs.writeFileSync(outputFile,await output.body(),{mode:0o600});
  report.media=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',outputFile],{encoding:'utf8'}));const v=report.media.streams.find(s=>s.codec_type==='video');assert.equal(Number(v.nb_frames),48);assert.equal(v.r_frame_rate,'24/1');assert.equal(v.width,608);assert.equal(v.height,352);report.file=outputFile;
  assert.equal((await call(admin,'/api/h3/nsfw?receipt='+report.jobId)).status(),404);assert.equal((await call(user,'/api/experiments')).status(),403);
  record('Approved non-admin real UI → permission-stamped worker → actual 2s H3 inference → private video playback/download; Testing still denied');
  // Exercise real worker revocation before GPU acquisition: a fixture queue reports
  // busy, so this second request cannot acquire a GPU or run inference.
  busyQueue=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({queue_running:[1],queue_pending:[]}));});
  busyQueue.listen(0,'127.0.0.1');await once(busyQueue,'listening');
  const queuedConfig=configText.replace(/"queues"\s*:\s*\[[^\]]*\]/,'"queues":'+JSON.stringify(['http://127.0.0.1:'+busyQueue.address().port]));
  assert.notEqual(queuedConfig,configText);fs.writeFileSync(path.join(lab,'runtime.json'),queuedConfig,{mode:0o600});
  const accepted=await call(user,'/api/h3/nsfw',{action:'generate',id:sessionId,revision:session.revision,requestId:crypto.randomUUID(),sources:[]});assert.equal(accepted.status(),202,await accepted.text());activeJob=(await accepted.json()).job.id;
  await adminPage.reload();await adminPage.getByRole('switch',{name:'H3 NSFW access for '+u.username,exact:true}).click();
  for(let i=0;i<50;i++){if((await call(user,'/api/h3/nsfw')).status()===403)break;await delay(200);}
  for(const route of ['/api/h3/nsfw','/api/h3/nsfw?jobs='+sessionId,'/api/h3/nsfw?receipt='+report.jobId,'/api/h3/nsfw/assets?id='+completed.output])assert.equal((await call(user,route)).status(),403);
  await panel.waitFor({state:'hidden',timeout:15000});assert.equal(await page.getByRole('button',{name:'H3 NSFW',exact:true}).count(),0);
  let cancelled;
  for(let i=0;i<60;i++){await delay(500);const file=path.join(lab,'jobs',activeJob,'status.json');if(fs.existsSync(file)){const s=JSON.parse(fs.readFileSync(file));if(s.cleanedUp){cancelled=s;break;}}}
  assert.equal(cancelled?.state,'canceled',JSON.stringify(cancelled));assert.match(cancelled.stage,/access changed|revoked/i);report.revocation=cancelled;activeJob=null;
  assert(fs.existsSync(path.join(lab,completed.output+'.media')));record('Revocation removes visible H3 NSFW, denies new API/media requests, cancels only the waiting private worker, retains results');
  const permission=(await(await call(user,'/api/h3/nsfw/access')).json()).access;
  assert.equal((await call(admin,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:true,version:permission.version})).status(),200);
  assert.equal((await call(user,'/api/h3/nsfw/assets?id='+completed.output)).status(),200);
  await page.goto(base+'/app?tab=h3');await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();await panel.getByLabel('Saved plan',{exact:true}).selectOption(sessionId);await panel.locator('video').last().waitFor();
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'nsfw-desktop-result.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));report.ok=true;
}catch(error){report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
  if(activeJob){const dir=path.join(lab,'jobs',activeJob);if(fs.existsSync(dir))fs.writeFileSync(path.join(dir,'cancel'),'QA-owned cancellation\n');for(let i=0;i<60;i++){try{if(JSON.parse(fs.readFileSync(path.join(dir,'status.json'))).cleanedUp)break;}catch{}await delay(500);}}
  if(busyQueue)busyQueue.close();if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),delay(8000)]);if(server.exitCode===null)server.kill('SIGKILL');}fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,evidence:out}));
}
