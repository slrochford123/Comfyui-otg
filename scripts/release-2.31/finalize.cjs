// Pin the completed exact-build smoke proof before activation. Does not activate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const evidence=path.resolve(process.argv[2]||''),source=path.resolve(__dirname,'../..');if(!/^\/home\/shawn-rochford\/AI\/research\/build-2\.31-promotion-\d{8}-\w+$/.test(evidence))throw Error('Invalid evidence root');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),plan=JSON.parse(fs.readFileSync(evidence+'/production-plan.json')),qa=JSON.parse(fs.readFileSync(evidence+'/production-smoke-results.json'));
if(!qa.ok||qa.buildId!==plan.buildId||qa.commit!==plan.commit||qa.gpuSubmissions!==0||qa.paidCalls!==0)throw Error('Exact-build proof failed');
plan.productionSmokeSha256=hash(evidence+'/production-smoke-results.json');fs.writeFileSync(evidence+'/production-plan.json',JSON.stringify(plan,null,2),{mode:0o600});
const template=fs.readFileSync(source+'/scripts/release-2.31/activate-prod.py','utf8');if(!template.includes('__ACTIVATION_PLAN_SHA256__'))throw Error('Missing plan pin');fs.writeFileSync(evidence+'/activate-build-2.31.py',template.replace('__ACTIVATION_PLAN_SHA256__',hash(evidence+'/production-plan.json')),{mode:0o600});
const pack=JSON.parse(fs.readFileSync(evidence+'/production-package.json'));
for(const [file,destination]of [['production-plan.json','activation-plan.json'],['activate-build-2.31.py','activate-build-2.31.py'],['production-smoke-results.json','production-smoke-results.json']])cp.execFileSync('scp',['-q','-o','BatchMode=yes',evidence+'/'+file,'otg-slr:'+pack.stage+'/'+destination]);
console.log(JSON.stringify({ok:true,stage:pack.stage,planSha256:hash(evidence+'/production-plan.json'),activated:false}));
