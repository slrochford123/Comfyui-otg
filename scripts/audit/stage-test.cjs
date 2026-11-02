// Additive release packaging only. Does not activate, restart, push or mutate live data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||'');
if(!evidence.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-')||!fs.existsSync(path.join(evidence,'source-before.tar.gz'))||!build.startsWith(evidence+'/build-'))throw Error('Expected backed-up audit source and isolated build');
if(fs.existsSync(path.join(evidence,'test-activation-plan.json')))throw Error('Pinned activation plan already exists');
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));
if(built.exitCode!==0||built.build!==build)throw Error('Successful build record required');
const qa=fs.readdirSync(evidence).filter(n=>n.startsWith('http-qa-')).map(n=>path.join(evidence,n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>({file:f,...JSON.parse(fs.readFileSync(f,'utf8'))}));
if(!qa.some(r=>r.ok&&r.buildId===built.buildId))throw Error('Exact build needs successful HTTP qualification');
const test='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(path.join(test,'current'));
if(previous!=='/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-smart-references-2.19-20261101T172723Z')throw Error('TEST pointer changed; refresh baseline');
const stamp=new Date().toISOString().replaceAll(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const candidate=path.join(test,'releases','test3001-audit-remediation-'+stamp),standalone=path.join(build,'.next/standalone');
fs.mkdirSync(candidate,{mode:0o755});fs.writeFileSync(path.join(candidate,'DO_NOT_ACTIVATE'),'Packaging incomplete\n');
fs.cpSync(standalone,candidate,{recursive:true,force:false,errorOnExist:true,filter:file=>{
  const rel=path.relative(standalone,file);
  return !['node_modules','data'].includes(rel)&&!rel.startsWith('data/')&&!rel.split(path.sep).some(p=>p.startsWith('.env'));
}});
fs.cpSync(fs.realpathSync(path.join(standalone,'node_modules')),path.join(candidate,'node_modules'),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
for(const name of ['public','scripts','lib','comfy_workflows','config'])if(fs.existsSync(path.join(build,name)))fs.cpSync(path.join(build,name),path.join(candidate,name),{recursive:true,force:true});
fs.cpSync(path.join(build,'.next/static'),path.join(candidate,'.next/static'),{recursive:true,force:true});
fs.copyFileSync(path.join(build,'package-lock.json'),path.join(candidate,'package-lock.json'));
for(const [name,target] of Object.entries({'.env.local':'/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',data:'/home/shawn-rochford/AI/runtime/test/data'})){
  if(fs.existsSync(path.join(candidate,name)))throw Error('Unexpected runtime data packaged: '+name);
  fs.symlinkSync(target,path.join(candidate,name));
}
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(candidate,'public/audit-remediation.json'),JSON.stringify({feature:'audit-remediation',buildVersion:'2.19',buildId:built.buildId,sourceHead,includesLocalChanges:true,testOnly:true,promotionAuthorized:false}));
const helpers=path.join(evidence,'activation-helpers');fs.mkdirSync(helpers,{recursive:true,mode:0o700});
for(const [from,to] of [['scripts/deploy/systemd_runtime.py','activation-helpers/systemd_runtime.py'],['scripts/audit/migrate-candidate.cjs','activation-helpers/migrate-candidate.cjs'],['scripts/audit/activate-test.py','activate-test.py']])fs.copyFileSync(path.join(source,from),path.join(evidence,to),fs.constants.COPYFILE_EXCL);
function inventory(dir,relative=''){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(relative,entry.name),absolute=path.join(dir,entry.name);
    if(['data','.env.local','DO_NOT_ACTIVATE'].includes(file))return [];
    if(entry.isDirectory())return inventory(absolute,file);
    if(entry.isSymbolicLink()){
      if(!fs.realpathSync(absolute).startsWith(candidate+path.sep))throw Error('External dependency symlink: '+file);
      return [{file,link:fs.readlinkSync(absolute)}];
    }
    return [{file,sha256:digest(absolute)}];
  });
}
const plan={candidate,previous,buildId:built.buildId,build,source,sourceHead,files:inventory(candidate),helpers:['activation-helpers/systemd_runtime.py','activation-helpers/migrate-candidate.cjs','activate-test.py'].map(file=>({file,sha256:digest(path.join(evidence,file))}))};
execFileSync(process.execPath,['-e',"const D=require(process.argv[1]+'/node_modules/better-sqlite3');new D(':memory:').close();require(process.argv[1]+'/node_modules/sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1));",candidate]);
fs.writeFileSync(path.join(evidence,'test-activation-plan.json'),JSON.stringify(plan,null,2),{mode:0o600});
fs.unlinkSync(path.join(candidate,'DO_NOT_ACTIVATE'));
console.log(JSON.stringify({candidate,previous,buildId:built.buildId,pinnedFiles:plan.files.length,activated:false,prodChanged:false,githubPushed:false}));
