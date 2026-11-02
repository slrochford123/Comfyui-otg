// Package only the qualified billing build; never activate or touch PROD here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||''),expected=process.argv[4];
if(!/^\/home\/shawn-rochford\/AI\/research\/openai-billing-fix-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-')||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Explicit backed-up isolated build required');
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));
if(built.exitCode!==0||built.build!==build||built.experimentalTabsIncluded!==false)throw Error('Narrow successful billing build required');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const item of built.overlay)if(digest(path.join(source,item.file))!==item.sha256)throw Error('Source changed since qualified build: '+item.file);
const reports=fs.readdirSync(path.dirname(build)).filter(n=>n.startsWith('browser-')).map(n=>path.join(build,'..',n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
if(!reports.some(r=>r.ok&&r.buildId===built.buildId))throw Error('Exact browser QA required');
const test='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(path.join(test,'current'));
if(previous!==expected||!previous.startsWith(test+'/releases/test3001-'))throw Error('Live TEST release changed');
if(fs.existsSync(path.join(evidence,'activation-plan.json')))throw Error('Already staged');
const stamp=new Date().toISOString().replaceAll(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const candidate=path.join(test,'releases','test3001-openai-billing-'+stamp),standalone=path.join(build,'.next/standalone');
fs.mkdirSync(candidate,{mode:0o755});fs.writeFileSync(path.join(candidate,'DO_NOT_ACTIVATE'),'Packaging incomplete\n');
fs.cpSync(standalone,candidate,{recursive:true,force:false,errorOnExist:true,filter:file=>{const rel=path.relative(standalone,file);return !['node_modules','data'].includes(rel)&&!rel.startsWith('data/')&&!rel.split(path.sep).some(p=>p.startsWith('.env'));}});
fs.cpSync(fs.realpathSync(path.join(standalone,'node_modules')),path.join(candidate,'node_modules'),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
for(const name of ['public','scripts','lib','comfy_workflows','config'])if(fs.existsSync(path.join(build,name)))fs.cpSync(path.join(build,name),path.join(candidate,name),{recursive:true,force:true});
fs.cpSync(path.join(build,'.next/static'),path.join(candidate,'.next/static'),{recursive:true,force:true});
fs.copyFileSync(path.join(build,'package-lock.json'),path.join(candidate,'package-lock.json'));
const bootstrap="require('./scripts/audio-editing-release-bootstrap.cjs');\n";
if(fs.readFileSync(path.join(previous,'server.js'),'utf8').startsWith(bootstrap)){
  if(!fs.readFileSync(path.join(previous,'scripts/audio-editing-release-bootstrap.cjs')).equals(fs.readFileSync(path.join(candidate,'scripts/audio-editing-release-bootstrap.cjs'))))throw Error('Audio bootstrap mismatch');
  const server=path.join(candidate,'server.js');fs.writeFileSync(server,bootstrap+fs.readFileSync(server,'utf8'));
}
for(const [name,target] of Object.entries({'.env.local':'/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',data:'/home/shawn-rochford/AI/runtime/test/data'})){
  if(fs.existsSync(path.join(candidate,name)))throw Error('Runtime data packaged unexpectedly');fs.symlinkSync(target,path.join(candidate,name));
}
fs.writeFileSync(path.join(candidate,'public/openai-billing-fix.json'),JSON.stringify({feature:'openai-billing-fix',buildId:built.buildId,baseline:built.baseline,testOnly:true,experimentalTabsIncluded:false}));
fs.mkdirSync(path.join(evidence,'helpers'),{mode:0o700});
for(const [from,to] of [['scripts/deploy/systemd_runtime.py','helpers/systemd_runtime.py'],['scripts/deploy/activate_test_release.py','helpers/activate_test_release.py'],['scripts/audit/activate-test.py','helpers/audit_checks.py'],['scripts/experiments/activate-test.py','activate-test.py']])fs.copyFileSync(path.join(source,from),path.join(evidence,to),fs.constants.COPYFILE_EXCL);
function inventory(root,relative=''){return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(relative,entry.name),absolute=path.join(root,file);if(['data','.env.local','DO_NOT_ACTIVATE'].includes(file))return [];
  if(entry.isDirectory())return inventory(root,file);
  if(entry.isSymbolicLink()){if(!fs.realpathSync(absolute).startsWith(root+path.sep))throw Error('External package symlink');return [{file,link:fs.readlinkSync(absolute)}];}
  if(!entry.isFile())throw Error('Special file');return [{file,sha256:digest(absolute)}];
});}
execFileSync(process.execPath,['-e',"const D=require(process.argv[1]+'/node_modules/better-sqlite3');new D(':memory:').close();require(process.argv[1]+'/node_modules/sharp');",candidate]);
const plan={candidate,previous,buildId:built.buildId,marker:'openai-billing-fix.json',sourceHead:built.baseline,files:inventory(candidate),helpers:['helpers/systemd_runtime.py','helpers/activate_test_release.py','helpers/audit_checks.py','activate-test.py'].map(file=>({file,sha256:digest(path.join(evidence,file))}))};
fs.writeFileSync(path.join(evidence,'activation-plan.json'),JSON.stringify(plan,null,2),{mode:0o600});fs.unlinkSync(path.join(candidate,'DO_NOT_ACTIVATE'));
console.log(JSON.stringify({candidate,previous,buildId:built.buildId,activated:false,prodChanged:false}));
