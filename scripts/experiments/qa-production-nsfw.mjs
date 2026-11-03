// Real inference on an isolated production-host candidate. Disposable identities;
// no managed-service changes, paid calls, explicit content or customer job access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||''),stage=process.env.H3_QA_STAGE;
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/h3-nsfw-access-\d{8}-\w+\/build-\w+\/source$/);
assert.match(stage||'',/^\/mnt\/otg_bulk\/build-2\.22-promotion-[a-f0-9]{12}$/);
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'real-prod-nsfw-')),base='http://127.0.0.1:3308';
const report={ok:false,suite:'production-h3-nsfw',buildId:meta.buildId,realInference:true,controller:'isolated-production-host',gpu:'rtx3090',paidCalls:0,managedProductionChanged:false,checks:[],jobs:[],pageErrors:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),record=name=>{report.checks.push(name);console.log(name);};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});
const user=await browser.newContext({viewport:{width:412,height:915}}),admin=await browser.newContext({viewport:{width:1440,height:1000}});
let page,active,sessionId;
async function call(ctx,route,body){return ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body}),timeout:30000});}
async function api(ctx,route,body){const r=await call(ctx,route,body),v=await r.json();assert(r.ok(),v.error||`HTTP ${r.status()}`);return v;}
async function identity(ctx,prefix,elevate=false){
  const username=prefix+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  await api(ctx,'/api/auth/signup',{username,password,email:username+'@test.invalid'});
  const payload={stage,username,elevate};
  const code=`import json,pathlib,re,sqlite3,sys,datetime\np=json.load(sys.stdin);stage=pathlib.Path(p['stage']);assert re.fullmatch(r'/mnt/otg_bulk/build-2.22-promotion-[a-f0-9]{12}',str(stage));state=json.loads((stage/'smoke-process.json').read_text());db=sqlite3.connect(pathlib.Path(state['data'])/'otg.db');row=db.execute('SELECT id FROM users WHERE username=?',(p['username'],)).fetchone();assert row\nif p['elevate']:db.execute("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)",(row[0],datetime.datetime.now(datetime.timezone.utc).isoformat()));db.commit()\nprint(json.dumps({'id':row[0]}));db.close()`;
  const {id}=JSON.parse(execFileSync('ssh',['-o','BatchMode=yes','otg-slr','sudo -n /usr/bin/python3 -c '+"'"+code.replaceAll("'","'\\''")+"'"],{input:JSON.stringify(payload),encoding:'utf8'}));
  const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>report.pageErrors.push(e.message));
  await p.goto(base+'/login');await p.getByPlaceholder('you@domain.com or username').fill(username);await p.locator('input[autocomplete="current-password"]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL('**/app');return {page:p,id,username};
}
async function wait(id,sid){
  active=id;sessionId=sid;const start=Date.now();
  for(let i=0;i<900;i++){
    const j=(await api(user,'/api/h3/nsfw?jobs='+sid)).jobs.find(j=>j.id===id);assert(j);
    if(['failed','canceled','needs_attention'].includes(j.state))throw Error(j.stage);
    if(j.state==='completed'&&j.cleanedUp&&j.output){active=null;return {...j,wallSeconds:(Date.now()-start)/1000};}
    await sleep(2000);
  }throw Error('Owned H3 qualification timed out');
}
try{
  assert.equal((await call(user,'/api/h3/nsfw')).status(),401);
  const u=await identity(user,'prod_h3_'),a=await identity(admin,'prod_admin_',true);page=u.page;
  for(const ctx of [user,admin])for(const route of ['/api/experiments','/api/experiments/assets'])assert.equal((await call(ctx,route)).status(),404);
  assert.equal((await call(user,'/api/h3/nsfw')).status(),403);
  await page.goto(base+'/app?tab=h3');await page.getByRole('button',{name:'H3 · Text to Image',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'H3 NSFW',exact:true}).count(),0);
  await page.goto(base+'/app?tab=settings');const access=page.getByRole('region',{name:'H3 NSFW access',exact:true});await access.getByRole('checkbox').check();await access.getByRole('button',{name:'Request NSFW approval',exact:true}).click();await access.getByText('Pending administrator approval',{exact:true}).waitFor();
  assert.equal((await call(user,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:true,version:0})).status(),403);
  await a.page.goto(base+'/app/admin/users');const toggle=a.page.getByRole('switch',{name:'H3 NSFW access for '+u.username,exact:true});await toggle.waitFor();await a.page.getByText('Approval requested',{exact:false}).first().waitFor();
  const granted=a.page.waitForResponse(r=>r.url().endsWith('/api/admin/h3-nsfw-access')&&r.request().method()==='POST');await toggle.click();assert.equal((await granted).status(),200);
  for(let i=0;i<50;i++){if((await api(user,'/api/h3/nsfw/access')).access.enabled)break;await sleep(200);}
  assert.equal((await api(user,'/api/h3/nsfw/access')).access.enabled,true);
  assert.equal(await a.page.getByRole('switch',{name:'H3 NSFW access for '+a.username,exact:true}).isDisabled(),true);
  record('Production: default-off account → Settings request → Admin enable; no self-grant; Testing 404 for users and admins');
  await a.page.goto(base+'/app?tab=testing');assert.equal(await a.page.getByRole('region',{name:'Testing workspace',exact:true}).count(),0);
  await page.goto(base+'/app?tab=h3');await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();const panel=page.getByRole('region',{name:'H3 NSFW workspace',exact:true});await panel.getByLabel('Your scene',{exact:true}).waitFor();
  const catalog=await api(user,'/api/h3/nsfw');assert.equal(catalog.environment,'prod');assert.equal(catalog.catalog.length,3);assert(catalog.capabilities.every(c=>c.modes.length===5));
  const image=path.join(out,'buzzy-reference.png');
  fs.copyFileSync('/home/shawn-rochford/AI/research/experimental-tabs-20261102-ojSrlL1V/build-suDvGm/real-story-media-tiaIWx/image-4d08e90e-e4dc-4a46-8724-ba3ed98bd905.png',image);
  const prompt='A charming white bunny with one pink ear and one white ear waves gently in a peaceful storybook meadow. Bright natural daylight, stable camera, subtle natural movement. Quiet outdoor ambience. No dialogue, no text.';
  await panel.getByLabel('Your scene',{exact:true}).fill(prompt);await panel.getByRole('button',{name:'Text',exact:true}).click();await panel.getByLabel('Duration in seconds').fill('2');await panel.getByRole('button',{name:'0.2 MP',exact:true}).click();await panel.getByRole('button',{name:'PRISM-PIKA',exact:true}).click();
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/h3/nsfw')&&r.request().postDataJSON()?.action==='generate');await panel.getByRole('button',{name:'Create video',exact:true}).click();const response=await posted;assert.equal(response.status(),202,await response.text());const first=(await response.json()).job;
  console.log(JSON.stringify({model:'prism-pika',mode:'text',job:first.id,out}));
  async function inspect(j,model,mode){
    const response=await call(user,'/api/h3/nsfw/assets?id='+j.output+'&download=1');assert.equal(response.status(),200);const bytes=await response.body();
    const file=path.join(out,model+'-'+mode+(mode==='edit-image'?'.png':'.mp4'));fs.writeFileSync(file,bytes,{mode:0o600});
    const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));const v=probe.streams.find(s=>s.codec_type==='video');assert.equal(v.width,608);assert.equal(v.height,352);
    if(mode!=='edit-image'){assert.equal(Number(v.nb_frames),48);assert.equal(v.r_frame_rate,'24/1');assert(probe.streams.some(s=>s.codec_type==='audio'));}
    assert.equal((await call(admin,'/api/h3/nsfw/assets?id='+j.output)).status(),404);
    const range=await user.request.get(base+'/api/h3/nsfw/assets?id='+j.output,{headers:{Range:'bytes=0-63'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,64);
    const receipt=await api(user,'/api/h3/nsfw?receipt='+j.id);assert.equal(receipt.testOnly,false);
    report.jobs.push({id:j.id,model,mode,seconds:j.wallSeconds,actual:j.actual,peakGpuMiB:j.peakGpuMiB,file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),probe});record(`Real production-host ${model} ${mode}: verified output, fenced cleanup and owner-scoped download`);return file;
  }
  const firstJob=await wait(first.id,first.session),video=await inspect(firstJob,'prism-pika','text');
  await panel.getByRole('link',{name:'Download video',exact:true}).waitFor();const playback=panel.getByLabel('Latest result').locator('video');await playback.evaluate(v=>v.play());await sleep(400);assert.equal(await playback.evaluate(v=>v.paused),false);await playback.evaluate(v=>v.pause());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  for(const [model,mode,inputs] of [['eros-beta7','image',[image]],['eros-beta7','reference',[image]],['pinkcherry-v18','edit',[video,image]],['pinkcherry-v18','edit-image',[image]]]){
    let s=(await api(user,'/api/h3/nsfw',{action:'create',experiment:model})).session;const sources=[];
    for(const file of inputs){const bytes=fs.readFileSync(file),r=await user.request.post(base+'/api/h3/nsfw/assets?session='+s.id+'&name='+encodeURIComponent(path.basename(file))+'&role=source',{headers:{Origin:base,'Content-Type':file.endsWith('.png')?'image/png':'video/mp4'},data:bytes});assert.equal(r.status(),201,await r.text());s=(await r.json()).session;sources.push(s.assets.at(-1).id);}
    s=(await api(user,'/api/h3/nsfw',{...s,action:'update',settings:{...s.settings,mode,seconds:2,resolution:'0.2',prompt,selectedSources:sources}})).session;
    const accepted=(await api(user,'/api/h3/nsfw',{action:'generate',id:s.id,revision:s.revision,requestId:crypto.randomUUID(),sources})).job;
    console.log(JSON.stringify({model,mode,job:accepted.id,out}));await inspect(await wait(accepted.id,s.id),model,mode);
  }
  const permission=(await api(user,'/api/h3/nsfw/access')).access;
  await api(admin,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:false,version:permission.version});
  assert.equal((await call(user,'/api/h3/nsfw/assets?id='+firstJob.output)).status(),403);
  await page.goto(base+'/app?tab=h3');assert.equal(await page.getByRole('button',{name:'H3 NSFW',exact:true}).count(),0);
  await api(admin,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:true,version:permission.version+1});
  assert.equal((await call(user,'/api/h3/nsfw/assets?id='+firstJob.output)).status(),200);
  await page.setViewportSize({width:1440,height:1000});await page.reload();await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();await panel.getByLabel('Your scene',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  record('Revocation removes user entry/downloads; reapproval preserves results; mobile/desktop playback and reload pass');
  assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(error){report.error=String(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
  if(active){try{await api(user,'/api/h3/nsfw',{action:'cancel',jobId:active});for(let i=0;i<80;i++){if((await api(user,'/api/h3/nsfw?jobs='+sessionId)).jobs.find(j=>j.id===active)?.cleanedUp)break;await sleep(1000);}}catch(error){report.cleanupError=String(error);}}
  await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,out,error:report.error}));
}
