// Authenticated live TEST browser qualification. Only creates ordinary synthetic QA data.
// No billable requests or GPU generations. Does not change deployment settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';

const root=process.argv[2];
if(!/^\/home\/shawn-rochford\/AI\/research\/release-qualification-[\w-]+$/.test(root||''))throw Error('Explicit qualification directory required');
const out=fs.mkdtempSync(path.join(root,'browser-'));
const capture=path.join(out,'microphone-fixture.wav');
execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-i','/home/shawn-rochford/AI/research/story-talkback-20261101-hWKhWD23/inference-2/paradee-af_heart-first.wav','-ar','48000','-ac','1','-c:a','pcm_s16le',capture]);
const base='http://127.0.0.1:3001';
const results={ok:false,base,checks:[],pages:[],pageErrors:[],failedRequests:[],capabilities:{},physicalAndroid:false,paidRequests:0,gpuGeneration:false};
const record=(name,detail=true)=>{results.checks.push({name,detail});console.log(name);};
let browser,context,page;
async function api(route,body){const r=await context.request.fetch(base+route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()};}
async function screenshot(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
try{
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+capture]});
  context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['microphone']});
  page=await context.newPage();
  page.on('pageerror',e=>results.pageErrors.push(e.message));
  page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')results.failedRequests.push({url:r.url().replace(/\?.*$/,''),error:r.failure()?.errorText});});
  const username='releaseqa_'+crypto.randomBytes(5).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  results.account=username;
  const signup=await api('/api/auth/signup',{username,password,email:username+'@test.invalid'});assert.equal(signup.status,200,JSON.stringify(signup.value));
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
  await page.getByPlaceholder('you@domain.com or username').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/app',{timeout:30000});
  await page.locator('header').getByRole('heading',{name:'Generate',exact:true}).waitFor();
  record('Real UI sign-in with ordinary synthetic account');
  const identity=await api('/api/app/build');assert.equal(identity.status,200);results.build=identity.value;
  const connection=await api('/api/openai-ai/status',{});assert.equal(connection.status,200);results.capabilities.openai=connection.value.connection;
  record('Live TEST non-billable OpenAI authentication probe',connection.value.connection.probe);
  for(const route of ['/api/edit-video/audio','/api/media-gpu'])results.capabilities[route]=await api(route);
  const title='Release QA '+crypto.randomBytes(3).toString('hex');
  const project=await api('/api/story-creator/projects',{title,format:'short film',genre:'Drama'});assert.equal(project.status,201);const projectId=project.value.project.id;results.projectId=projectId;
  const message=await api('/api/story-creator/messages',{projectId,role:'assistant',content:'Hello. I am ready to help you tell your story. We can develop the characters and the next scene together.'});assert.equal(message.status,201);
  await page.goto(base+'/app?tab=machine',{waitUntil:'domcontentloaded'});
  await page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Continue',exact:true}).click();
  const draft=page.getByPlaceholder('Tell the Story Director what happens next...');await draft.waitFor();
  await draft.fill('Unsent café direction: keep Mara and Elin together.');
  // Wait for debounced draft persistence, not for model inference.
  await page.waitForTimeout(750);
  await page.reload({waitUntil:'domcontentloaded'});await draft.waitFor();
  await page.waitForFunction(()=>document.querySelector('textarea[placeholder="Tell the Story Director what happens next..."]')?.value==='Unsent café direction: keep Mara and Elin together.');
  record('Story draft and selected project survive reload');
  await page.getByText('Voice settings',{exact:true}).click();
  const engines=page.locator('select').filter({has:page.getByRole('option',{name:/Paradee/})});
  await engines.selectOption('paradee');
  const voices=page.locator('select').filter({has:page.getByRole('option',{name:/Heart/})});
  for(const voice of ['af_heart','am_puck','bf_isabella','bm_fable']){
    await voices.selectOption(voice);
    const speechRequest=page.waitForResponse(r=>r.url().endsWith('/api/story-creator/speech')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Listen',exact:true}).first().click();
    const accepted=await speechRequest;assert(accepted.ok());
    const acceptedJob=await accepted.json();assert.equal(acceptedJob.job.voice,voice);
    const audio=page.getByLabel('Story Director spoken reply',{exact:true});await audio.waitFor({timeout:60000});
    await page.waitForFunction(()=>{const a=document.querySelector('audio[aria-label="Story Director spoken reply"]');return a&&Number.isFinite(a.duration)&&a.duration>0;});
    await audio.evaluate(a=>a.play());
    await page.waitForFunction(()=>{const a=document.querySelector('audio[aria-label="Story Director spoken reply"]');return a&&!a.paused&&a.currentTime>0.05;});
    const duration=await audio.evaluate(a=>{a.pause();return a.duration;});
    record('Browser real Paradee synthesis and playback: '+voice,{duration,jobId:acceptedJob.job.id});
  }
  await screenshot('story-desktop');
  await page.reload({waitUntil:'domcontentloaded'});await draft.waitFor();
  await page.getByText('Voice settings',{exact:true}).click();
  assert.equal(await engines.inputValue(),'paradee');assert.equal(await voices.inputValue(),'bm_fable');
  record('Voice preference retained after reload');
  await page.setViewportSize({width:412,height:915});
  await screenshot('story-mobile');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  record('Mobile-width Story Creator has no horizontal overflow');
  // Simulate a temporary network loss; no speech or generation is submitted while offline.
  await context.setOffline(true);await draft.fill('Offline draft retained until reconnect.');await page.waitForTimeout(750);
  await context.setOffline(false);await page.reload({waitUntil:'domcontentloaded'});await draft.waitFor();
  await page.waitForFunction(()=>document.querySelector('textarea[placeholder="Tell the Story Director what happens next..."]')?.value==='Offline draft retained until reconnect.');
  record('Offline draft survives reconnect and reload');
  await draft.fill('Dictation prefix.');
  await page.getByRole('button',{name:'Record Story Director voice note',exact:true}).click();
  await page.getByRole('button',{name:'Stop Record Story Director voice note',exact:true}).waitFor();
  await page.waitForTimeout(8100);
  await page.getByRole('button',{name:'Stop Record Story Director voice note',exact:true}).click();
  const transcription=page.waitForResponse(r=>r.url().includes('/api/story-creator/transcribe')&&r.request().method()==='POST',{timeout:120000});
  await page.getByRole('button',{name:'Transcribe recording',exact:true}).click();
  const transcriptResponse=await transcription;assert.equal(transcriptResponse.status(),200);
  const transcript=await transcriptResponse.json();assert(transcript.text?.split(/\s+/).length>5);
  await page.waitForFunction(()=>{const value=document.querySelector('textarea[placeholder="Tell the Story Director what happens next..."]')?.value||'';return value.startsWith('Dictation prefix.')&&value.length>50;});
  record('Browser MediaRecorder capture, local transcription and draft merge',{syntheticMicrophone:true,physicalMicrophone:false,transcript:transcript.text});
  const headings={generate:'Generate',h3:'H3',characters:'Characters',editvideo:'Edit Video',settings:'Settings',gethelp:'AI Assistance',storyboard:'Production',support:'Support'};
  for(const tab of Object.keys(headings)){
    const r=await page.goto(base+'/app?tab='+tab,{waitUntil:'domcontentloaded'});assert.equal(r.status(),200);
    await page.locator('header').filter({hasText:'SLR Studios'}).getByRole('heading',{name:headings[tab],exact:true}).waitFor();
    const text=await page.locator('body').innerText();
    assert(!/Application error: a client-side exception/.test(text));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    results.pages.push({tab,heading:await page.locator('h1').allTextContents(),overflow});
    await screenshot('mobile-'+tab);
  }
  record('Eight authenticated main sections render at mobile width',results.pages);
  await page.goto(base+'/app?tab=editvideo',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Audio Editing',exact:true}).click();
  const workspace=page.getByTestId('unified-audio-editing');await workspace.waitFor();
  await workspace.getByLabel('Session name',{exact:true}).waitFor();
  for(const section of ['Remove','Add','Create','Enhance']){
    await workspace.getByRole('tab',{name:section,exact:true}).click();
    assert.equal(await workspace.getByRole('tab',{name:section,exact:true}).getAttribute('aria-selected'),'true');
    await screenshot('audio-'+section.toLowerCase());
  }
  assert.equal((await api('/api/edit-video/audio')).value.capabilities.enabled,true);
  record('Managed TEST Audio Editing enabled; all four tool tabs usable at mobile width');
  assert.deepEqual(results.pageErrors,[]);
  results.ok=true;
}catch(error){results.error=error.stack;console.error(error.message);process.exitCode=1;await screenshot('failure').catch(()=>{});if(page)fs.writeFileSync(path.join(out,'failure-text.txt'),await page.locator('body').innerText().catch(()=>''),{mode:0o600});}
finally{
  if(context)await api('/api/auth/logout',{}).catch(()=>{});
  await browser?.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2),{mode:0o600});console.log(JSON.stringify({ok:results.ok,out}));
}
