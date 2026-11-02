// Additive, pinned TEST packaging. No service or production changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||''),expected=process.argv[4];
if(!/^\/home\/shawn-rochford\/AI\/research\/experimental-tabs-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-')||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Expected backed-up isolated build');
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));
if(built.exitCode!==0||built.build!==build)throw Error('Successful exact build required');
const qa=fs.readdirSync(path.dirname(build)).filter(n=>n.startsWith('browser-')).map(n=>path.join(build,'..',n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
if(!qa.some(result=>result.ok&&result.buildId===built.buildId))throw Error('Exact build browser qualification required');
const test='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(path.join(test,'current'));
if(previous!==expected||!previous.startsWith(test+'/releases/test3001-'))throw Error('Exact previous release changed');
if(fs.existsSync(path.join(evidence,'activation-plan.json')))throw Error('Activation already staged');
const stamp=new Date().toISOString().replaceAll(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const candidate=path.join(test,'releases','test3001-experimental-tabs-'+stamp),standalone=path.join(build,'.next/standalone');
fs.mkdirSync(candidate,{mode:0o755});fs.writeFileSync(path.join(candidate,'DO_NOT_ACTIVATE'),'Incomplete packaging\n');
fs.cpSync(standalone,candidate,{recursive:true,force:false,errorOnExist:true,filter:file=>{const rel=path.relative(standalone,file);return !['node_modules','data'].includes(rel)&&!rel.startsWith('data/')&&!rel.split(path.sep).some(p=>p.startsWith('.env'));}});
fs.cpSync(fs.realpathSync(path.join(standalone,'node_modules')),path.join(candidate,'node_modules'),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
for(const name of ['public','scripts','lib','comfy_workflows','config'])if(fs.existsSync(path.join(build,name)))fs.cpSync(path.join(build,name),path.join(candidate,name),{recursive:true,force:true});
fs.cpSync(path.join(build,'.next/static'),path.join(candidate,'.next/static'),{recursive:true,force:true});
fs.copyFileSync(path.join(build,'package-lock.json'),path.join(candidate,'package-lock.json'));
const bootstrap="require('./scripts/audio-editing-release-bootstrap.cjs');\n";
if(fs.readFileSync(path.join(previous,'server.js'),'utf8').startsWith(bootstrap)){
  const old=fs.readFileSync(path.join(previous,'scripts/audio-editing-release-bootstrap.cjs'));
  const next=fs.readFileSync(path.join(candidate,'scripts/audio-editing-release-bootstrap.cjs'));
  if(!old.equals(next))throw Error('Audio bootstrap changed; review required');
  const server=path.join(candidate,'server.js');fs.writeFileSync(server,bootstrap+fs.readFileSync(server,'utf8'));
}
for(const [name,target] of Object.entries({'.env.local':'/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',data:'/home/shawn-rochford/AI/runtime/test/data'})){
  if(fs.existsSync(path.join(candidate,name)))throw Error('Runtime data unexpectedly packaged');fs.symlinkSync(target,path.join(candidate,name));
}
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(candidate,'public/experimental-workspace.json'),JSON.stringify({feature:'experimental-workspace',buildId:built.buildId,sourceHead,includesLocalChanges:true,testOnly:true,executionEnabled:false,promotionEnabled:false}));
const helpers=path.join(evidence,'helpers');fs.mkdirSync(helpers,{mode:0o700});
for(const [from,to] of [['scripts/deploy/systemd_runtime.py','helpers/systemd_runtime.py'],['scripts/deploy/activate_test_release.py','helpers/activate_test_release.py'],['scripts/audit/activate-test.py','helpers/audit_checks.py'],['scripts/experiments/activate-test.py','activate-test.py']])fs.copyFileSync(path.join(source,from),path.join(evidence,to),fs.constants.COPYFILE_EXCL);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(root,relative='') {return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(relative,entry.name),absolute=path.join(root,file);if(['data','.env.local','DO_NOT_ACTIVATE'].includes(file))return [];
  if(entry.isDirectory())return inventory(root,file);
  if(entry.isSymbolicLink()){if(!fs.realpathSync(absolute).startsWith(root+path.sep))throw Error('External package symlink: '+file);return [{file,link:fs.readlinkSync(absolute)}];}
  if(!entry.isFile())throw Error('Special package file');return [{file,sha256:digest(absolute)}];
});}
const plan={candidate,previous,buildId:built.buildId,sourceHead,files:inventory(candidate),helpers:['helpers/systemd_runtime.py','helpers/activate_test_release.py','helpers/audit_checks.py','activate-test.py'].map(file=>({file,sha256:digest(path.join(evidence,file))}))};
execFileSync(process.execPath,['-e',"const D=require(process.argv[1]+'/node_modules/better-sqlite3');new D(':memory:').close();require(process.argv[1]+'/node_modules/sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1));",candidate]);
fs.writeFileSync(path.join(evidence,'activation-plan.json'),JSON.stringify(plan,null,2),{mode:0o600}); fs.unlinkSync(path.join(candidate,'DO_NOT_ACTIVATE'));
console.log(JSON.stringify({candidate,previous,buildId:built.buildId,files:plan.files.length,activated:false,prodChanged:false}));
