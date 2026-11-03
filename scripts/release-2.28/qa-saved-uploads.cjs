// Exact-build mobile browser/API/storage proof. Disposable accounts only; no generation or paid APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require('@playwright/test'),Database=require('better-sqlite3'),sharp=require('sharp');
const build=path.resolve(process.argv[2]||''),evidence=path.resolve(process.argv[3]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/build-2\.28-promotion-\d{8}-\w+\/build-\w+\/source$/.test(build)||!fs.existsSync(evidence+'/source-before.tar.gz'))throw Error('Explicit isolated candidate required');
const meta=JSON.parse(fs.readFileSync(path.join(build,'../result.json')));assert.equal(meta.exitCode,0);
const out=fs.mkdtempSync(path.join(build,'../browser-')),data=out+'/data',lab=out+'/lab';fs.mkdirSync(data,{mode:0o700});fs.mkdirSync(lab,{mode:0o700});
const base='http://127.0.0.1:3398',web='http://slr-uploads-http.test:3398',log=fs.openSync(out+'/server.log','wx',0o600);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3398'],{cwd:build,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_EXPERIMENTS_ROOT:lab,OTG_AUDIO_EDITING_ENABLED:'0',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1'}});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),report={ok:false,buildId:meta.buildId,paidCalls:0,gpuGenerationPerformed:false,prodChanged:false,checks:[],pageErrors:[]};
let browser,context,page;
async function api(route,method='GET',body){return context.request.fetch(base+route,{method,headers:{Origin:base},...(body?{data:body}:{})});}
async function loaded(){await page.getByRole('status',{name:'Launching SLR Studios',exact:true}).waitFor({state:'hidden'});}
async function thumbs(scope,name){const thumb=scope.getByAltText('Preview of '+name);await thumb.scrollIntoViewIfNeeded();await thumb.waitFor();await page.waitForFunction(el=>el.complete&&el.naturalWidth>0,await thumb.elementHandle());}
async function list(scope){const details=scope.locator('[data-otg="h3-saved-uploads"]');await details.waitFor();if(!await details.evaluate(el=>el.open))await details.locator('summary').click();return details;}
(async()=>{try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/healthz')).status===200)break;}catch{}await wait(200);}
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP slr-uploads-http.test 127.0.0.1']});
 context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true});page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(h3\/generation|production-v2\/generate|openai|enhance-prompt)/.test(request.url()))report.pageErrors.push('Unexpected generation: '+request.url());});
 const username='uploadsqa_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
 assert.equal((await api('/api/auth/signup','POST',{username,password,email:username+'@test.invalid'})).status(),200);
 const db=new Database(data+'/otg.db');const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);db.prepare("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)").run(user.id,new Date().toISOString());db.close();
 await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');
 await context.addCookies((await context.cookies(base)).map(cookie=>({...cookie,domain:'slr-uploads-http.test'})));
 await page.goto(web+'/app?tab=h3');await loaded();const panel=page.getByTestId('h3-panel'),auto=panel.getByRole('region',{name:'H3 Auto and Manual controllers'});
 assert.deepEqual(await page.evaluate(()=>[isSecureContext,typeof crypto.randomUUID]),[false,'undefined']);
 const files=[];for(const [name,color] of [['purple-boat.png','#8b5cf6'],['green-boat.png','#22c55e']]){const file=out+'/'+name;await sharp({create:{width:640,height:400,channels:3,background:color}}).png().toFile(file);files.push(file);}
 for(const file of files){await auto.getByLabel('Add image references',{exact:true}).setInputFiles(file);await auto.getByRole('button',{name:'Remove '+path.basename(file),exact:true}).click();}
 let saved=await list(auto);await thumbs(saved,'purple-boat.png');await thumbs(saved,'green-boat.png');
 await page.reload();await loaded();saved=await list(auto);await thumbs(saved,'purple-boat.png');
 await saved.getByLabel('Saved upload role').selectOption('first');await saved.getByRole('button',{name:'Add back purple-boat.png'}).click();await auto.getByRole('button',{name:'Remove purple-boat.png',exact:true}).waitFor();
 await auto.getByRole('button',{name:'Remove purple-boat.png',exact:true}).click();saved=await list(auto);await thumbs(saved,'purple-boat.png');report.checks.push('auto-upload-thumbnail-reuse-reload');
 await auto.getByRole('button',{name:'Manual Mode',exact:true}).click();const legacy=panel.locator('[data-otg="h3-legacy-manual-tools"]');await legacy.getByRole('tab',{name:'Image Animate first or first + last frames',exact:true}).click();
 const normal=legacy.getByRole('region',{name:'Saved H3 uploads'});saved=await list(normal);await saved.getByLabel('Saved image target').selectOption('last');await saved.getByRole('button',{name:'Add back purple-boat.png'}).click();
 const last=legacy.locator('article').filter({has:page.getByRole('heading',{name:'Last Image',exact:true})});await last.getByRole('button',{name:'Remove',exact:true}).waitFor();await last.getByRole('button',{name:'Remove',exact:true}).click();
 saved=await list(normal);await saved.getByLabel('Saved image target').selectOption('first');await saved.getByRole('button',{name:'Add back purple-boat.png'}).click();
 const first=legacy.locator('article').filter({has:page.getByRole('heading',{name:'First Image',exact:true})});await first.getByRole('button',{name:'Remove',exact:true}).waitFor();report.checks.push('image-first-last-reuse');
 await legacy.getByRole('tab',{name:'Reference Guide with images, video, and audio',exact:true}).click();saved=await list(normal);await saved.getByRole('button',{name:'Add back green-boat.png'}).click();await saved.getByRole('button',{name:'Add back green-boat.png'}).waitFor({state:'hidden'});report.checks.push('reference-reuse');
 await legacy.getByRole('tab',{name:'Realism Structured reference realism',exact:true}).click();saved=await list(normal);await saved.getByRole('button',{name:'Add back green-boat.png'}).click();await saved.getByRole('button',{name:'Add back green-boat.png'}).waitFor({state:'hidden'});report.checks.push('realism-reuse');
 // Removing a saved copy in another mode must not alter the still-selected first image.
 await legacy.getByRole('tab',{name:'Reference Guide with images, video, and audio',exact:true}).click();saved=await list(normal);await saved.getByRole('button',{name:'Remove saved upload purple-boat.png'}).click();await saved.getByRole('button',{name:'Add back purple-boat.png'}).waitFor({state:'hidden'});
 await legacy.getByRole('tab',{name:'Image Animate first or first + last frames',exact:true}).click();await first.getByRole('button',{name:'Remove',exact:true}).waitFor();await first.getByRole('button',{name:'Remove',exact:true}).click();await page.reload();await loaded();
 // Controller choice is not persisted; return to the legacy image workspace explicitly.
 await auto.getByRole('button',{name:'Manual Mode',exact:true}).click();await legacy.getByRole('tab',{name:'Image Animate first or first + last frames',exact:true}).click();saved=await list(normal);assert.equal(await saved.getByRole('button',{name:'Add back purple-boat.png'}).count(),0);await thumbs(saved,'green-boat.png');
 await page.screenshot({path:out+'/normal-mobile.png',fullPage:true});assert.equal(await normal.evaluate(el=>el.scrollWidth<=el.clientWidth),true);report.checks.push('remove-persists-selected-input-safe');
 const create=await api('/api/h3/nsfw','POST',{action:'create',experiment:'prism-pika'});assert.equal(create.status(),201);let session=(await create.json()).session;
 for(const file of files){const response=await context.request.post(base+`/api/h3/nsfw/assets?session=${session.id}&role=source&name=${path.basename(file)}`,{headers:{Origin:base,'Content-Type':'image/png'},data:fs.readFileSync(file)});assert.equal(response.status(),201,await response.text());session=(await response.json()).session;}
 const update=await api('/api/h3/nsfw','POST',{...session,action:'update',settings:{...session.settings,mode:'reference',selectedSources:[]}});assert.equal(update.status(),200);
 await panel.getByRole('button',{name:'H3 NSFW',exact:true}).click();const nsfw=panel.getByRole('region',{name:'H3 NSFW workspace'});saved=await list(nsfw);await thumbs(saved,'purple-boat.png');await thumbs(saved,'green-boat.png');
 const purple=session.assets.find(asset=>asset.name==='purple-boat.png');
 await saved.getByRole('button',{name:'Add back green-boat.png'}).click();await nsfw.getByRole('article',{name:'Reference green-boat.png'}).waitFor();saved=await list(nsfw);
 const removed=page.waitForResponse(r=>r.url().includes('/api/h3/nsfw/assets?id='+purple.id)&&r.request().method()==='DELETE');await saved.getByRole('button',{name:'Remove saved upload purple-boat.png'}).click();assert.equal((await removed).status(),200);await saved.getByRole('button',{name:'Add back purple-boat.png'}).waitFor({state:'hidden'});
 await page.reload();await loaded();await nsfw.getByRole('article',{name:'Reference green-boat.png'}).waitFor();assert.equal(await nsfw.getByRole('button',{name:'Add back purple-boat.png'}).count(),0);
 const download=await api('/api/h3/nsfw/assets?id='+purple.id+'&download=1');assert.equal(download.status(),200);assert.deepEqual(await download.body(),fs.readFileSync(files[0]));
 assert.equal((await context.request.delete(base+'/api/h3/nsfw/assets?id='+purple.id,{headers:{Origin:'https://foreign.invalid'}})).status(),403);
 const stranger=await browser.newContext();assert.equal((await stranger.request.delete(base+'/api/h3/nsfw/assets?id='+purple.id,{headers:{Origin:base}})).status(),401);await stranger.close();
 await page.screenshot({path:out+'/nsfw-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:out+'/nsfw-desktop.png',fullPage:true});report.checks.push('nsfw-thumbnail-remove-reload-private-media-safe','owner-and-csrf-denials');
 const otherOwner=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('otg-h3-saved-uploads-v1',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('uploads','readonly'),get=tx.objectStore('uploads').index('owner').getAll('different-owner');get.onsuccess=()=>resolve(get.result.length);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));assert.equal(otherOwner,0);report.checks.push('device-library-owner-isolation');
 assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error);if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});
}finally{fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2));if(report.ok)fs.writeFileSync(path.join(build,'../browser-results.json'),JSON.stringify(report,null,2));if(browser)await browser.close();server.kill('SIGTERM');console.log(JSON.stringify({out,...report}));}})();
