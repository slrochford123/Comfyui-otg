// Exact-build browser -> API -> durable store checks with synthetic media and a LOCAL model fixture.
// No real OpenAI requests or GPU inference. See separate real-model qualification.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
const build=path.resolve(process.argv[2]||'');
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/(?:experimental-tabs|h3-nsfw-access)-\d{8}-\w+\/build-\w+\/source$/);
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'browser-story-media-')),data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
const base='http://127.0.0.1:3394',report={ok:false,suite:'story-media',buildId:meta.buildId,paidCalls:0,realInference:false,checks:[],pageErrors:[],fixtureRequests:0};
const record=name=>{report.checks.push(name);console.log(name);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const provider=http.createServer(async(req,res)=>{
  try {
    assert.equal(req.url,'/v1/responses');let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);assert.equal(body.tools[0].name,'create_story_media');assert.equal(body.parallel_tool_calls,false);report.fixtureRequests++;
    const source=body.input.at(-1).content;
    const call={type:'function_call',id:'fc_fixture',name:'create_story_media',call_id:'call_fixture',arguments:JSON.stringify({operation:'image',subject:'character',name:'',prompt:'A white bunny with one pink ear, friendly storybook illustration.',text:'',sourceId:'',evidence:source})};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{id:'resp_fixture',status:'completed',output:[call],usage:{input_tokens:50,output_tokens:40,total_tokens:90}}})+'\n\n');
  } catch(error){res.writeHead(500);res.end(String(error));}
});await new Promise(r=>provider.listen(3393,'127.0.0.1',r));
const log=fs.openSync(path.join(out,'server.log'),'wx',0o600);
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_API_KEY:'local-fixture-only',OPENAI_BASE_URL:'http://127.0.0.1:3393/v1',OPENAI_KILL_SWITCH:'0',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+path.join(build,'scripts/audit/offline-guard.cjs')};
if(process.env.STORY_QA_MODE==='prod'){env.OTG_ENV='prod';env.OTG_STORY_MEDIA_ENABLED='1';report.environment='prod';}
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3394'],{cwd:build,env,stdio:['ignore',log,log]});
let browser,context,page;
async function api(route,body,ctx=context){const r=await ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});return {status:r.status(),value:await r.json()};}
try {
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Fixture server exited');try{if((await fetch(base+'/api/healthz')).ok)break;}catch{}await sleep(200);}
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-story-http.test 127.0.0.1']});
  context=await browser.newContext({viewport:{width:412,height:915}});
  assert.equal((await api('/api/story-creator/media?projectId=x')).status,401);
  const username='storymediaqa_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
  assert.equal((await api('/api/auth/signup',{username,password,email:username+'@test.invalid'})).status,200);
  page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
  const created=await api('/api/story-creator/projects',{title:'Buzzy media QA',format:'short film',genre:'Family'});assert.equal(created.status,201);const projectId=created.value.project.id;
  await page.goto(base+'/app?tab=machine');await page.locator('article').filter({has:page.getByRole('heading',{name:'Buzzy media QA',exact:true})}).getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByPlaceholder('Tell the Story Director what happens next...').fill('Generate an image of a bunny with one pink ear.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByLabel('Character name',{exact:true}).waitFor();assert.equal(report.fixtureRequests,1);
  let media=(await api('/api/story-creator/media?projectId='+projectId)).value.media;assert.equal(media.length,1);assert.equal(media[0].status,'needs_name');
  record('Actual conversation uses function calling and persists an unnamed character card; no GPU action');
  await page.reload();await page.getByLabel('Character name',{exact:true}).waitFor();assert.equal(report.fixtureRequests,1);record('Reload recovers the same request without another model call');
  await page.getByLabel('Character name',{exact:true}).fill('Buzzy');await page.getByRole('button',{name:'Name & Create',exact:true}).click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  // The network guard intentionally refuses live Comfy access. Wait for that refused submission,
  // then supply a clearly synthetic completed artifact to exercise the remaining transport.
  for(let i=0;i<80;i++){media=(await api('/api/story-creator/media?projectId='+projectId)).value.media;if(['unknown','failed'].includes(media[0].status))break;await sleep(200);}
  assert(['unknown','failed'].includes(media[0].status));record('Name & Create resumes one durable request; external GPU traffic is blocked by the fixture');
  const db=new Database(path.join(data,'story-creator/story-media.sqlite'));
  let saved=JSON.parse(db.prepare('SELECT record FROM media WHERE id=?').get(media[0].id).record);
  const dir=path.join(data,'story-creator/generated',username,projectId,saved.id);fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'result.png');await sharp({create:{width:768,height:768,channels:3,background:'#91c9fa'}}).png().toFile(file);
  saved={...saved,status:'ready',filePath:file,error:null};db.prepare('UPDATE media SET status=?,record=? WHERE id=?').run('ready',JSON.stringify(saved),saved.id);db.close();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('img',{name:'Buzzy',exact:true}).waitFor();
  await page.getByRole('button',{name:'Save to Characters',exact:true}).click();await page.getByRole('button',{name:'Saved to Characters',exact:true}).waitFor();
  const characters=(await api('/api/story-creator/media?projectId='+projectId)).value.characters;assert.equal(characters[0].name,'Buzzy');assert.equal(characters[0].hasVoice,false);record('Preview and Save to Characters persist a named image without requiring a voice');
  const url=(await api('/api/story-creator/media?projectId='+projectId)).value.media[0].url;
  const download=await context.request.get(base+url+'&download=1');assert.equal(download.status(),200);assert.deepEqual(await download.body(),fs.readFileSync(file));
  const range=await context.request.get(base+url,{headers:{Range:'bytes=0-31'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,32);record('Protected download and byte ranges deliver the exact saved media');
  await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('What should change?',{exact:true}).fill('Change the background to a green meadow.');
  let requests=0;await page.route('**/api/story-creator/media',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='create'){const body=route.request().postDataJSON();assert.equal(body.sourceId,saved.id);assert.equal(body.operation,'edit');requests++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Offline edit fixture; original retained.'})});}else await route.continue();});
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByText('Offline edit fixture; original retained.',{exact:true}).waitFor();assert.equal(requests,1);record('Edit uses the exact selected image and shows recoverable errors without replacing it');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const httpBase='http://slr-story-http.test:3394';await context.addCookies((await context.cookies(base)).map(c=>({...c,domain:'slr-story-http.test'})));
  await page.goto(httpBase+'/app?tab=machine');await page.locator('article').filter({has:page.getByRole('heading',{name:'Buzzy media QA',exact:true})}).getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('img',{name:'Buzzy',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>isSecureContext),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:path.join(out,'story-media-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'story-media-desktop.png'),fullPage:true});
  record('Desktop and 412px HTTP mobile layout, recovery and saved image preview');
  const guest=await browser.newContext();assert.equal((await api('/api/story-creator/media?projectId='+projectId,undefined,guest)).status,401);assert.equal((await guest.request.get(base+url)).status(),401);await guest.close();
  assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));report.ok=true;
}catch(error){report.error=String(error);if(page){report.visible=await page.locator('body').innerText().catch(()=> 'unavailable');await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{if(browser)await browser.close();if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),sleep(8000)]);if(server.exitCode===null)server.kill('SIGKILL');}provider.close();fs.closeSync(log);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,out,error:report.error}));}
