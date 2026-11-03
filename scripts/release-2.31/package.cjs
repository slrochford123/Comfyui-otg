// Package the exact committed, production-configured build. No service control.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/build-2\.31-promotion-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-'))throw Error('Explicit release build required');
const result=JSON.parse(fs.readFileSync(path.dirname(build)+'/result.json'));if(result.exitCode!==0)throw Error('Build did not succeed');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const test='/home/shawn-rochford/AI/research/character-voice-20261103-nzYCmx8X/build-AyU3M3/source',testBaselineBuildId=fs.readFileSync(test+'/.next/BUILD_ID','utf8').trim();
const approvedFiles=JSON.parse(fs.readFileSync(source+'/scripts/release-2.31/files.json'));
const parity=approvedFiles.filter(f=>!f.startsWith('tests/')).map(file=>{if(!fs.readFileSync(build+'/'+file).equals(fs.readFileSync(test+'/'+file)))throw Error('Feature differs from owner-qualified TEST: '+file);return{file,sha256:hash(build+'/'+file)};});
const name='prod-build-2.31-'+result.commit.slice(0,12),release=evidence+'/'+name;fs.mkdirSync(release);
fs.cpSync(build+'/.next/standalone',release,{recursive:true,dereference:true,filter:file=>{const rel=path.relative(build+'/.next/standalone',file);return !rel.split(path.sep).some(p=>p.startsWith('.env')||p==='data'||p==='node_modules');}});
const dependencies=fs.realpathSync(build+'/.next/standalone/node_modules');
fs.cpSync(dependencies,release+'/node_modules',{recursive:true,dereference:true});
for(const dir of ['public','lib','scripts','config','comfy_workflows','workflows'])if(fs.existsSync(build+'/'+dir))fs.cpSync(build+'/'+dir,release+'/'+dir,{recursive:true,dereference:true,filter:file=>!/(?:^|\/)(?:__pycache__|\.env[^/]*|\.git|data)(?:\/|$)|\.(?:pyc|sqlite3?|db|safetensors|gguf|pth|ckpt)$/i.test(file)});
fs.cpSync(build+'/.next/static',release+'/.next/static',{recursive:true});
const boot="require('./scripts/audio-editing-release-bootstrap.cjs');\n";fs.writeFileSync(release+'/server.js',boot+fs.readFileSync(release+'/server.js','utf8'));
for(const forbidden of ['lib/refmodLab','app/api/experiments/refmod-replacement','scripts/refmod-replacement'])if(fs.existsSync(release+'/'+forbidden))throw Error('Experimental lab entered package');
fs.writeFileSync(release+'/public/non-testing-release.json',JSON.stringify({buildVersion:'2.31',buildId:result.buildId,commit:result.commit,testingPromoted:false,qwenImages:16,fiboImages:4,googlePhotosInApp:true,androidMinimumVersionCode:39}));
fs.writeFileSync(release+'/public/character-voice-design.json',JSON.stringify({feature:'character-voice-design',buildId:result.buildId,testOnly:false,engines:['qwen3'],recoverableLibraryDelete:true,qualityTested:false,testingPromoted:false}));
const builtAt=new Date().toISOString(),identity={name,buildVersion:'2.31',buildId:result.buildId,commit:result.commit,node:process.version,builtAt};
fs.writeFileSync(release+'/RELEASE_PROVENANCE.json',JSON.stringify(identity));
const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink()){
 const target=fs.realpathSync(file);if(!file.startsWith(release+'/node_modules/')||!target.startsWith(dependencies+'/')||!fs.statSync(target).isFile())throw Error('Untrusted artifact link: '+path.relative(release,file));
 // Replace only a verified link inside this newly created package, never its source.
 fs.unlinkSync(file);fs.copyFileSync(target,file);
 }if(fs.statSync(file).isDirectory())walk(file);else if(fs.statSync(file).isFile())files.push({file:path.relative(release,file),sha256:hash(file),bytes:fs.statSync(file).size});else throw Error('Unsupported artifact entry');}}walk(release);
fs.writeFileSync(release+'/DEPLOYMENT_MANIFEST.json',JSON.stringify({...identity,artifactFiles:files},null,2));
const previous=JSON.parse(fs.readFileSync('/home/shawn-rochford/AI/research/build-2.30-promotion-20261103-sd4X6oVK/production-plan.json'));
const plan={...previous,...identity,candidate:'/opt/otg/releases/'+name,expectedOld:'/mnt/otg_bulk/slr-offload/opt-otg/releases/prod-build-2.30-8a48afb1960d',manifestSha256:hash(release+'/DEPLOYMENT_MANIFEST.json'),testBaselineBuildId,testSourceParity:parity,productionSmokeSha256:null};
// Existing private H3 runtime/config is retained, never reinstalled for this UI release.
delete plan.expectedNsfwStorageSha256;
plan.testRelease=fs.realpathSync('/home/shawn-rochford/AI/deploy/otg-test/current');plan.promotedFromTest=path.basename(plan.testRelease);
fs.writeFileSync(evidence+'/production-plan.json',JSON.stringify(plan,null,2),{mode:0o600});
const archive=evidence+'/'+name+'.tar.gz';cp.execFileSync('tar',['-czf',archive,'-C',evidence,name]);
const report={...identity,archive,archiveSha256:hash(archive),stage:'/mnt/otg_bulk/build-2.31-promotion-'+result.commit.slice(0,12),candidate:plan.candidate};fs.writeFileSync(evidence+'/production-package.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
