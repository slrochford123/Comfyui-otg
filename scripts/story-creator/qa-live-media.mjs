// Post-activation TEST smoke check. No OpenAI calls, GPU jobs or existing account changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const root=path.resolve(process.argv[2]||'');
assert.match(root,/^\/home\/shawn-rochford\/AI\/research\/experimental-tabs-\d{8}-\w+$/);
const plan=JSON.parse(fs.readFileSync(path.join(root,'activation-plan.json')));
assert.equal(fs.realpathSync('/home/shawn-rochford/AI/deploy/otg-test/current'),plan.candidate);
const base='http://100.75.162.64:3001',out=fs.mkdtempSync(path.join(root,'live-story-media-'));
const report={ok:false,buildId:plan.buildId,checks:[],pageErrors:[],gpuGeneration:false,paidCalls:0};
const username='storysmoke_'+crypto.randomBytes(6).toString('hex'),password=crypto.randomBytes(30).toString('base64url');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:412,height:915}}),page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',e=>report.pageErrors.push(e.message));let created=false,projectId;
async function api(route,body,method=body===undefined?'GET':'POST'){
  const response=await context.request.fetch(base+route,{method,headers:{Origin:base},...(body===undefined?{}:{data:body})});
  const result=await response.json();assert(response.ok(),result.error||`HTTP ${response.status()}`);return result;
}
try{
  assert.equal((await context.request.get(base+'/api/story-creator/media?capabilities=1')).status(),401);
  assert.equal((await api('/experimental-workspace.json')).buildId,plan.buildId);
  await api('/api/auth/signup',{username,email:username+'@test.invalid',password});created=true;
  await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
  assert.equal((await api('/api/story-creator/media?capabilities=1')).enabled,true);
  projectId=(await api('/api/story-creator/projects',{title:'Story media activation smoke check',format:'short film',genre:'Family'})).project.id;
  await page.goto(base+'/app?tab=machine');await page.locator('article').filter({has:page.getByRole('heading',{name:'Story media activation smoke check',exact:true})}).getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('region',{name:'Story creations'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  assert.deepEqual((await api('/api/story-creator/media?projectId='+projectId)).media,[]);
  await page.screenshot({path:path.join(out,'test-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.reload();await page.getByRole('region',{name:'Story creations'}).waitFor();
  await page.screenshot({path:path.join(out,'test-desktop.png'),fullPage:true});
  assert.deepEqual(report.pageErrors,[]);
  report.checks=['Exact live TEST build marker','Anonymous access denied','Real sign-in and authenticated media endpoint','Desktop and Android-sized live Story creations UI','Reload does not generate media'];
  report.pid=Number(execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}));
  assert.equal(fs.realpathSync('/proc/'+report.pid+'/cwd'),plan.candidate);report.ok=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{
  if(created){try{
    if(projectId)await api('/api/story-creator/projects',{id:projectId},'DELETE');
    const deleted=await api('/api/auth/delete-account',{password,confirmText:'DELETE'});assert.equal(deleted.deleted.username,username);report.disposableAccountRemoved=true;
  }catch(error){report.cleanupError=String(error);report.ok=false;process.exitCode=1;}}
  await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({out,...report}));
}
