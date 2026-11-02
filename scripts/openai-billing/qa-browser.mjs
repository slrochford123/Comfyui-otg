// Real browser, API and private-store tests on a disposable local instance. No real OpenAI calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import Database from 'better-sqlite3';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/openai-billing-fix-\d{8}-\w+\/build-\w+\/source$/.test(build))throw Error('Explicit isolated build required');
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));assert.equal(built.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'browser-')),data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
const base='http://127.0.0.1:3397',log=fs.openSync(path.join(out,'server.log'),'wx',0o600);
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+path.join(build,'scripts/audit/offline-guard.cjs')};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3397'],{cwd:build,env,stdio:['ignore',log,log]});
const report={ok:false,buildId:built.buildId,checks:[],pageErrors:[],paidCalls:0,realBillingCalls:0,prodChanged:false};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let browser,page,context;
const record=name=>{report.checks.push(name);console.log(name);};
async function call(body){return context.request.fetch(base+'/api/admin/openai-billing',{method:body?'POST':'GET',headers:{Origin:base},...(body?{data:body}:{})});}
try {
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Isolated server exited');try{if((await fetch(base+'/api/healthz')).ok)break;}catch{}await sleep(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000}});
  assert.equal((await call()).status(),401);record('Anonymous billing access denied');
  const username='billingqa_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  assert.equal((await context.request.post(base+'/api/auth/signup',{headers:{Origin:base},data:{username,password,email:username+'@test.invalid'}})).status(),200);
  page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
  assert.equal((await call()).status(),403);record('Non-admin billing access denied');
  const db=new Database(path.join(data,'otg.db'));const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(user.id,new Date().toISOString());db.close();
  await page.goto(base+'/app/admin/openai-billing');await page.getByRole('heading',{name:'Connect billing once'}).waitFor();
  await page.getByText('No local requests are recorded on this installation.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Sync Official Costs',exact:true}).isDisabled(),true);record('Empty installation explains missing billing connection and unknown values');
  assert.equal((await call({action:'credit',type:'starting_balance',amountUsd:''})).status(),400);
  assert.equal((await call({action:'credit',type:'starting_balance',amountUsd:1,effectiveAt:'invalid'})).status(),400);
  const hostile=await context.request.post(base+'/api/admin/openai-billing',{headers:{Origin:'https://untrusted.invalid'},data:{action:'credit',amountUsd:9}});assert.equal(hostile.status(),403);record('Blank credits, invalid dates and cross-origin writes rejected');
  await page.getByLabel('Amount USD',{exact:true}).fill('109.58');await page.getByRole('button',{name:'Record credit entry',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('$109.58'));
  let result=await (await call()).json();assert.equal(result.overview.estimatedPrepaidBalanceUsd,109.58);assert.equal(result.overview.creditBalanceVerified,false);record('Credit form saves a timestamped portal baseline through real API without crashing');
  await page.getByLabel('Low balance warnings',{exact:true}).fill('20, 10');const savedWarnings=page.waitForResponse(r=>r.url().includes('/api/admin/openai-billing')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save warnings',exact:true}).click();await savedWarnings;
  await page.reload();await page.getByText('$109.58',{exact:true}).first().waitFor();result=await (await call()).json();assert.deepEqual(result.overview.lowBalanceWarningsUsd,[20,10]);record('Warnings and balance persist across reload; mutation envelope is handled correctly');
  // Explicit fixture of a complete official Costs sync, including another app's spending.
  const billingFile=path.join(data,'openai/billing.json'),saved=JSON.parse(fs.readFileSync(billingFile));const today=Math.floor(Date.now()/86400000)*86400000;
  saved.settings={...saved.settings,lastOfficialSyncAt:Date.now(),lastOfficialAttemptAt:Date.now(),lastOfficialSyncStatus:'ok',officialSyncEnabled:true,officialWindowStart:today-30*86400000,officialWindowEnd:Date.now()};
  saved.officialCosts=[{startTime:(today-86400000)/1000,endTime:today/1000,amountUsd:14,projectId:'fixture-only',lineItem:'text'}];fs.writeFileSync(billingFile,JSON.stringify(saved),{mode:0o600});
  await page.getByRole('button',{name:'Refresh dashboard',exact:true}).click();await page.getByRole('region',{name:'Spending rate'}).getByText('$2.00',{exact:true}).waitFor();assert.equal((await (await call()).json()).overview.spendingRate.projected30DayUsd,60);record('Seven-day rate and projection render from a known official-cost fixture, without claiming live sync');
  await page.screenshot({path:path.join(out,'billing-desktop.png'),fullPage:true});await page.setViewportSize({width:412,height:915});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:path.join(out,'billing-mobile.png'),fullPage:true});record('412px mobile and desktop render without horizontal overflow');
  assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));report.ok=true;
}catch(error){report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),sleep(8000)]);if(server.exitCode===null)server.kill('SIGKILL');}fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,evidence:out}));}
