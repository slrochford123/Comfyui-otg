// Exact staged production build, disposable accounts, Android-width browser.
// Does not submit GPU jobs or call paid APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{chromium}=require('@playwright/test'),sharp=require('sharp');
const evidence=path.resolve(process.argv[2]||'');assert.match(evidence,/^\/home\/shawn-rochford\/AI\/research\/build-2\.30-promotion-\d{8}-\w+$/);const pack=JSON.parse(fs.readFileSync(evidence+'/production-package.json'));
const out=fs.mkdtempSync(evidence+'/production-browser-'),base='http://127.0.0.1:3398';const tunnel=spawn('ssh',['-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-N','-L','3398:127.0.0.1:3308','otg-slr'],{stdio:'ignore'});
const report={ok:false,buildId:pack.buildId,commit:pack.commit,version:'2.30',gpuSubmissions:0,paidCalls:0,checks:[],pageErrors:[]},wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,context,page;
async function api(url,data){return context.request.fetch(base+url,{method:data?'POST':'GET',headers:{Origin:base},...(data?{data}:{})});}
const loaded=()=>page.getByRole('status',{name:'Launching SLR Studios',exact:true}).waitFor({state:'hidden'});
(async()=>{try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/healthz')).status===200)break;}catch{}await wait(250);}
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage','--no-proxy-server']});context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 const username='release229_'+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');assert.equal((await api('/api/auth/signup',{username,password,email:username+'@test.invalid'})).status(),200);
 const grant=`import json,pathlib,sqlite3,sys,datetime\np=json.load(sys.stdin);stage=pathlib.Path(p['stage']);assert stage.parent==pathlib.Path('/mnt/otg_bulk') and stage.name.startswith('build-2.30-promotion-');state=json.loads((stage/'smoke-process.json').read_text());data=pathlib.Path(state['data']);assert data.parent==stage and data.name.startswith('smoke-data-');db=sqlite3.connect(data/'otg.db');u=db.execute('SELECT id FROM users WHERE username=?',(p['username'],)).fetchone();assert u;db.execute("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)",(u[0],datetime.datetime.now(datetime.timezone.utc).isoformat()));db.commit();db.close()`;
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";execFileSync('ssh',['-o','BatchMode=yes','otg-slr','sudo -n /usr/bin/python3 -c '+quote(grant)],{input:JSON.stringify({stage:pack.stage,username})});
 await page.goto(base+'/login');await page.getByPlaceholder('you@domain.com or username').fill(username);await page.locator('input[autocomplete="current-password"]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/app');await loaded();
 const identity=await(await api('/api/app/build')).json();assert.equal(identity.buildVersion,'2.30');assert.equal(identity.commit,pack.commit);
 for(const url of ['/api/experiments','/api/experiments/refmod-replacement'])assert.equal((await api(url)).status(),404);
 assert.equal((await api('/api/h3/nsfw')).status(),200);await page.goto(base+'/app?tab=testing');await loaded();await wait(300);assert.equal(await page.getByRole('region',{name:'Testing workspace'}).count(),0);assert.equal(await page.getByText('RefMod Character Replacement Lab',{exact:true}).count(),0);report.checks.push('testing-closed-even-for-admin');
 await page.goto(base+'/app?tab=settings');await loaded();const google=page.getByRole('region',{name:'Google Photos connection'});await google.getByText('Administrator setup required',{exact:true}).waitFor();assert.equal(await google.getByRole('button',{name:'Connect Google Photos'}).isDisabled(),true);await google.getByText('Administrator setup',{exact:true}).click();await google.getByLabel('Authorized redirect URI',{exact:true}).waitFor();assert.equal((await api('/api/integrations/google-photos',{action:'connect'})).status(),503);await page.screenshot({path:out+'/google-photos-production-mobile.png',fullPage:true});report.checks.push('google-photos-admin-setup');

 await page.addInitScript(()=>{
  window.CapacitorCustomPlatform={name:'android'};window.__googleCalls=[];
  window.Capacitor={PluginHeaders:[{name:'SlrGoogleBrowser',methods:[{name:'open',rtype:'promise'},{name:'close',rtype:'promise'},{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]}],
   nativePromise:async(plugin,method,options)=>{window.__googleCalls.push({plugin,method,options});},
   nativeCallback:()=> 'mock-callback'};
 });
 const sample=await sharp({create:{width:640,height:400,channels:3,background:'#663399'}}).png().toBuffer();let ready=true;
 await page.route('**/api/integrations/google-photos*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='GET'&&url.searchParams.has('item')){assert((await page.evaluate(()=>window.__googleCalls)).some(c=>c.method==='close'));return route.fulfill({status:200,contentType:'image/png',body:sample});}
  if(req.method()==='GET')return route.fulfill({json:{configured:true,connected:true}});
  const data=req.postDataJSON();
  if(data.action==='pick')return route.fulfill({json:{id:'mock-session',pickerUri:'https://photos.google.com/picker/mock',pollAfterMs:1000}});
  if(data.action==='poll')return route.fulfill({json:{ready,items:ready?[{id:'sample',name:'sample.png',mime:'image/png'}]:[]}});
  throw Error('Unexpected Google mock action');
 });
 await page.goto(base+'/app?tab=generate');await loaded();await page.getByLabel('Image operation',{exact:true}).selectOption('before-after');
 const panel=page.getByRole('region',{name:'Before & After',exact:true});await panel.getByLabel('Describe the change').fill('Keep this prompt.');
 await panel.getByRole('button',{name:'Add Image',exact:true}).click();await page.getByRole('button',{name:'Connected Google Photos',exact:true}).click();
 await panel.getByAltText('Original image',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Describe the change').inputValue(),'Keep this prompt.');assert.equal(context.pages().length,1);
 const imageUrl=await panel.getByAltText('Original image',{exact:true}).getAttribute('src');ready=false;
 await panel.getByRole('button',{name:'Change Image',exact:true}).click();await page.getByRole('button',{name:'Connected Google Photos',exact:true}).click();
 await page.getByText('Choose your media and tap Done. It will return here automatically.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await wait(250);assert.equal(await panel.getByAltText('Original image',{exact:true}).getAttribute('src'),imageUrl);
 assert.equal(await panel.getByLabel('Describe the change').inputValue(),'Keep this prompt.');
 await page.screenshot({path:out+'/google-photos-in-app-production-mobile.png',fullPage:true});report.checks.push('google-photos-in-app-import-cancel');

 const outsider=await browser.newContext();assert.equal((await outsider.request.get(base+'/api/integrations/google-photos')).status(),401);assert.equal((await outsider.request.get(base+'/api/h3/nsfw')).status(),401);await outsider.close();report.checks.push('unauthenticated-protected-routes');
 assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(e){report.error=e.stack;process.exitCode=1;console.error(e.message);if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}
finally{fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2));if(report.ok)fs.writeFileSync(evidence+'/production-smoke-results.json',JSON.stringify(report,null,2));if(browser)await browser.close();tunnel.kill('SIGTERM');console.log(JSON.stringify({out,...report}));}})();
