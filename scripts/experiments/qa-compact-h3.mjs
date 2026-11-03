// Real browser/API/private storage verification. Synthetic media transport only;
// no GPU inference, live accounts, paid providers or production mutations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import Database from 'better-sqlite3';
import {chromium} from '@playwright/test';
import {checkSnapshotFlow} from './qa-snapshot-flow.mjs';
const build=path.resolve(process.argv[2]||'');
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/(?:experimental-tabs|h3-nsfw-access)-\d{8}-\w+\/build-\w+\/source$/);
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'browser-compact-'));
const data=path.join(out,'data'),lab=path.join(out,'lab');for(const dir of [data,lab])fs.mkdirSync(dir,{mode:0o700});
const base='http://127.0.0.1:3395', log=fs.openSync(path.join(out,'server.log'),'wx',0o600);
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_EXPERIMENTS_ROOT:lab,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+path.join(build,'scripts/audit/offline-guard.cjs')};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3395'],{cwd:build,env,stdio:['ignore',log,log]});
const report={ok:false,suite:'h3-nsfw-compact',buildId:meta.buildId,realInference:false,gpuGeneration:false,paidCalls:0,prodChanged:false,checks:[],pageErrors:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms)), hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let browser,page,user,admin,activeJob;
const record=name=>{report.checks.push(name);console.log(name);};
async function call(ctx,route,body){return ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});}
async function identity(ctx,prefix,administrator=false){
  const username=prefix+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  const signup=await call(ctx,'/api/auth/signup',{username,password,email:username+'@test.invalid'});assert.equal(signup.status(),200,await signup.text());
  const db=new Database(path.join(data,'otg.db'));let id;
  try{id=db.prepare('SELECT id FROM users WHERE username=?').get(username).id;if(administrator)db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(id,new Date().toISOString());}finally{db.close();}
  const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>report.pageErrors.push(e.message));
  await p.goto(base+'/login');await p.getByPlaceholder('you@domain.com or username').fill(username);await p.locator('input[autocomplete="current-password"]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL('**/app');return {page:p,id};
}
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Fixture exited');try{if((await fetch(base+'/api/healthz')).ok)break;}catch{}await delay(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-lab-http.test 127.0.0.1']});
  user=await browser.newContext({viewport:{width:412,height:915}});admin=await browser.newContext();
  assert.equal((await call(user,'/api/h3/nsfw')).status(),401);
  const a=await identity(admin,'compact_admin_',true),u=await identity(user,'compact_user_');page=u.page;
  assert.equal((await call(user,'/api/h3/nsfw')).status(),403);
  assert.equal((await call(admin,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:true,version:0})).status(),200);
  const catalog=(await(await call(user,'/api/h3/nsfw')).json()).catalog;
  const clip=path.join(out,'fixture.mp4'),png=path.join(out,'reference-one.png'),png2=path.join(out,'reference-two.png');
  execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',clip]);
  execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-i',clip,'-frames:v','1','-threads','1',png]);fs.copyFileSync(png,png2);
  const runner=path.join(build,'scripts/experiments/qa_fake_runner.py'),digest=hash(fs.readFileSync(runner));
  fs.writeFileSync(path.join(lab,'runtime.json'),JSON.stringify({environment:'test',gpu:'rtx3090',permissionGuardVersion:1,fixture:true,fixtureVideo:clip,runner,runnerSha256:digest,files:[1,2,3].map(()=>({path:runner,sha256:digest})),models:Object.fromEntries(catalog.map(c=>[c.id,{sha256:c.sha256,qualifiedModes:['text','image','reference','edit','edit-image'],recipe:{steps:['prism-pika','eros-beta7'].includes(c.id)?8:20,sampler:'euler',scheduler:'simple',attention:'dense',note:'Synthetic browser fixture; not inference evidence.'}}]))}),{mode:0o600});
  const httpBase='http://slr-lab-http.test:3395';await user.addCookies((await user.cookies(base)).map(cookie=>({...cookie,domain:'slr-lab-http.test'})));
  await page.goto(httpBase+'/app?tab=h3');await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();
  const panel=page.getByRole('region',{name:'H3 NSFW workspace',exact:true});await panel.getByLabel('Your scene',{exact:true}).waitFor();
  const browserCrypto=await page.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID}));assert.deepEqual(browserCrypto,{secure:false,uuid:'undefined'});report.httpCrypto=browserCrypto;
  assert.equal(await panel.getByRole('button',{name:'New generation session',exact:true}).count(),0);
  const prompt=panel.getByLabel('Your scene',{exact:true});await prompt.fill('A paper boat floats on a quiet pond.');
  await panel.getByRole('button',{name:'Clear text',exact:true}).click();assert.equal(await prompt.inputValue(),'');
  await panel.getByRole('button',{name:'Undo text',exact:true}).click();assert.equal(await prompt.inputValue(),'A paper boat floats on a quiet pond.');
  let enhanceCalls=0;
  await page.route('**/api/enhance-prompt',route=>{enhanceCalls++;const payload=route.request().postDataJSON();assert.equal(payload.workflowLabel,'MiniMax H3');assert.equal(payload.enhanceLevel,'medium');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enhancedPrompt:'A red paper boat glides across a quiet sunlit pond.'})});});
  await panel.getByRole('button',{name:'Enhance',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#private-h3-prompt')?.value.startsWith('A red paper boat'));
  await panel.getByRole('button',{name:'Undo text',exact:true}).click();assert.equal(await prompt.inputValue(),'A paper boat floats on a quiet pond.');assert.equal(enhanceCalls,1);
  await page.unroute('**/api/enhance-prompt');
  await page.route('**/api/enhance-prompt',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA provider unavailable; original text preserved.'})}));
  await panel.getByRole('button',{name:'Enhance',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal(await prompt.inputValue(),'A paper boat floats on a quiet pond.');
  record('HTTP mobile: direct prompt entry, Clear/Undo, provider enhancement request and recoverable error; no paid request');
  await panel.getByRole('button',{name:'Reference',exact:true}).click();
  async function upload(file){const done=page.waitForResponse(r=>r.url().includes('/api/h3/nsfw/assets?')&&r.request().method()==='POST');await panel.getByLabel('Add reference file',{exact:true}).setInputFiles(file);assert.equal((await done).status(),201);await panel.getByRole('button',{name:'Remove '+path.basename(file),exact:true}).waitFor();await panel.getByText('Saved',{exact:true}).waitFor();}
  await upload(png);await upload(png2);
  const state=async()=>(await(await call(user,'/api/h3/nsfw')).json()).sessions;
  let session=(await state())[0];assert.equal(session.assets.length,2);assert.equal(session.settings.selectedSources.length,2);const sid=session.id,first=session.settings.selectedSources[0];let second=session.settings.selectedSources[1];
  await panel.getByRole('button',{name:'Remove reference-one.png',exact:true}).click();await panel.getByRole('article',{name:'Reference reference-one.png',exact:true}).waitFor({state:'hidden'});
  await panel.getByRole('button',{name:'Undo removal',exact:true}).click();await panel.getByRole('article',{name:'Reference reference-one.png',exact:true}).waitFor();
  await panel.getByRole('button',{name:'Clear inputs',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();assert.deepEqual((await state())[0].settings.selectedSources,[]);assert.equal((await state())[0].assets.length,2);
  await page.reload();await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();assert.equal(await panel.getByRole('article').count(),0);
  await panel.getByText('Saved uploads · 2',{exact:true}).click();await panel.getByRole('button',{name:'Add back reference-two.png',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();
  session=(await state())[0];assert.deepEqual(session.settings.selectedSources,[second]);assert.equal((await call(user,'/api/h3/nsfw/assets?id='+first)).status(),200);
  report.snapshotChecks=await checkSnapshotFlow({page,panel,user,call,state,out,sid,record});second=report.snapshotChecks.assetId;
  assert.equal(catalog.length,3);assert.equal(catalog.some(c=>c.id==='dasiwa-v4'),false);
  assert.equal(await panel.getByRole('button',{name:'DaSiWa · Hybrid v4',exact:true}).count(),0);
  assert.equal((await call(user,'/api/h3/nsfw',{action:'create',experiment:'dasiwa-v4'})).status(),409);
  await panel.getByRole('button',{name:'PinkCherry · v1.8 Hybrid',exact:true}).click();assert.equal(await prompt.inputValue(),'A paper boat floats on a quiet pond.');assert.equal(await panel.getByRole('article').count(),1);assert.equal(await panel.getByRole('button',{name:'Turbo',exact:true}).isDisabled(),true);
  await panel.getByRole('button',{name:'PRISM-PIKA',exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Native',exact:true}).isDisabled(),true);
  await panel.getByRole('button',{name:'Portrait',exact:true}).click();await panel.getByLabel('Duration in seconds').fill('15');await panel.getByRole('button',{name:'0.6 MP',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:path.join(out,'compact-mobile.png'),fullPage:true});
  await page.setViewportSize({width:360,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'compact-mobile-360.png'),fullPage:true});
  record('Upload autoselection → visible Remove/Undo/Clear → persisted reload → saved-file recovery; model switch preserves inputs; 360/412px layouts');
  await panel.getByLabel('Duration in seconds').fill('2');await panel.getByRole('button',{name:'0.2 MP',exact:true}).click();await panel.getByRole('button',{name:'Landscape',exact:true}).click();
  const accepted=page.waitForResponse(r=>r.url().endsWith('/api/h3/nsfw')&&r.request().postDataJSON()?.action==='generate');await panel.getByRole('button',{name:'Create video',exact:true}).click();const response=await accepted;assert.equal(response.status(),202,await response.text());activeJob=(await response.json()).job.id;
  await panel.getByText('Synthetic fixture complete — not AI inference',{exact:true}).waitFor();await panel.getByRole('link',{name:'Download video',exact:true}).waitFor();
  const request=JSON.parse(fs.readFileSync(path.join(lab,'jobs',activeJob,'request.json')));assert.deepEqual(request.sources.map(s=>s.assetId),[second]);assert.equal(request.settings.seconds,2);assert.equal(request.settings.orientation,'landscape');assert.match(request.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(request.sources[0].sha256,report.snapshotChecks.sha256);report.snapshotChecks.immutableJobReference=true;
  const outputId=(await(await call(user,'/api/h3/nsfw?jobs='+sid)).json()).jobs[0].output;
  const downloaded=await call(user,'/api/h3/nsfw/assets?id='+outputId+'&download=1');assert.equal(hash(await downloaded.body()),hash(fs.readFileSync(clip)));
  const video=panel.getByLabel('Latest result').locator('video');await video.evaluate(v=>v.play());await delay(300);assert.equal(await video.evaluate(v=>v.paused),false);await video.evaluate(v=>v.pause());activeJob=null;
  record('Create video → real private job/API → synthetic runner with only selected reference → playable latest result/download; safe UUID over HTTP');
  assert.equal(Number.isSafeInteger(request.settings.seed),true);assert.notEqual(request.settings.seed,424242);assert.equal(request.settings.seedLocked,false);
  assert.equal(await panel.getByRole('checkbox',{name:'Lock seed',exact:true}).isChecked(),false);
  // Drop a real accepted response, then retry through the same UI. The saved
  // immutable job seed and request ID must survive the uncertain submission.
  let lostJob,lostRequestId;const retried=[];
  await page.route('**/api/h3/nsfw',async route=>{
    if(route.request().method()!=='POST'||route.request().postDataJSON()?.action!=='generate')return route.continue();
    const body=route.request().postDataJSON();retried.push(body.requestId);
    if(!lostJob){const accepted=await call(user,'/api/h3/nsfw',body);assert.equal(accepted.status(),202);lostJob=(await accepted.json()).job.id;lostRequestId=body.requestId;await route.abort('failed');}else await route.continue();
  });
  await panel.getByRole('button',{name:'Create video',exact:true}).click();await panel.getByRole('alert').waitFor();
  assert(lostJob);const retryResponse=page.waitForResponse(r=>r.url().endsWith('/api/h3/nsfw')&&r.request().postDataJSON()?.action==='generate');
  await panel.getByRole('button',{name:'Create video',exact:true}).click();const retry=await retryResponse;assert.equal(retry.status(),202);assert.equal((await retry.json()).job.id,lostJob);assert.deepEqual(retried,[lostRequestId,lostRequestId]);await page.unroute('**/api/h3/nsfw');
  async function finish(id){
    activeJob=id;let job;
    for(let i=0;i<60;i++){job=(await(await call(user,'/api/h3/nsfw?jobs='+sid)).json()).jobs.find(j=>j.id===id);if(job?.state==='completed'&&job.cleanedUp)break;await delay(250);}
    assert.equal(job?.state,'completed');assert.equal(job.cleanedUp,true);
    await panel.locator('a').filter({hasText:'Download video'}).and(panel.locator(`a[href*="${job.output}"]`)).waitFor();
    activeJob=null;return JSON.parse(fs.readFileSync(path.join(lab,'jobs',id,'request.json'))).settings.seed;
  }
  const secondSeed=await finish(lostJob);assert.notEqual(secondSeed,request.settings.seed);
  async function generateSeed(){const done=page.waitForResponse(r=>r.url().endsWith('/api/h3/nsfw')&&r.request().postDataJSON()?.action==='generate');await panel.getByRole('button',{name:'Create video',exact:true}).click();const r=await done;assert.equal(r.status(),202,await r.text());return finish((await r.json()).job.id);}
  await panel.getByRole('checkbox',{name:'Lock seed',exact:true}).check();await panel.getByText('Advanced settings & help',{exact:true}).click();
  await panel.getByLabel('Seed',{exact:true}).fill('0');assert.equal(await generateSeed(),0);assert.equal(await generateSeed(),0);
  await page.reload();await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('checkbox',{name:'Lock seed',exact:true}).isChecked(),true);
  await panel.getByText('Advanced settings & help',{exact:true}).click();assert.equal(await panel.getByLabel('Seed',{exact:true}).inputValue(),'0');
  await page.screenshot({path:path.join(out,'seed-locked-mobile.png'),fullPage:true});
  await panel.getByRole('checkbox',{name:'Lock seed',exact:true}).uncheck();assert.equal(await panel.getByLabel('Seed',{exact:true}).isDisabled(),true);
  assert.notEqual(await generateSeed(),0);await panel.getByText('Advanced settings & help',{exact:true}).click();
  report.seedChecks={randomPerNewJob:true,lockedZeroReused:true,lockSurvivesReload:true,unlockRestoresRandom:true,lostResponseSameRequestAndSeed:true};
  record('Random per new job; lost accepted response retries same durable ID/seed; locked seed zero reused twice and survives reload; unlocking restores randomness');
  await panel.getByRole('button',{name:'Create video',exact:true}).click();await panel.getByRole('button',{name:'Cancel job',exact:true}).click();await panel.getByText('Synthetic fixture canceled',{exact:true}).waitFor();
  await panel.getByText('History & saved drafts',{exact:true}).click();await panel.locator('summary').filter({hasText:'prism-pika · completed'}).first().click();assert.equal(await panel.getByRole('link',{name:'Download result',exact:true}).count(),1);
  await panel.getByRole('button',{name:'New draft',exact:true}).click();assert.equal(await prompt.inputValue(),'');await panel.getByLabel('Saved draft',{exact:true}).selectOption(sid);await page.waitForFunction(()=>document.querySelector('#private-h3-prompt')?.value.includes('paper boat'));assert.match(await prompt.inputValue(),/paper boat/);assert.equal(await panel.getByRole('article').count(),1);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'compact-desktop.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  // Retired model fixture: immutable jobs/media remain owned and downloadable,
  // but stale clients cannot create, switch to, or submit that model again.
  const beforeRetirement=(await state()).find(s=>s.id===sid);
  const fixtureDb=new Database(path.join(lab,'experiments.sqlite'));
  try{fixtureDb.prepare('UPDATE sessions SET experiment=?, revision=revision+1 WHERE id=?').run('dasiwa-v4',sid);}finally{fixtureDb.close();}
  const historical=(await state()).find(s=>s.id===sid);assert.equal(historical.experiment,'dasiwa-v4');
  assert.equal((await call(user,'/api/h3/nsfw',{action:'generate',id:sid,requestId:crypto.randomUUID()})).status(),409);
  assert.equal((await call(user,'/api/h3/nsfw?export='+sid)).status(),200);
  const preserved=await call(user,'/api/h3/nsfw/assets?id='+outputId+'&download=1');assert.equal(hash(await preserved.body()),hash(fs.readFileSync(clip)));
  await page.reload();await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();
  // The fixture changed the server record behind a cached active-model draft;
  // resolve that intentional conflict through the existing recovery control.
  await panel.getByRole('button',{name:'Use server draft',exact:true}).click();
  await panel.getByText(/DaSiWa.*was removed/).waitFor();assert.equal(await prompt.inputValue(),beforeRetirement.settings.prompt);
  assert.equal(await panel.getByRole('button',{name:'Create video',exact:true}).isDisabled(),true);
  await panel.getByRole('button',{name:'PinkCherry · v1.8 Hybrid',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();
  const replaced=(await state()).find(s=>s.id===sid);assert.equal(replaced.experiment,'pinkcherry-v18');assert.deepEqual(replaced.assets,beforeRetirement.assets);assert.deepEqual(replaced.settings,beforeRetirement.settings);
  assert.equal((await call(user,'/api/h3/nsfw',{...replaced,action:'update',experiment:'dasiwa-v4'})).status(),409);
  report.retirementChecks={retiredChoiceAbsent:true,createDenied:true,generateDenied:true,switchToRetiredDenied:true,oldMediaDownloadUnchanged:true,oldDraftPreserved:true,replacementPreservesInputs:true};
  record('DaSiWa removed from choices and blocked by API; historical draft/media/export retained; replacement keeps all inputs');
  assert.equal((await call(admin,'/api/h3/nsfw?export='+sid)).status(),404);assert.equal((await call(admin,'/api/h3/nsfw/assets?id='+outputId)).status(),404);assert.equal((await call(user,'/api/experiments')).status(),403);
  assert.equal((await call(admin,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:false,version:1})).status(),200);
  assert.equal((await call(user,'/api/h3/nsfw/assets?id='+outputId)).status(),403);await panel.waitFor({state:'hidden',timeout:15000});assert(fs.existsSync(path.join(lab,outputId+'.media')));
  record('Cancel own job; New/reload saved drafts and prior downloads retained; cross-owner denial and revocation still enforced');
  assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));report.ok=true;
}catch(error){report.error=String(error);if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});report.visibleFailure=await page.locator('body').innerText().catch(()=>'unavailable');}throw error;}
finally{
  if(activeJob){const dir=path.join(lab,'jobs',activeJob);if(fs.existsSync(dir))fs.writeFileSync(path.join(dir,'cancel'),'QA-owned cancellation\n');await delay(2500);}
  if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),delay(8000)]);if(server.exitCode===null)server.kill('SIGKILL');}fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,evidence:out}));
}
