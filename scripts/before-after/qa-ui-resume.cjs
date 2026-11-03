// Continue UI-only checks against the SAME exact build and completed synthetic
// GPU fixture. Never rerender to repair a test-harness/splash timing failure.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),{chromium}=require('@playwright/test');
const build=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||'');
assert.match(build,/^\/home\/shawn-rochford\/AI\/research\/before-after-\d{8}-\w+\/build-\w+\/source$/);
assert.equal(path.dirname(out),path.dirname(build));assert.match(path.basename(out),/^browser-\w+$/);
const report=JSON.parse(fs.readFileSync(out+'/results.json')),meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));
assert.equal(report.buildId,meta.buildId);assert.equal(meta.exitCode,0);assert.equal(report.realInference,true);assert.equal(report.jobs.length,3);assert(report.jobs.every(j=>j.status==='completed'));assert(report.checks.includes('server-restart-recovery'));
fs.copyFileSync(out+'/results.json',out+'/results-before-ui-resume-'+Date.now()+'.json');
report.uiResume={previousHarnessError:report.error,additionalGpuJobs:0};delete report.error;report.pageErrors=[];report.ok=false;
const data=out+'/data',password=crypto.randomBytes(24).toString('base64url');
// Only this path-validated disposable fixture account is changed, never live TEST.
const db=new Database(data+'/otg.db'),users=db.prepare("SELECT id,username,email FROM users WHERE username LIKE 'compareqa_%'").all();assert.equal(users.length,1);
const user=users[0];assert.equal(user.email,user.username+'@test.invalid');db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,12),user.id);db.close();
const base='http://127.0.0.1:3398',env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',OTG_MEDIA_GPU_ROUTING:'1',OTG_MEDIA_GPU_QUEUE_DB:'/home/shawn-rochford/AI/runtime/test/data/media-gpu-queue/queue.sqlite'};
const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();for(const item of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){const i=item.indexOf('=');if(/^(OTG_MEDIA_|OTG_WORKER_CONTROL_STORE_DIR$)/.test(item.slice(0,i)))env[item.slice(0,i)]=item.slice(i+1);}
const log=fs.openSync(out+'/ui-resume-server.log','a',0o600),server=spawn(process.execPath,['-r',build+'/scripts/experiments/qa-refcard-network.cjs',build+'/node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3398'],{cwd:build,env,stdio:['ignore',log,log]});
let browser,page;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error('Fixture exited');try{if((await fetch(base+'/api/healthz')).status===200)break;}catch{}await pause(200);}
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server']});const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/api/images/before-after',route=>{if(route.request().method()==='POST'){report.uiResume.additionalGpuJobs++;return route.abort();}return route.continue();});
 assert.equal((await context.request.post(base+'/api/auth/login',{data:{identifier:user.username,password},headers:{Origin:base}})).status(),200);await page.goto(base+'/app?tab=generate');await page.getByLabel('Image operation',{exact:true}).selectOption('before-after');
 const job=report.jobs[2],response=await context.request.get(base+'/api/images/before-after?jobId='+job.jobId);assert.equal(response.status(),200);assert.equal((await response.json()).status,'completed');
 const receipt=JSON.parse(fs.readFileSync(data+'/before-after-jobs/'+user.username+'/'+job.jobId+'.json'));
 await page.evaluate(async({username,job,prompt,bytes})=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('otg-before-after-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('sessions');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite'),store=tx.objectStore('sessions'),key='before-after:profile:'+encodeURIComponent(username);
   store.put(new File([new Uint8Array(bytes)],'original-white-suit.png',{type:'image/png'}),key+':source');store.put({version:1,prompt,engine:job.engine,job,position:50,saved:false},key+':draft');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 },{username:user.username,job,prompt:receipt.prompt,bytes:Array.from(fs.readFileSync(out+'/original-white-suit.png'))});
 await page.reload();const panel=page.locator('[data-otg="before-after-panel"]');await panel.getByAltText('After: edited image').waitFor();await page.getByRole('status',{name:'Launching SLR Studios',exact:true}).waitFor({state:'hidden'});
 const surface=panel.locator('[data-otg="before-after-comparison"]'),slider=panel.getByRole('slider',{name:'Before and after comparison'});await surface.evaluate(el=>el.scrollIntoView({block:'center'}));const box=await surface.boundingBox();
 await page.mouse.move(box.x+box.width*.8,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.2,box.y+box.height*.5,{steps:10});await page.mouse.up();assert(Number(await slider.inputValue())<35);report.checks.push('mouse-slider');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);report.checks.push('responsive-no-overflow');await page.screenshot({path:out+'/desktop-comparison.png',fullPage:true});
 const otherContext=await browser.newContext(),other='compareother_'+crypto.randomBytes(4).toString('hex');assert.equal((await otherContext.request.post(base+'/api/auth/signup',{data:{username:other,email:other+'@test.invalid',password},headers:{Origin:base}})).status(),200);assert.equal((await otherContext.request.post(base+'/api/auth/login',{data:{identifier:other,password},headers:{Origin:base}})).status(),200);
 assert.equal((await otherContext.request.get(base+'/api/images/before-after?jobId='+job.jobId)).status(),404);await otherContext.close();report.checks.push('cross-owner-denial');
 await panel.getByRole('button',{name:'Clear',exact:true}).click();await panel.getByText('Choose an original image to get started.',{exact:true}).waitFor();await page.reload();await panel.getByText('Choose an original image to get started.',{exact:true}).waitFor();report.checks.push('clear-persists-without-deleting-gallery');
 await panel.getByRole('button',{name:'Gallery Image',exact:true}).click();await panel.getByRole('button',{name:/^Use /}).first().click();await panel.getByAltText('Original image',{exact:true}).waitFor();report.checks.push('gallery-source-selection');
 await panel.getByRole('button',{name:'Clear',exact:true}).click();await panel.getByText('Choose an original image to get started.',{exact:true}).waitFor();
 const gallery=await(await context.request.get(base+'/api/gallery?media=image')).json();assert.equal((gallery.items||gallery.files||[]).length,1);report.checks.push('clear-preserves-saved-gallery');
 assert.equal(report.uiResume.additionalGpuJobs,0);assert.deepEqual(report.pageErrors,[]);report.ok=true;
})().catch(async error=>{report.error=String(error.stack||error);if(page)await page.screenshot({path:out+'/ui-resume-failure.png',fullPage:true}).catch(()=>{});console.error(report.error);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));fs.closeSync(log);report.checks=[...new Set(report.checks)];fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2),{mode:0o600});fs.writeFileSync(path.join(build,'../browser-results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,out,additionalGpuJobs:report.uiResume.additionalGpuJobs}));
});
