// Package only the exact browser/GPU-qualified Before & After snapshot. No activation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/before-after-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-')||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Backed-up isolated build required');
const result=JSON.parse(fs.readFileSync(path.join(build,'../result.json'))),qa=JSON.parse(fs.readFileSync(path.join(build,'../browser-results.json')));
if(result.build!==build||result.exitCode!==0||!qa.ok||!qa.realInference||qa.buildId!==result.buildId||qa.paidCalls!==0||!qa.checks?.includes('touch-slider')||!qa.checks?.includes('retry-new-seed-original')||!['qwen','fibo2-edit-turbo'].every(engine=>qa.jobs.some(j=>j.engine===engine&&j.status==='completed')))throw Error('Exact-build browser/GPU qualification required');
const changed=[...new Set([...execFileSync('git',['diff','--name-only','81d0afa4e37a64f21d58f380402020f54f11235a'],{cwd:source,encoding:'utf8'}).trim().split('\n'),...execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:source,encoding:'utf8'}).trim().split('\n')].filter(Boolean))];
const allowed=file=>file==='app/app/AppPageClient.tsx'||file==='app/api/images/before-after/route.ts'||file==='lib/images/beforeAfter.ts'||file==='lib/client/beforeAfter.ts'||/^app\/app\/components\/(BeforeAfterPanel|ImageComparisonSlider)\.tsx$/.test(file)||file.startsWith('scripts/before-after/')||/^tests\/vitest\/contracts\/before-after/.test(file);
if(changed.some(file=>!allowed(file)))throw Error('Unrelated source changes need review');
for(const file of changed)if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Qualified source changed: '+file);
const root='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(root+'/current');
if(previous!=='/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261103T041539Z')throw Error('TEST baseline changed');
const candidate=root+'/releases/test3001-before-after-'+new Date().toISOString().replaceAll(/[-:]/g,'').split('.')[0]+'Z';
fs.mkdirSync(candidate);fs.writeFileSync(candidate+'/DO_NOT_ACTIVATE','Packaging incomplete');
const standalone=build+'/.next/standalone';
fs.cpSync(standalone,candidate,{recursive:true,filter:file=>{const relative=path.relative(standalone,file);return !['node_modules','data'].includes(relative)&&!relative.startsWith('data/')&&!relative.split(path.sep).some(part=>part.startsWith('.env'));}});
fs.cpSync(fs.realpathSync(standalone+'/node_modules'),candidate+'/node_modules',{recursive:true,verbatimSymlinks:true});
for(const directory of ['public','lib','scripts','config','comfy_workflows','workflows'])if(fs.existsSync(build+'/'+directory))fs.cpSync(build+'/'+directory,candidate+'/'+directory,{recursive:true});
fs.cpSync(build+'/.next/static',candidate+'/.next/static',{recursive:true});
const bootstrap="require('./scripts/audio-editing-release-bootstrap.cjs');\n";
if(fs.readFileSync(previous+'/server.js','utf8').startsWith(bootstrap)){
  if(!fs.readFileSync(previous+'/scripts/audio-editing-release-bootstrap.cjs').equals(fs.readFileSync(candidate+'/scripts/audio-editing-release-bootstrap.cjs')))throw Error('Audio bootstrap changed');
  fs.writeFileSync(candidate+'/server.js',bootstrap+fs.readFileSync(candidate+'/server.js','utf8'));
}
for(const [name,target] of Object.entries({'.env.local':'/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',data:'/home/shawn-rochford/AI/runtime/test/data'}))fs.symlinkSync(target,candidate+'/'+name);
for(const marker of ['experimental-workspace.json','openai-billing-fix.json','character-refmod-cards.json'])if(fs.existsSync(previous+'/public/'+marker)){
  const prior=JSON.parse(fs.readFileSync(previous+'/public/'+marker));
  fs.writeFileSync(candidate+'/public/'+marker,JSON.stringify({...prior,previousBuildId:prior.buildId,buildId:result.buildId,beforeAfterIncluded:true}));
}
fs.writeFileSync(candidate+'/public/before-after.json',JSON.stringify({feature:'before-after',buildId:result.buildId,testOnly:true,version:'2.27',githubPushed:false,prodChanged:false}));
const helpers=evidence+'/helpers';fs.mkdirSync(helpers,{mode:0o700});
for(const [from,to] of [['scripts/deploy/systemd_runtime.py','helpers/systemd_runtime.py'],['scripts/deploy/activate_test_release.py','helpers/activate_test_release.py'],['scripts/audit/activate-test.py','helpers/audit_checks.py'],['scripts/before-after/activate-test.py','activate-test.py']])fs.copyFileSync(source+'/'+from,evidence+'/'+to,fs.constants.COPYFILE_EXCL);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(base,relative=''){return fs.readdirSync(path.join(base,relative),{withFileTypes:true}).flatMap(entry=>{
 const file=path.join(relative,entry.name),absolute=path.join(base,file);if(['data','.env.local','DO_NOT_ACTIVATE'].includes(file))return [];
 if(entry.isDirectory())return inventory(base,file);if(entry.isSymbolicLink()){if(!fs.realpathSync(absolute).startsWith(base+'/'))throw Error('External package link');return [{file,link:fs.readlinkSync(absolute)}];}if(!entry.isFile())throw Error('Special package file');return [{file,sha256:digest(absolute)}];
});}
execFileSync(process.execPath,['-e',"new (require(process.argv[1]+'/node_modules/better-sqlite3'))(':memory:').close();require(process.argv[1]+'/node_modules/sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1))",candidate]);
const plan={candidate,previous,buildId:result.buildId,files:inventory(candidate),helpers:['helpers/systemd_runtime.py','helpers/activate_test_release.py','helpers/audit_checks.py','activate-test.py'].map(file=>({file,sha256:digest(evidence+'/'+file)}))};
fs.writeFileSync(evidence+'/activation-plan.json',JSON.stringify(plan,null,2),{mode:0o600});fs.unlinkSync(candidate+'/DO_NOT_ACTIVATE');console.log(JSON.stringify({candidate,previous,buildId:result.buildId,activated:false}));
