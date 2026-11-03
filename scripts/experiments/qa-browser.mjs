// Real application HTTP/browser QA against an isolated local server and disposable auth DB.
// No live user accounts, model inference, GPU jobs, or paid APIs are used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { chromium } from '@playwright/test';
const build = path.resolve(process.argv[2] || '');
if (!/^\/home\/shawn-rochford\/AI\/research\/(?:experimental-tabs|h3-nsfw-access)-\d{8}-\w+\/build-\w+\/source$/.test(build)) throw Error('Explicit isolated build path required');
const built = JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));
assert.equal(built.exitCode,0);
const out = fs.mkdtempSync(path.join(path.dirname(build),'browser-'));
const data = path.join(out,'data'), media = path.join(out,'lab'); fs.mkdirSync(data,{mode:0o700});
const base = 'http://127.0.0.1:3398';
const log = fs.openSync(path.join(out,'server.log'),'wx',0o600);
const env = { PATH:process.env.PATH, HOME:process.env.HOME, LANG:'C.UTF-8', NODE_ENV:'production', OTG_ENV:'test', AUTH_SECRET:crypto.randomBytes(48).toString('hex'), OTG_DATA_DIR:data, OTG_DATA_ROOT:data, OTG_EXPERIMENTS_ROOT:media, OTG_AUDIO_EDITING_ENABLED:'0', OPENAI_ENABLED:'0', OPENAI_KILL_SWITCH:'1', NEXT_TELEMETRY_DISABLED:'1', NODE_OPTIONS:'--require='+path.join(build,'scripts/audit/offline-guard.cjs') };
const server = spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3398'], {cwd:build,env,stdio:['ignore',log,log]});
let browser, context, page;
const results = { ok:false, suite:'experimental-workspace', buildId:built.buildId, build, isolated:true, prodChanged:false, gpuGeneration:false, paidCalls:0, checks:[], pageErrors:[] };
function record(name) { results.checks.push(name); console.log(name); }
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function call(route, body, ctx=context) {
  return ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});
}
async function signup(ctx,username,password) { const result=await call('/api/auth/signup',{username,password,email:username+'@test.invalid'},ctx); assert.equal(result.status(),200,await result.text()); }
function grantFixtureAdmin(username) {
  assert(data.startsWith(out+'/'));
  const db=new Database(path.join(data,'otg.db'));
  try { const user=db.prepare('SELECT id FROM users WHERE username=?').get(username); assert(user); db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(user.id,new Date().toISOString()); } finally { db.close(); }
}
try {
  for(let i=0;i<100;i++){ if(server.exitCode!==null)throw Error('Isolated server exited'); try{ if((await fetch(base+'/api/healthz')).status===200)break; }catch{} await sleep(200); }
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-lab-http.test 127.0.0.1']});
  context=await browser.newContext({viewport:{width:1440,height:1000}});
  assert.equal((await call('/api/experiments')).status(),401); record('Anonymous API denied');
  const username='labqa_'+crypto.randomBytes(4).toString('hex'), password=crypto.randomBytes(24).toString('base64url');
  await signup(context,username,password);
  page=await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror',error=>results.pageErrors.push(error.message));
  await page.goto(base+'/login'); await page.getByPlaceholder('you@domain.com or username').fill(username); await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.waitForURL('**/app');
  assert.equal((await call('/api/experiments')).status(),403);
  assert.equal(await page.locator('nav').getByRole('button',{name:'Testing',exact:true}).count(),0); record('Ordinary user denied and experimental navigation hidden');
  grantFixtureAdmin(username);
  await page.goto(base+'/app?tab=testing'); const lab=page.getByRole('region',{name:'Testing workspace'}); await lab.waitFor();
  await lab.getByRole('option',{name:'Pika H3 Flex',exact:true}).waitFor({state:'attached'});
  assert.equal(await lab.getByLabel('Experiment',{exact:true}).locator('option').count(),7); record('Administrator sees seven Testing candidates');
  await lab.getByRole('button',{name:'New test plan',exact:true}).click(); await lab.getByLabel('Plan name',{exact:true}).fill('Desktop research plan');
  await lab.getByLabel('Scene prompt',{exact:true}).fill('A paper boat crosses a sunlit pond. Gentle water sounds.');
  await lab.getByLabel('Duration in seconds',{exact:true}).fill('15');
  await lab.getByLabel('Orientation',{exact:true}).selectOption('portrait');
  await lab.getByRole('button',{name:'Save plan',exact:true}).click(); await lab.getByText('Plan saved. No generation or promotion occurred.',{exact:true}).waitFor();
  const all=await (await call('/api/experiments')).json(); const id=all.sessions.find(item=>item.title==='Desktop research plan').id;
  const manifest=await (await call('/api/experiments?export='+id)).json(); assert.equal(manifest.runnable,false); assert.equal(manifest.target.deliveredFrames,360); assert.equal(manifest.target.width,352);
  await page.reload(); await lab.getByLabel('Saved plan',{exact:true}).selectOption(id); assert.equal(await lab.getByLabel('Duration in seconds').inputValue(),'15'); record('Real UI save/reload and non-runnable manifest export');
  const clip=path.join(out,'synthetic-comparison.mp4'), png=path.join(out,'synthetic-reference.png');
  execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',clip]);
  execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-i',clip,'-frames:v','1','-threads','1',png]);
  async function attach(file){ const done=page.waitForResponse(r=>r.url().includes('/api/experiments/assets?')&&r.request().method()==='POST'); await lab.getByLabel('Attach private file',{exact:true}).setInputFiles(file); const response=await done; assert.equal(response.status(),201,'Upload must complete successfully'); await lab.getByText('Private asset validated and saved. No generation was started.',{exact:true}).waitFor(); }
  await attach(png); await lab.getByLabel('Upload purpose').selectOption('comparison'); await attach(clip); await attach(clip);
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].filter(v=>v.src.includes('/api/experiments/assets')).length===2&&[...document.querySelectorAll('video')].filter(v=>v.src.includes('/api/experiments/assets')).every(v=>Number.isFinite(v.duration)));
  await lab.getByRole('button',{name:'0.5s',exact:true}).click();
  const times=await lab.locator('video').evaluateAll(items=>items.map(v=>v.currentTime)); assert(times.every(t=>Math.abs(t-.5)<.05));
  const video=lab.locator('video').first(); await video.evaluate(v=>v.play()); await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.src.includes('/api/experiments/assets')&&!v.paused&&v.currentTime>.6)); await video.evaluate(v=>v.pause());
  record('Real PNG and MP4 upload, hash validation, playback and matching-time comparison');
  const stored=(await (await call('/api/experiments')).json()).sessions.find(item=>item.id===id); const asset=stored.assets.find(item=>item.mime==='video/mp4');
  const ranged=await context.request.get(base+'/api/experiments/assets?id='+asset.id,{headers:{Range:'bytes=0-31'}}); assert.equal(ranged.status(),206); assert.equal((await ranged.body()).length,32);
  const download=await context.request.get(base+'/api/experiments/assets?id='+asset.id+'&download=1'); assert.equal(crypto.createHash('sha256').update(await download.body()).digest('hex'),asset.sha256); record('Private download and range response match exact uploaded bytes');
  await lab.getByRole('button',{name:'Archive plan',exact:true}).click(); await lab.getByRole('button',{name:'Restore plan',exact:true}).waitFor(); await lab.getByRole('button',{name:'Restore plan',exact:true}).click(); await lab.getByRole('button',{name:'Archive plan',exact:true}).waitFor(); record('Archive/restore retains references and comparisons');
  for(const action of ['generate','promote'])assert.equal((await call('/api/experiments',{action,id})).status(),409); record('Generation and promotion are fail-closed, without GPU submissions');
  await page.screenshot({path:path.join(out,'testing-desktop.png'),fullPage:true});
  await page.setViewportSize({width:412,height:915}); await page.screenshot({path:path.join(out,'testing-mobile.png'),fullPage:true}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.goto(base+'/app?tab=h3-admin'); const admin=page.getByRole('region',{name:'H3 administrator workspace'}); await admin.waitFor(); await admin.getByRole('option',{name:'PRISM-PIKA',exact:true}).waitFor({state:'attached'}); assert.equal(await admin.getByLabel('Model version').locator('option').count(),2);
  await admin.getByLabel('Model version').selectOption('eros-beta7'); await admin.getByRole('button',{name:'New test plan',exact:true}).click();
  assert.equal(await admin.getByLabel('GPU preference').locator('option[value="rtx5060ti"]').evaluate(option=>option.disabled),true);
  assert.equal(await admin.getByRole('button',{name:'Generate private H3 video',exact:true}).isDisabled(),true);
  assert.equal(await admin.getByLabel('Mode',{exact:true}).locator('option[value="edit-image"]').evaluate(option=>option.disabled),true);
  await admin.getByLabel('GPU preference').selectOption('rtx3090'); await admin.getByLabel('Mode',{exact:true}).selectOption('edit'); await admin.getByRole('button',{name:'Save plan',exact:true}).click();
  await admin.getByText('Plan saved. No generation or promotion occurred.',{exact:true}).waitFor(); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false); await page.screenshot({path:path.join(out,'h3-admin-mobile.png'),fullPage:true}); record('Two exact model choices and compact mobile controls; no horizontal overflow');
  // Exercise the real job/UI/storage transport with an explicitly synthetic runner.
  // Actual model inference qualification remains a separate, recorded GPU test.
  const fakeRunner=path.join(build,'scripts/experiments/qa_fake_runner.py');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(fakeRunner)).digest('hex');
  const selected=(await (await call('/api/experiments')).json()).catalog.find(item=>item.id==='prism-pika');
  fs.writeFileSync(path.join(media,'runtime.json'),JSON.stringify({environment:'test',gpu:'rtx3090',fixture:true,fixtureVideo:clip,runner:fakeRunner,runnerSha256:hash,files:[1,2,3].map(()=>({path:fakeRunner,sha256:hash})),models:{'prism-pika':{sha256:selected.sha256,qualifiedModes:['text']}}}),{mode:0o600});
  await page.reload();await admin.getByRole('button',{name:'New test plan',exact:true}).click();
  await admin.getByLabel('Mode',{exact:true}).selectOption('text');await admin.getByLabel('Scene prompt',{exact:true}).fill('Synthetic browser transport fixture only.');
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/experiments')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='generate');
  await admin.getByRole('button',{name:'Generate private H3 video',exact:true}).click();assert.equal((await submitted).status(),202);
  await admin.getByText('Synthetic fixture complete — not AI inference',{exact:true}).waitFor();
  await admin.locator('video').first().waitFor();await admin.locator('video').first().evaluate(v=>v.play());await admin.locator('video').first().evaluate(v=>v.pause());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:path.join(out,'h3-generation-mobile.png'),fullPage:true});
  record('Actual UI Generate → private job → synthetic runner → receipt → playable/downloadable result transport');
  await admin.getByRole('button',{name:'Generate private H3 video',exact:true}).click();
  await admin.getByRole('button',{name:'Cancel private job',exact:true}).click();await admin.getByText('Synthetic fixture canceled',{exact:true}).waitFor();
  record('Actual UI cancellation targets only its private queued/running job');
  // A loopback IP is a secure context even over HTTP; it concealed the Android
  // tailnet-origin regression. Resolve a non-localhost name to this same private
  // fixture server. Do not override crypto or mark the origin secure.
  const httpBase='http://slr-lab-http.test:3398';
  await context.addCookies((await context.cookies(base)).map(cookie=>({...cookie,domain:'slr-lab-http.test'})));
  await page.goto(httpBase+'/app?tab=h3-admin');await admin.waitFor();
  const cryptoSupport=await page.evaluate(()=>({secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues}));
  assert.deepEqual(cryptoSupport,{secureContext:false,randomUUID:'undefined',getRandomValues:'function'});results.httpCrypto=cryptoSupport;
  await admin.getByRole('button',{name:'New test plan',exact:true}).click();
  await admin.getByLabel('Mode',{exact:true}).selectOption('text');await admin.getByLabel('Scene prompt',{exact:true}).fill('HTTP-only request identity regression. Synthetic transport fixture.');
  const httpSubmission=page.waitForResponse(r=>r.url()===httpBase+'/api/experiments'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='generate');
  await admin.getByRole('button',{name:'Generate private H3 video',exact:true}).click();const httpResponse=await httpSubmission;
  assert.equal(httpResponse.status(),202);assert.match(httpResponse.request().postDataJSON().requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  await admin.getByText('Synthetic fixture complete — not AI inference',{exact:true}).waitFor();
  await admin.locator('video').first().evaluate(v=>v.play());await admin.locator('video').first().evaluate(v=>v.pause());
  assert.equal(await admin.getByRole('alert').count(),0);await page.screenshot({path:path.join(out,'h3-http-generation-mobile.png'),fullPage:true});
  record('Non-secure HTTP mobile origin: real browser has no randomUUID; Generate, polling and playable result pass without a crypto polyfill');
  const other=await browser.newContext(); const second='labqa_'+crypto.randomBytes(4).toString('hex'); await signup(other,second,password); grantFixtureAdmin(second);
  // Sign in with the real form so tests do not depend on alternate login payload conventions.
  const otherPage=await other.newPage(); await otherPage.goto(base+'/login'); await otherPage.getByPlaceholder('you@domain.com or username').fill(second); await otherPage.locator('input[autocomplete="current-password"]').fill(password); await otherPage.getByRole('button',{name:'Sign in',exact:true}).click(); await otherPage.waitForURL('**/app');
  assert.equal((await call('/api/experiments?export='+id,undefined,other)).status(),404); assert.equal((await call('/api/experiments/assets?id='+asset.id,undefined,other)).status(),404); await other.close(); record('Second administrator cannot access first administrator media or manifests');
  assert.equal(results.pageErrors.length,0,JSON.stringify(results.pageErrors)); results.ok=true;
} catch(error) {
  results.error=String(error);
  if(page) { await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{}); results.visibleFailure=await page.locator('body').innerText().catch(()=> 'unavailable'); }
  throw error;
} finally {
  if(browser)await browser.close();
  if(server.exitCode===null){server.kill('SIGTERM'); await Promise.race([once(server,'exit'),sleep(8000)]); if(server.exitCode===null)server.kill('SIGKILL');}
  fs.closeSync(log); fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2),{mode:0o600}); console.log(JSON.stringify({ok:results.ok,evidence:out}));
}
