// No inference or managed-service changes: isolated production-host browser smoke.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const evidence=path.resolve(process.argv[2]||''),stage=process.env.H3_QA_STAGE;
assert.match(evidence,/^\/home\/shawn-rochford\/AI\/research\/h3-edit-recovery-\d{8}-\w+$/);
assert.match(stage||'',/^\/mnt\/otg_bulk\/build-2\.23-promotion-[a-f0-9]{12}$/);
const out=fs.mkdtempSync(path.join(evidence,'prod-browser-')),base='http://127.0.0.1:3308';
const report={ok:false,realInference:false,managedProductionChanged:false,pageErrors:[],checks:[]};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});
const user=await browser.newContext({viewport:{width:412,height:915}}),admin=await browser.newContext({viewport:{width:1440,height:1000}});let page;
async function call(ctx,route,body){return ctx.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body}),timeout:30000});}
async function api(ctx,route,body){const r=await call(ctx,route,body),v=await r.json();assert(r.ok(),v.error||`HTTP ${r.status()}`);return v;}
async function identity(ctx,prefix,elevate=false){
 const username=prefix+crypto.randomBytes(4).toString('hex'),password=crypto.randomBytes(24).toString('base64url');await api(ctx,'/api/auth/signup',{username,password,email:username+'@test.invalid'});
 const code=`import json,pathlib,re,sqlite3,sys,datetime\np=json.load(sys.stdin);stage=pathlib.Path(p['stage']);assert re.fullmatch(r'/mnt/otg_bulk/build-2.23-promotion-[a-f0-9]{12}',str(stage));state=json.loads((stage/'smoke-process.json').read_text());db=sqlite3.connect(pathlib.Path(state['data'])/'otg.db');row=db.execute('SELECT id FROM users WHERE username=?',(p['username'],)).fetchone();assert row\nif p['elevate']:db.execute("INSERT INTO user_roles(user_id,role,granted_at) VALUES (?,'admin',?)",(row[0],datetime.datetime.now(datetime.timezone.utc).isoformat()));db.commit()\nprint(json.dumps({'id':row[0]}));db.close()`;
 const {id}=JSON.parse(execFileSync('ssh',['-o','BatchMode=yes','otg-slr','sudo -n /usr/bin/python3 -c '+"'"+code.replaceAll("'","'\\''")+"'"],{input:JSON.stringify({stage,username,elevate}),encoding:'utf8'}));
 const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>report.pageErrors.push(e.message));await p.goto(base+'/login');await p.getByPlaceholder('you@domain.com or username').fill(username);await p.locator('input[autocomplete="current-password"]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL('**/app');return {page:p,id,username};
}
try{
 const u=await identity(user,'edit_promote_'),a=await identity(admin,'edit_admin_',true);page=u.page;
 assert.equal((await api(user,'/api/app/build')).buildVersion,'2.23');
 for(const ctx of [user,admin])for(const route of ['/api/experiments','/api/experiments/assets'])assert.equal((await call(ctx,route)).status(),404);
 assert.equal((await call(user,'/api/h3/nsfw')).status(),403);
 await page.goto(base+'/app?tab=h3');assert.equal(await page.getByRole('button',{name:'H3 NSFW',exact:true}).count(),0);
 await contextCookie();
 async function contextCookie(){await user.addCookies([{name:'otg_media_gpu_v1',value:'rtx3090',url:base}]);}
 await page.goto(base+'/app?tab=h3');const h3=page.getByTestId('h3-panel');await h3.getByRole('button',{name:'Manual Mode',exact:true}).click();await h3.getByRole('button',{name:/^Edit Video/}).click();const panel=page.locator('[data-otg="h3-video-edit"]');
 await panel.getByLabel('Source video file').setInputFiles('/home/shawn-rochford/AI/research/h3-edit-recovery-20261102-j4YPZnDG/gpu-06-6lqGWw/source.mp4');await panel.getByText(/Full video ready/).waitFor();
 await panel.getByLabel('Trim end seconds').fill('7.0476');await panel.getByRole('button',{name:'Trim Selection',exact:true}).click();await panel.getByText(/Trimmed clip preview/).waitFor();
 await panel.getByLabel('H3 video edit prompt').fill('Transform the moving colorful shapes into a hand-painted animation.');
 for(const quality of ['0.6','1']){await panel.getByLabel('Megapixel size').selectOption(quality);assert.equal(await panel.getByLabel('Megapixel size').inputValue(),quality);assert(await panel.getByRole('button',{name:'Create Video',exact:true}).isEnabled());}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'mobile-edit.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'desktop-edit.png'),fullPage:true});
 report.checks.push('Build 2.23, mobile/desktop source upload and trim, both MP selectors, explicit Create enabled without submitting a job');
 await page.goto(base+'/app?tab=settings');const access=page.getByRole('region',{name:'H3 NSFW access',exact:true});await access.getByRole('checkbox').check();await access.getByRole('button',{name:'Request NSFW approval',exact:true}).click();await access.getByText('Pending administrator approval',{exact:true}).waitFor();
 assert.equal((await call(user,'/api/admin/h3-nsfw-access',{userId:u.id,enabled:true,version:0})).status(),403);
 await a.page.goto(base+'/app/admin/users');const grant=a.page.waitForResponse(r=>r.url().endsWith('/api/admin/h3-nsfw-access')&&r.request().method()==='POST');await a.page.getByRole('switch',{name:'H3 NSFW access for '+u.username,exact:true}).click();assert.equal((await grant).status(),200);
 assert.equal((await api(user,'/api/h3/nsfw/access')).access.enabled,true);await page.goto(base+'/app?tab=h3');await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();await page.getByRole('region',{name:'H3 NSFW workspace',exact:true}).getByLabel('Your scene',{exact:true}).waitFor();
 const catalog=await api(user,'/api/h3/nsfw');assert.equal(catalog.environment,'prod');assert.equal(catalog.catalog.length,4);
 await a.page.goto(base+'/app?tab=testing');assert.equal(await a.page.getByRole('region',{name:'Testing workspace',exact:true}).count(),0);
 report.checks.push('H3 NSFW default-off, no self-grant, owner request/admin enable, all four models preserved; Testing unavailable even to production administrators');
 assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(e){report.error=String(e);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,out,error:report.error}));}
