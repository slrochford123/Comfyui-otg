// One real, non-explicit H3 inference through the built TEST UI/API/private runner.
// Disposable accounts/database; same pinned runtime as TEST. No PROD writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||'');
const httpOrigin=process.argv.includes('--http-origin');
if(!/^\/home\/shawn-rochford\/AI\/research\/experimental-tabs-\d{8}-\w+\/build-\w+\/source$/.test(build))throw Error('Isolated built TEST snapshot required');
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'real-h3-')),data=path.join(out,'data'),lab=path.join(out,'lab');
fs.mkdirSync(data,{mode:0o700});fs.mkdirSync(lab,{mode:0o700});
fs.copyFileSync('/home/shawn-rochford/AI/runtime/test/experiments/runtime.json',path.join(lab,'runtime.json'));
const base='http://127.0.0.1:3399',log=fs.openSync(path.join(out,'server.log'),'wx',0o600);
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_EXPERIMENTS_ROOT:lab,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1'};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3399'],{cwd:build,env,stdio:['ignore',log,log]});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={ok:false,buildId:meta.buildId,realInference:true,paidCalls:0,prodChanged:false,checks:[],pageErrors:[]};
let browser,context,page,jobId,sessionId;
async function call(route,body){return context.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});}
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Fixture app exited');try{if((await fetch(base+'/api/healthz')).status===200)break;}catch{}await delay(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-lab-http.test 127.0.0.1']});
  context=await browser.newContext({viewport:{width:412,height:915}});page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.pageErrors.push(e.message));
  const username='h3real_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  assert.equal((await call('/api/auth/signup',{username,password,email:username+'@test.invalid'})).status(),200);
  const db=new Database(path.join(data,'otg.db'));try{const row=db.prepare('SELECT id FROM users WHERE username=?').get(username);db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(row.id,new Date().toISOString());}finally{db.close();}
  await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
  let browserBase=base;
  if(httpOrigin){
    browserBase='http://slr-lab-http.test:3399';
    await context.addCookies((await context.cookies(base)).map(cookie=>({...cookie,domain:'slr-lab-http.test'})));
  }
  await page.goto(browserBase+'/app?tab=h3-admin');const panel=page.getByRole('region',{name:'H3 administrator workspace'});await panel.waitFor();
  if(httpOrigin){
    report.httpCrypto=await page.evaluate(()=>({secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues}));
    assert.deepEqual(report.httpCrypto,{secureContext:false,randomUUID:'undefined',getRandomValues:'function'});
  }
  await panel.getByLabel('Model version').selectOption('eros-beta7');await panel.getByRole('button',{name:'New test plan',exact:true}).click();
  await panel.getByLabel('Resolution',{exact:true}).selectOption('0.6');await panel.getByLabel('Duration in seconds').fill('5');await panel.getByLabel('GPU preference').selectOption('rtx3090');
  await panel.getByLabel('Scene prompt',{exact:true}).fill('Photorealistic cinematic cafe scene, fully clothed adult friends. The adult woman in <Picture 1> has a short curly bob and ivory sweater, seated holding a ceramic mug. Her different adult friend from <Picture 2> has long dark braids and a teal jacket and stands beside the table. Both women are visible together. They smile and exchange a friendly wave. Preserve their distinct faces, hairstyles and clothes. Natural daylight, stable medium-wide composition, subtle movement. Quiet cafe ambience, no dialogue or music. Non-explicit.');
  for(const name of ['reference-woman-a.png','reference-woman-b.png']){
    const done=page.waitForResponse(r=>r.url().includes('/api/experiments/assets?')&&r.request().method()==='POST');await panel.getByLabel('Attach private file',{exact:true}).setInputFiles('/home/shawn-rochford/AI/research/h3-r2v-single-5060-20261027-QlK0Z6/'+name);assert.equal((await done).status(),201);await panel.getByLabel(name,{exact:true}).check();
  }
  const response=page.waitForResponse(r=>r.url().endsWith('/api/experiments')&&r.request().postDataJSON()?.action==='generate');
  await panel.getByRole('button',{name:'Generate private H3 video',exact:true}).click();const submitted=await response;assert.equal(submitted.status(),202,await submitted.text());const job=(await submitted.json()).job;jobId=job.id;sessionId=job.session;report.job=job;
  console.log(JSON.stringify({jobId,sessionId,evidence:out}));
  let completed;
  for(let i=0;i<900;i++){
    await delay(2000);const current=await (await call('/api/experiments?jobs='+sessionId)).json();const j=current.jobs.find(j=>j.id===jobId);
    if(['failed','canceled','needs_attention'].includes(j.state))throw Error(j.stage);
    if(j.state==='completed'&&j.output){completed=j;report.result=j;break;}
  }
  assert(completed,'Real generation did not complete within qualification time limit');
  await panel.getByText('Video complete',{exact:true}).waitFor();const video=panel.locator('video').last();await video.waitFor();await video.evaluate(v=>v.play());await delay(500);assert.equal(await video.evaluate(v=>v.paused),false);await video.evaluate(v=>v.pause());
  const media=await context.request.get(base+'/api/experiments/assets?id='+completed.output+'&download=1');assert.equal(media.status(),200);const bytes=await media.body();
  const file=path.join(out,'actual-eros-reference-5s.mp4');fs.writeFileSync(file,bytes,{mode:0o600});
  const receipt=await (await call('/api/experiments?receipt='+jobId)).json();report.receipt=receipt;report.file=file;
  const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));report.media=probe;
  const v=probe.streams.find(s=>s.codec_type==='video');assert.equal(Number(v.nb_frames),120);assert.equal(v.width,1056);assert.equal(v.height,608);assert.equal(v.r_frame_rate,'24/1');assert(probe.streams.some(s=>s.codec_type==='audio'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'mobile-real-generation.png'),fullPage:true});
  assert.equal(report.pageErrors.length,0);report.checks.push('Actual mobile-size UI → admin API → shared GPU authority → isolated real H3 graph → video/audio decode → private download and playback');report.ok=true;
}catch(error){report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
  if(jobId&&!report.ok&&context){await call('/api/experiments',{action:'cancel',jobId}).catch(()=>{});for(let i=0;i<40;i++){try{const d=await(await call('/api/experiments?jobs='+sessionId)).json();if(d.jobs.find(j=>j.id===jobId)?.cleanedUp)break;}catch{}await delay(1000);}}
  if(browser)await browser.close();server.kill('SIGTERM');fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,evidence:out}));
}
