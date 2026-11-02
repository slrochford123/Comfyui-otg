// Physical Android Chrome, isolated loopback TEST origin via explicitly scoped adb reverse.
// Never opens PROD, reads other tabs, or captures the microphone/environment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
const root=process.argv[2],serial=process.argv[3];
assert(/^\/home\/shawn-rochford\/AI\/research\/release-qualification-[\w-]+$/.test(root||''));
assert(serial&&/^[A-Za-z0-9]+$/.test(serial));
const out=fs.mkdtempSync(path.join(root,'android-')),base='http://127.0.0.1:3337';
const report={ok:false,physicalAndroid:true,browser:'Chrome',wrapperApk:false,checks:[],paidCalls:0,microphoneCaptured:false};
const adb=(...args)=>execFileSync('/home/shawn-rochford/Android/Sdk/platform-tools/adb',['-s',serial,...args],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9229',{noDefaults:true});
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base+'/'));
assert(page,'Open only the dedicated loopback TEST tab first');
await page.bringToFront();
await page.waitForFunction(()=>document.visibilityState==='visible');
// Existing Android Chrome targets do not have Playwright's synthetic hasTouch
// context. Map DOM targets to native screen pixels using Chrome's observed
// content bounds, after verifying the foreground browser is our TEST origin.
function screenshot(name){fs.writeFileSync(path.join(out,name),execFileSync('/home/shawn-rochford/Android/Sdk/platform-tools/adb',['-s',serial,'exec-out','screencap','-p'],{maxBuffer:8*1024*1024}));}
async function tap(locator){
  await locator.waitFor({state:'visible'});
  await page.evaluate(()=>document.activeElement?.blur());
  if (/mInputShown=true/.test(adb('shell','dumpsys','input_method')))
    adb('shell','input','keyevent','KEYCODE_BACK');
  await page.waitForTimeout(500);
  await locator.evaluate(el=>el.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
  await page.waitForTimeout(600);
  adb('shell','uiautomator','dump','/sdcard/slr-test-ui.xml');
  const xml=adb('shell','cat','/sdcard/slr-test-ui.xml');
  assert(xml.includes('127.0.0.1:3337'),'Foreground Android tab is not the dedicated TEST origin');
  const label=(await locator.innerText()).trim();
  const nodes=[...xml.matchAll(/<node\s+[^>]+/g)].map(m=>m[0]);
  const matches=nodes.filter(n=>n.includes('clickable="true"')&&(n.includes('text="'+label+'"')||n.includes('content-desc="'+label+'"')));
  const targetNumber=report.checks.length+'-'+label.replace(/[^a-z0-9]/gi,'-');
  screenshot('before-touch-'+targetNumber+'.png');
  fs.writeFileSync(path.join(out,'before-touch-'+targetNumber+'.xml'),xml,{mode:0o600});
  const geometry=await locator.evaluate(el=>{
    const r=el.getBoundingClientRect(),v=visualViewport;
    return {x:r.x+r.width/2-(v?.offsetLeft||0),y:r.y+r.height/2-(v?.offsetTop||0),
      height:v?.height||innerHeight,width:v?.width||innerWidth,dpr:devicePixelRatio,scale:v?.scale||1};
  });
  const coordinator=nodes.find(n=>n.includes('resource-id="com.android.chrome:id/coordinator"'));
  const bounds=coordinator?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert(bounds);
  const [,left,top,right,bottom]=bounds.map(Number);
  const scale=geometry.dpr*geometry.scale;
  const x=left+geometry.x*scale,y=bottom-(geometry.height-geometry.y)*scale;
  assert(x>left&&x<right&&y>top&&y<bottom,'Touch target is outside the native content viewport');
  console.log('Native touch '+label+' '+JSON.stringify({x,y,geometry,accessibilityMatches:matches.length}));
  adb('shell','input','tap',String(Math.round(x)),String(Math.round(y)));
}
async function api(route,body){const r=await page.evaluate(async({url,body})=>{const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,value:await r.json()};},{url:base+route,body});return r;}
function record(name){report.checks.push(name);console.log(name);}
try{
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
  await page.locator('.launch-intro-overlay').waitFor({state:'hidden',timeout:10000});
  const name='androidqa_'+crypto.randomBytes(5).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  assert.equal((await api('/api/auth/signup',{username:name,email:name+'@test.invalid',password})).status,200);report.account=name;
  await page.getByPlaceholder('you@domain.com or username').fill(name);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await tap(page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL('**/app');
  report.build=(await api('/api/app/build')).value;record('Physical Android browser sign-in and authenticated app');
  const title='Physical Android QA '+crypto.randomBytes(3).toString('hex');
  const project=await api('/api/story-creator/projects',{title,format:'short film',genre:'Drama'});assert.equal(project.status,201);report.projectId=project.value.project.id;
  assert.equal((await api('/api/story-creator/messages',{projectId:report.projectId,role:'assistant',content:'Hello. I am ready to help you tell your story.'})).status,201);
  await page.goto(base+'/app?tab=machine',{waitUntil:'domcontentloaded'});
  await tap(page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Continue',exact:true}));
  const draft=page.getByPlaceholder('Tell the Story Director what happens next...');await draft.fill('Android unsent draft survives background and return.');
  await page.waitForTimeout(750);
  await tap(page.getByRole('button',{name:'Listen',exact:true}).first());
  const audio=page.getByLabel('Story Director spoken reply',{exact:true});await audio.waitFor({timeout:60000});
  await audio.evaluate(a=>a.play());await page.waitForFunction(()=>{const a=document.querySelector('audio[aria-label="Story Director spoken reply"]');return a&&a.currentTime>.1&&!a.paused;});
  await audio.evaluate(a=>a.pause());record('Actual Android browser audio decoding and playback');
  screenshot('story.png');
  adb('shell','input','keyevent','KEYCODE_HOME');await new Promise(r=>setTimeout(r,5000));
  adb('shell','am','start','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-p','com.android.chrome');
  await page.waitForFunction(()=>document.visibilityState==='visible',{timeout:15000});
  assert.equal(await draft.inputValue(),'Android unsent draft survives background and return.');
  await page.reload({waitUntil:'domcontentloaded'});await draft.waitFor();
  assert.equal(await draft.inputValue(),'Android unsent draft survives background and return.');
  await tap(page.getByRole('button',{name:'Listen',exact:true}).first());await audio.waitFor({timeout:60000});
  await audio.evaluate(a=>a.play());await page.waitForFunction(()=>{const a=document.querySelector('audio[aria-label="Story Director spoken reply"]');return a&&a.currentTime>.1&&!a.paused;});await audio.evaluate(a=>a.pause());
  record('Android background, return, reload, retained draft and repeat talkback');
  await page.goto(base+'/app?tab=h3',{waitUntil:'domcontentloaded'});await page.locator('header').filter({hasText:'SLR Studios'}).getByRole('heading',{name:'H3',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);record('H3 deep link and physical mobile layout');
  await page.goto(base+'/app?tab=editvideo',{waitUntil:'domcontentloaded'});await tap(page.getByRole('button',{name:'Audio Editing',exact:true}));
  const workspace=page.getByTestId('unified-audio-editing');await workspace.getByLabel('Session name',{exact:true}).waitFor();
  for(const section of ['Remove','Add','Create','Enhance']){const target=workspace.getByRole('tab',{name:section,exact:true});await tap(target);await expect(target).toHaveAttribute('aria-selected','true');}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);screenshot('audio.png');
  record('All four Audio Editing tabs usable on the physical device without horizontal overflow');
  report.ok=true;
}catch(error){report.error=error.stack;console.error(error.message);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
  await api('/api/auth/logout',{}).catch(()=>{});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});
  await page.close();console.log(JSON.stringify({ok:report.ok,out}));
  // Disconnect our client without issuing Browser.close to the user's Chrome.
  process.exit(report.ok?0:1);
}
