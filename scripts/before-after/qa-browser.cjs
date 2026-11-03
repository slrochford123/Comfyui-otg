// Real browser → canonical image engines → shared GPU queue → saved output.
// Disposable users/data, no paid APIs, no PROD/worker restarts or cancellations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=require('@playwright/test'),sharp=require('sharp');
const build=path.resolve(process.argv[2]||''),evidence=path.resolve(process.argv[3]||'');
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/before-after-\d{8}-\w+\/build-\w+\/source$/);
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(path.dirname(build),'browser-')),data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
const base='http://127.0.0.1:3398',browserBase='http://slr-compare-http.test:3398',password=crypto.randomBytes(24).toString('base64url'),username='compareqa_'+crypto.randomBytes(5).toString('hex');
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',OTG_MEDIA_GPU_ROUTING:'1',OTG_MEDIA_GPU_QUEUE_DB:'/home/shawn-rochford/AI/runtime/test/data/media-gpu-queue/queue.sqlite'};
const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
for(const item of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){const i=item.indexOf('=');if(/^(OTG_MEDIA_|OTG_WORKER_CONTROL_STORE_DIR$)/.test(item.slice(0,i)))env[item.slice(0,i)]=item.slice(i+1);}
assert(env.OTG_MEDIA_ADMISSION_CONFIG,'Existing shared GPU authority required');
const report={ok:false,suite:'before-after',buildId:meta.buildId,realInference:true,paidCalls:0,prodChanged:false,checks:[],jobs:[],pageErrors:[],out};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,context,page,log;
function saveReport(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});}
async function start(){
 log=fs.openSync(path.join(out,'server.log'),'a',0o600);
 server=spawn(process.execPath,['-r',path.join(build,'scripts/experiments/qa-refcard-network.cjs'),path.join(build,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3398'],{cwd:build,env,stdio:['ignore',log,log]});
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error('Isolated fixture exited');try{if((await fetch(base+'/api/healthz')).status===200)return;}catch{}await pause(200);}throw Error('Fixture health timeout');
}
async function stop(){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));fs.closeSync(log);}
async function request(route,options={}){return context.request.fetch(base+route,{...options,headers:{Origin:base,...options.headers}});}
async function login(){await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');await context.addCookies((await context.cookies(base)).map(cookie=>({...cookie,domain:'slr-compare-http.test'})));await page.goto(browserBase+'/app?tab=generate');await page.getByLabel('Image operation',{exact:true}).selectOption('before-after');await page.locator('[data-otg="before-after-panel"]').waitFor();}
async function waitJob(id){
 for(let i=0;i<1000;i++){
   const response=await request('/api/images/before-after?jobId='+id);assert.equal(response.status(),200,await response.text());const job=await response.json();
   if(['failed','canceled','unknown'].includes(job.status))throw Error(JSON.stringify(job));
   if(job.status==='completed'){report.jobs.push(job);saveReport();return job;}await pause(1800);
 }throw Error('Waiting on exact job exceeded the bounded test time; no replacement was submitted');
}
async function generate(gpu,{reload=false}={}){
 await context.addCookies([{name:'otg_media_gpu_v1',value:gpu,url:browserBase}]);
 const panel=page.locator('[data-otg="before-after-panel"]');
 const before=fs.existsSync(path.join(data,'before-after-jobs',username))?fs.readdirSync(path.join(data,'before-after-jobs',username)):[];
 const response=page.waitForResponse(r=>r.url()===browserBase+'/api/images/before-after'&&r.request().method()==='POST',{timeout:120000});
 await panel.getByRole('button',{name:/^(Generate Edit|Try Again)$/}).click();
 const accepted=await response;assert.equal(accepted.status(),202,await accepted.text());const job=await accepted.json();
 const submitted=await page.evaluate(id=>window.__comparisonUploads.find(item=>item.id===id),job.jobId);
 const hash=crypto.createHash('sha256').update(Buffer.from(submitted.bytes)).digest('hex');
 assert.equal(hash,report.originalHash);report.jobsSubmitted=(report.jobsSubmitted||0)+1;
 if(reload){await page.reload();await page.locator('[data-otg="before-after-panel"]').waitFor();report.checks.push('reload-running-job');}
 console.log(JSON.stringify({jobId:job.jobId,engine:job.engine,gpu,out}));
 const complete=await waitJob(job.jobId);await panel.getByAltText('After: edited image').waitFor({timeout:15000});
 const image=await request(complete.imageUrl);assert.equal(image.status(),200);fs.writeFileSync(path.join(out,complete.engine+'-'+report.jobs.length+'.png'),await image.body());
 const receipt=JSON.parse(fs.readFileSync(path.join(data,'before-after-jobs',username,job.jobId+'.json')));
 const promptMeta=JSON.parse(fs.readFileSync(path.join(data,'prompt_request_meta',username,complete.promptId+'.json')));
 assert((promptMeta.comfyBaseUrl||'').includes(gpu==='rtx3090'?'100.75.162.64':'100.98.212.116'));report.jobs[report.jobs.length-1].gpu=gpu;
 assert.equal(receipt.seed,complete.seed);assert.equal(fs.readdirSync(path.join(data,'before-after-jobs',username)).length,before.length+1);
 return complete;
}
(async()=>{
 for(const worker of ['http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188']){const queue=await(await fetch(worker+'/queue')).json();assert.equal(queue.queue_running.length+queue.queue_pending.length,0,'Do not start synthetic QA over owner work');}
 await start();browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-compare-http.test 127.0.0.1']});
 context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));
 await context.addInitScript(()=>{window.__comparisonUploads=[];window.__comparisonEvents=[];for(const name of ['pointerdown','pointerup','change'])document.addEventListener(name,event=>window.__comparisonEvents.push({event:name,tag:event.target.tagName,label:event.target.getAttribute('aria-label'),value:event.target.value,x:event.clientX,y:event.clientY}),true);const original=window.fetch;window.fetch=async(input,init)=>{if(String(input)==='/api/images/before-after'&&init?.method==='POST'&&init.body instanceof FormData){window.__comparisonUploads.push({id:init.body.get('clientRequestId'),bytes:Array.from(new Uint8Array(await init.body.get('image').arrayBuffer()))});}return original(input,init);};});
 const signup=await context.request.post(base+'/api/auth/signup',{data:{username,email:username+'@test.invalid',password},headers:{Origin:base}});assert.equal(signup.status(),200,await signup.text());await login();
 assert.deepEqual(await page.evaluate(()=>[isSecureContext,typeof crypto.randomUUID]),[false,'undefined']);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#d1dce8"/><ellipse cx="384" cy="969" rx="190" ry="25" fill="#aebacc"/><g stroke="#283443" stroke-width="7"><path d="M251 453 L517 453 L551 782 L217 782 Z" fill="white"/><path d="M275 776 L375 776 L367 950 L267 950 Z M393 776 L493 776 L503 950 L401 950 Z" fill="white"/><path d="M251 462 L199 484 L175 743 L231 758 L275 565 M517 462 L569 484 L593 743 L537 758 L493 565" fill="white"/><path d="M317 450 L384 548 L451 450 L419 631 L349 631 Z" fill="#fafafa"/><path d="M384 502 L359 552 L384 692 L409 552 Z" fill="#bd263a"/><path d="M317 450 L286 509 L326 551 L306 576 L384 730 M451 450 L482 509 L442 551 L462 576 L384 730" fill="none"/><rect x="340" y="373" width="88" height="91" rx="20" fill="#b98566"/><ellipse cx="384" cy="285" rx="110" ry="135" fill="#b98566"/><path d="M275 265 Q264 120 381 133 Q502 123 494 265 L461 205 L305 205 Z" fill="#332c2a"/><path d="M267 948 L369 948 L379 980 L248 980 Z M400 948 L502 948 L521 980 L394 980 Z" fill="#303744"/></g><circle cx="346" cy="285" r="8" fill="#27333f"/><circle cx="422" cy="285" r="8" fill="#27333f"/><path d="M346 344 Q384 369 422 344" fill="none" stroke="#6c3d30" stroke-width="6"/></svg>';
 const original=path.join(out,'original-white-suit.png');fs.writeFileSync(original,await sharp(Buffer.from(svg)).png().toBuffer());report.originalHash=crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Add Image',exact:true}).click();await page.getByRole('button',{name:'Phone storage',exact:true}).click();await(await chooser).setFiles(original);await page.getByAltText('Original image',{exact:true}).waitFor();report.checks.push('android-phone-storage');
 const panel=page.locator('[data-otg="before-after-panel"]');await panel.getByRole('textbox',{name:'Describe the change'}).fill('Change only the white suit jacket and white trousers to solid black. Keep the same adult man, face, pose, white shirt, red tie, background, framing, and illustration style unchanged.');
 const first=await generate('rtx3090',{reload:true});assert.equal(first.engine,'qwen');
 const galleryBefore=await(await request('/api/gallery?media=image')).json();assert.equal((galleryBefore.items||galleryBefore.files||[]).length,0,'Unapproved edits must not auto-save');report.checks.push('explicit-save-only');
 const slider=panel.getByRole('slider',{name:'Before and after comparison'});await slider.focus();await slider.press('Home');for(let i=0;i<25;i++)await slider.press('ArrowRight');await pause(250);await page.reload();await panel.getByAltText('After: edited image').waitFor();assert.equal(await slider.inputValue(),'25');report.checks.push('restore-original-prompt-result-slider');
 await page.getByRole('status',{name:'Launching SLR Studios',exact:true}).waitFor({state:'hidden'});
 const surface=panel.locator('[data-otg="before-after-comparison"]');await surface.evaluate(element=>element.scrollIntoView({block:'center'}));const box=await surface.boundingBox();const touch=await context.newCDPSession(page);
 report.touchBefore=await page.evaluate(box=>({box,innerWidth,innerHeight,scrollY,scale:visualViewport.scale,offsetTop:visualViewport.offsetTop,hit:document.elementFromPoint(box.x+box.width*.3,box.y+box.height*.5)?.outerHTML.slice(0,200)}),box);saveReport();
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.3,y:box.y+box.height*.5}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.75,y:box.y+box.height*.5}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert(Number(await slider.inputValue())>60);report.checks.push('touch-slider');await page.screenshot({path:path.join(out,'mobile-comparison.png'),fullPage:true});
 const second=await generate('rtx3090');assert.notEqual(first.seed,second.seed);assert.notEqual(first.jobId,second.jobId);report.checks.push('retry-new-seed-original');
 await panel.getByRole('button',{name:'Save to Gallery',exact:true}).click();await panel.getByRole('button',{name:'Saved to Gallery',exact:true}).waitFor();
 const saved=await(await request('/api/gallery?media=image')).json();assert.equal((saved.items||saved.files||[]).length,1);report.checks.push('save-to-owner-gallery');
 const download=await request(second.imageUrl+'&download=1');assert.equal(download.status(),200);assert.match(download.headers()['content-disposition'],/attachment/);report.checks.push('download-exact-edit');
 await panel.getByRole('button',{name:'Undo',exact:true}).click();await panel.getByAltText('Original image',{exact:true}).waitFor();assert.equal(await panel.getByRole('textbox',{name:'Describe the change'}).inputValue(),'Change only the white suit jacket and white trousers to solid black. Keep the same adult man, face, pose, white shirt, red tie, background, framing, and illustration style unchanged.');report.checks.push('undo-original-keeps-prompt');
 await panel.getByRole('combobox',{name:'Edit model',exact:true}).selectOption('fibo');await generate('rtx5060ti');
 await stop();await start();await page.reload();await panel.getByAltText('After: edited image').waitFor();report.checks.push('server-restart-recovery');
 await page.getByRole('status',{name:'Launching SLR Studios',exact:true}).waitFor({state:'hidden'});
 await page.setViewportSize({width:1440,height:1100});await surface.evaluate(element=>element.scrollIntoView({block:'center'}));const desktop=await surface.boundingBox();await page.mouse.move(desktop.x+desktop.width*.8,desktop.y+desktop.height*.5);await page.mouse.down();await page.mouse.move(desktop.x+desktop.width*.2,desktop.y+desktop.height*.5,{steps:10});await page.mouse.up();assert(Number(await slider.inputValue())<35);report.checks.push('mouse-slider');await page.screenshot({path:path.join(out,'desktop-comparison.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);report.checks.push('responsive-no-overflow');
 const unauthorized=await browser.newContext();const other='compareother_'+crypto.randomBytes(4).toString('hex');assert.equal((await unauthorized.request.post(base+'/api/auth/signup',{data:{username:other,email:other+'@test.invalid',password},headers:{Origin:base}})).status(),200);assert.equal((await unauthorized.request.post(base+'/api/auth/login',{data:{identifier:other,password},headers:{Origin:base}})).status(),200);
 assert.equal((await unauthorized.request.get(base+'/api/images/before-after?jobId='+first.jobId)).status(),404);await unauthorized.close();report.checks.push('cross-owner-denial');
 await panel.getByRole('button',{name:'Clear',exact:true}).click();await panel.getByText('Choose an original image to get started.',{exact:true}).waitFor();await page.reload();await panel.getByText('Choose an original image to get started.',{exact:true}).waitFor();report.checks.push('clear-persists-without-deleting-gallery');
 await panel.getByRole('button',{name:'Gallery Image',exact:true}).click();await panel.getByRole('button',{name:/^Use /}).first().click();await panel.getByAltText('Original image',{exact:true}).waitFor();report.checks.push('gallery-source-selection');
 await panel.getByRole('button',{name:'Clear',exact:true}).click();await panel.getByText('Choose an original image to get started.',{exact:true}).waitFor();
 const retained=await(await request('/api/gallery?media=image')).json();assert.equal((retained.items||retained.files||[]).length,1);report.checks.push('clear-preserves-saved-gallery');
 assert.deepEqual(report.pageErrors,[]);report.ok=true;
})().catch(async error=>{report.error=String(error.stack||error);if(page){report.events=await page.evaluate(()=>window.__comparisonEvents).catch(()=>[]);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}console.error(report.error);process.exitCode=1;}).finally(async()=>{
 if(!report.ok&&context&&server?.exitCode===null){
   const folder=path.join(data,'before-after-jobs',username);
   for(const file of fs.existsSync(folder)?fs.readdirSync(folder):[]){const job=JSON.parse(fs.readFileSync(path.join(folder,file)));if(!['completed','failed','canceled'].includes(job.status)){try{await waitJob(job.id);report.failedRunRecoveredJobs=(report.failedRunRecoveredJobs||[]).concat(job.id);}catch(error){report.recoveryError=String(error);}}}
 }
 saveReport();fs.writeFileSync(path.join(build,'../browser-results.json'),JSON.stringify(report,null,2),{mode:0o600});if(browser)await browser.close();if(server?.exitCode===null)await stop();console.log(JSON.stringify({ok:report.ok,out}));
});
