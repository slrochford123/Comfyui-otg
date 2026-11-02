// Narrow billing-only snapshot from the qualified Build 2.20 source; no experimental tab activation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/openai-billing-fix-\d{8}-\w+$/.test(evidence)||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Backed-up billing evidence directory required');
const baseline='b267c6e98d79c85e45d130a6eee27854d0458ef6';
const root=fs.mkdtempSync(path.join(evidence,'build-')),build=path.join(root,'source'),data=path.join(root,'data');
fs.mkdirSync(build);fs.mkdirSync(data,{mode:0o700});
const archive=path.join(root,'baseline.tar');execFileSync('git',['archive','--format=tar','-o',archive,baseline],{cwd:source});execFileSync('tar',['-xf',archive,'-C',build]);
const overlay=['app/api/admin/openai-billing/route.ts','app/app/admin/openai-billing/OpenAIBillingClient.tsx','lib/openai/billing.ts','lib/openai/adminCredential.ts','lib/openai/connection.ts','scripts/install-openai-admin-key-test.sh','scripts/install-openai-admin-key-test.py'];
for(const name of overlay)fs.copyFileSync(path.join(source,name),path.join(build,name));
fs.symlinkSync(fs.realpathSync(path.join(source,'node_modules')),path.join(build,'node_modules'));
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'test',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--max-old-space-size=6144'};
const log=fs.openSync(path.join(root,'build.log'),'wx',0o600);console.log(JSON.stringify({root,build}));
const result=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:build,env,stdio:['ignore',log,log]});fs.closeSync(log);
const report={build,data,baseline,overlay:overlay.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(build,file))).digest('hex')})),exitCode:result.status,buildId:fs.existsSync(path.join(build,'.next/BUILD_ID'))?fs.readFileSync(path.join(build,'.next/BUILD_ID'),'utf8').trim():null,testOnly:true,experimentalTabsIncluded:false,prodChanged:false};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));process.exitCode=result.status??1;
