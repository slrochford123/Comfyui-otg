// Additive TEST packaging only. Does NOT switch a pointer or restart a service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[2]||''),build=path.join(root,'source');
if(!root.startsWith('/home/shawn-rochford/AI/research/unified-audio-build209-')||JSON.parse(fs.readFileSync(path.join(root,'build-result.json'))).exitCode!==0)throw Error('No successful isolated build');
const base='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(base+'/current');
if(previous!==base+'/releases/test3001-singularity-versions-build208-20261029T111929Z')throw Error('TEST pointer changed; review before staging');
const name='test3001-unified-audio-build209-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z'),release=path.join(base,'releases',name);
fs.mkdirSync(release,{recursive:false});
function copy(from,to){const r=spawnSync('rsync',['-a',from+'/',to+'/'],{stdio:'inherit'});if(r.status!==0)throw Error('Artifact copy failed');}
copy(path.join(build,'.next/standalone'),release);
const dep=path.join(release,'node_modules');if(!fs.lstatSync(dep).isSymbolicLink())throw Error('Expected generated dependency link');fs.unlinkSync(dep);fs.mkdirSync(dep);
copy(fs.realpathSync(path.join(build,'node_modules')),dep);
copy(path.join(build,'.next/static'),path.join(release,'.next/static'));
for(const dir of ['public','scripts','lib','src','config','workflows','comfy_workflows','h3-qualified-source'])if(fs.existsSync(path.join(build,dir)))copy(path.join(build,dir),path.join(release,dir));
fs.symlinkSync('/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',path.join(release,'.env.local'));
fs.symlinkSync('/home/shawn-rochford/AI/runtime/test/data',path.join(release,'data'));
copy(path.join(previous,'owner-activation'),path.join(release,'owner-activation'));
fs.copyFileSync(path.join(__dirname,'audio-editing-release-bootstrap.cjs'),path.join(release,'scripts/audio-editing-release-bootstrap.cjs'));
const server=path.join(release,'server.js');fs.writeFileSync(server,"require('./scripts/audio-editing-release-bootstrap.cjs');\n"+fs.readFileSync(server,'utf8'));
const provenance={name,buildVersion:'2.09',builtAt:new Date().toISOString(),sourceBaseCommit:'82b83035d67c244663b97666bd7f42226d65b18a',uncommittedTestImplementation:true,testOnly:true,githubPushAuthorized:false,productionPromotionAuthorized:false};
fs.writeFileSync(path.join(release,'RELEASE_PROVENANCE.json'),JSON.stringify(provenance,null,2));
fs.writeFileSync(path.join(root,'test-candidate.json'),JSON.stringify({release,expectedCurrent:previous,buildVersion:'2.09'},null,2));
const critical=['server.js','.next/BUILD_ID','.next/server/app/api/edit-video/audio/route.js','scripts/audio-editing-worker.py','scripts/audio-editing-remote.py','scripts/audio-editing-music.py','scripts/audio-editing-effects.py','scripts/audio-editing-release-bootstrap.cjs','owner-activation/activate_test_release.py','owner-activation/systemd_runtime.py'];
fs.writeFileSync(path.join(root,'artifact-integrity.json'),JSON.stringify({release,files:critical.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(release,file))).digest('hex')}))},null,2));
console.log(JSON.stringify({staged:true,release,expectedCurrent:previous,activated:false,productionChanged:false},null,2));
