// Real TEST UI/API/inference proof with disposable users and private media.
// No production mutations; uses the shared GPU admission and exact candidate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||''),evidence=path.resolve(process.argv[3]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/experimental-tabs-\d{8}-\w+\/build-\w+\/source$/.test(build)||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Explicit backed-up TEST build required');
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));assert.equal(meta.exitCode,0);
const resume=process.argv[4]?path.resolve(process.argv[4]):null;
const reviewOnly=process.argv[5]==='--review-only';
if(reviewOnly&&!resume)throw Error('Review requires a completed disposable fixture');
if(resume&&(path.dirname(resume)!==path.dirname(build)||!/^real-testing-\w+$/.test(path.basename(resume))))throw Error('Resume only the exact disposable fixture, never live data');
const out=resume||fs.mkdtempSync(path.join(path.dirname(build),'real-testing-')),data=path.join(out,'data'),lab=path.join(out,'lab');
for(const dir of [data,lab])if(!resume)fs.mkdirSync(dir,{mode:0o700});
if(!resume)fs.copyFileSync(path.join(evidence,'testing-runtime-candidate.json'),path.join(lab,'testing-runtime.json'));
const base='http://127.0.0.1:3399',browserBase='http://slr-lab-http.test:3399';
const log=fs.openSync(path.join(out,'server.log'),resume?'a':'wx',0o600);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3399'],{cwd:build,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_EXPERIMENTS_ROOT:lab,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1'}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const report=resume?JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8')):{ok:false,buildId:meta.buildId,realInference:true,paidCalls:0,prodChanged:false,checks:[],pageErrors:[],jobs:[]};
if(resume){
  assert.equal(report.buildId,meta.buildId);assert.equal(report.realInference,true);assert.equal(report.ok,reviewOnly);
  assert.equal(report.jobs.length,reviewOnly?3:2);assert(report.jobs.every(j=>j.state==='completed'&&j.cleanedUp));
  fs.copyFileSync(path.join(out,'results.json'),path.join(out,'results-before-resume-'+Date.now()+'.json'));
  if(!reviewOnly)report.resumedFrom=report.error;delete report.error;report.ok=false;
}
let browser,context,page,active;
async function call(route,body){return context.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});}
async function generate(panel,button){
  const response=page.waitForResponse(r=>r.url()===browserBase+'/api/experiments'&&r.request().postDataJSON()?.action==='generate');
  await panel.getByRole('button',{name:button,exact:true}).click();const submitted=await response;assert.equal(submitted.status(),202,await submitted.text());active=(await submitted.json()).job;
  console.log(JSON.stringify({job:active.id,model:active.model,evidence:out}));
  for(let i=0;i<1800;i++){
    await wait(2000);const current=await(await call('/api/experiments?jobs='+active.session)).json();const job=current.jobs.find(j=>j.id===active.id);
    if(['failed','canceled','needs_attention'].includes(job.state))throw Error(job.stage);
    if(job.state==='completed'&&job.output){report.jobs.push(job);active=null;return job;}
  }
  throw Error('Qualification wait limit exceeded');
}
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Fixture server exited');try{if((await fetch(base+'/api/healthz')).status===200)break;}catch{}await wait(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-lab-http.test 127.0.0.1']});
  context=await browser.newContext({viewport:{width:412,height:915}});page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.pageErrors.push(e.message));
  let username='testingreal_'+crypto.randomBytes(4).toString('hex');const password=crypto.randomBytes(24).toString('base64url');
  if(!resume)assert.equal((await call('/api/auth/signup',{username,password,email:username+'@test.invalid'})).status(),200);
  const db=new Database(path.join(data,'otg.db'));try{
    if(resume){const users=db.prepare("SELECT id,username,email FROM users").all();assert.equal(users.length,1);const user=users[0];assert.match(user.username,/^testingreal_[a-f0-9]{8}$/);assert.equal(user.email,user.username+'@test.invalid');username=user.username;db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(password,12),user.id);}
    else{const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(user.id,new Date().toISOString());}
  }finally{db.close();}
  await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
  await context.addCookies((await context.cookies(base)).map(c=>({...c,domain:'slr-lab-http.test'})));
  await page.goto(browserBase+'/app?tab=testing');const panel=page.getByRole('region',{name:'Testing workspace'});await panel.waitFor();
  assert.deepEqual(await page.evaluate(()=>[isSecureContext,typeof crypto.randomUUID]),[false,'undefined']);
  if(!resume){
  await panel.getByLabel('Experiment',{exact:true}).selectOption('pika-flex');await panel.getByRole('button',{name:'New test plan',exact:true}).click();
  await panel.getByLabel('Scene prompt',{exact:true}).fill('Two fully clothed adult friends in a sunny cafe. The woman in <Picture 1> has a short curly bob and ivory sweater. Her distinct friend in <Picture 2> has long dark braids and a teal jacket. They stand together and exchange a friendly wave. Stable separate identities, natural hands, medium-wide composition, gentle motion, quiet cafe ambience, no dialogue or music. Non-explicit.');
  for(const name of ['reference-woman-a.png','reference-woman-b.png']){
    const done=page.waitForResponse(r=>r.url().includes('/api/experiments/assets?')&&r.request().method()==='POST');
    await panel.getByLabel('Attach private file',{exact:true}).setInputFiles('/home/shawn-rochford/AI/research/h3-r2v-single-5060-20261027-QlK0Z6/'+name);assert.equal((await done).status(),201);await panel.getByLabel(name,{exact:true}).check();
  }
  const videoJob=await generate(panel,'Generate private H3 video');await panel.getByText('Video complete',{exact:true}).waitFor();
  const video=panel.locator('video').last();await video.waitFor();await video.evaluate(v=>v.play());await wait(500);assert.equal(await video.evaluate(v=>v.paused),false);await video.evaluate(v=>v.pause());
  const media=await call('/api/experiments/assets?id='+videoJob.output+'&download=1');assert.equal(media.status(),200);
  const file=path.join(out,'actual-pika-two-reference-5s.mp4');fs.writeFileSync(file,await media.body(),{mode:0o600});report.video=file;
  const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'}));const v=probe.streams.find(s=>s.codec_type==='video');
  assert.deepEqual([v.width,v.height,Number(v.nb_frames),v.r_frame_rate],[608,352,120,'24/1']);assert(probe.streams.some(s=>s.codec_type==='audio'));
  const receipt=await(await call('/api/experiments?receipt='+videoJob.id)).json();assert.equal(receipt.status.actual.referenceCount,2);report.videoReceipt=receipt;
  await page.screenshot({path:path.join(out,'testing-real-mobile.png'),fullPage:true});report.checks.push('Nonsecure HTTP mobile UI → two references → Pika GPU graph → exact 5s AV → private download/playback');
  }
  await panel.getByLabel('Experiment',{exact:true}).selectOption('director-studio');
  let first=resume?report.jobs.find(j=>j.model==='director-studio'):null;
  if(first){await panel.getByLabel('Saved plan',{exact:true}).selectOption(first.session);}
  else{
    await panel.getByRole('button',{name:'New test plan',exact:true}).click();
    await panel.getByRole('textbox',{name:'Director concept',exact:true}).fill('Plan two five-second shots of adult friends Mara and Tess meeting in a sunny cafe. Mara has a curly bob and ivory sweater; Tess has dark braids and a teal jacket. Keep clothing and identities consistent. Friendly greeting, no dialogue, natural sound.');
    first=await generate(panel,'Generate private director plan');
  }
  assert(first.director?.shots?.length);await panel.getByText(first.director.title,{exact:true}).waitFor();
  // Role/name reflects the accessible textbox name. getByLabel's raw label
  // text also includes a React textarea's saved text node after first save.
  let second=reviewOnly?report.jobs[2]:null;
  if(!second){
    await panel.getByRole('textbox',{name:'Director concept',exact:true}).fill('Revise the previous plan: keep Mara and Tess and the same cafe, but change the light to rainy evening. Keep exactly two shots.');
    second=await generate(panel,'Generate private director plan');
  }
  assert(second.director?.shots?.length);
  const secondReceipt=await(await call('/api/experiments?receipt='+second.id)).json();assert.equal(secondReceipt.request.parentJob,first.id);assert.deepEqual(secondReceipt.request.directorContext,first.director);report.directorReceipt=secondReceipt;
  const plan=await call('/api/experiments/assets?id='+second.output+'&download=1');assert.equal(plan.status(),200);assert.deepEqual(await plan.json(),second.director);
  await page.reload();await panel.getByLabel('Experiment',{exact:true}).selectOption('director-studio');await panel.getByLabel('Saved plan',{exact:true}).selectOption(second.session);await panel.getByText(second.director.title,{exact:true}).waitFor();
  await page.getByRole('status',{name:'Launching SLR Studios',exact:true}).waitFor({state:'hidden'});
  await panel.getByRole('textbox',{name:'Director concept',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'director-real-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'director-real-desktop.png'),fullPage:true});
  if(!reviewOnly)report.checks.push('Real private Qwen plan, conversational revision context, JSON publication/download, reload persistence, mobile and desktop layout');
  else report.checks.push('Post-launch-overlay mobile/desktop screenshots and saved concept interaction; no additional inference');
  assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(error){report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
  if(active&&context){await call('/api/experiments',{action:'cancel',jobId:active.id}).catch(()=>{});for(let i=0;i<40;i++){try{const r=await(await call('/api/experiments?jobs='+active.session)).json();if(r.jobs.find(j=>j.id===active.id)?.cleanedUp)break;}catch{}await wait(1000);}}
  if(browser)await browser.close();server.kill('SIGTERM');fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,evidence:out}));
}
