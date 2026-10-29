/* Exact-build packaging only; no service control or runtime data imported. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
process.umask(0o077);
const root=path.resolve(process.argv[2]||''),source=path.resolve(__dirname,'../..');
if(!/^\/home\/shawn-rochford\/AI\/research\/media-gpu-routing-20261029-[A-Za-z0-9]+$/.test(root))throw Error('Use the qualified private research root');
const git=(...args)=>cp.execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
const hash=file=>{const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
function assert(value,message){if(!value)throw Error(message);}
assert(process.version==='v22.23.4'&&!git('status','--porcelain'),'Clean exact source and pinned Node required');
const commit=git('rev-parse','HEAD'),version='2.12',name='prod-build-'+version+'-'+commit.slice(0,12),release=path.join(root,name);
assert(!fs.existsSync(release),'Never overwrite a prepared artifact');
for(const file of ['http-qualification-final.json','production-mode-qualification.json','publication-audit.json'])assert(JSON.parse(fs.readFileSync(path.join(root,file))).passed,'Qualification did not pass: '+file);
const tests=JSON.parse(fs.readFileSync(path.join(root,'contracts.json')));assert(tests.success&&tests.numFailedTests===0,'Contract suite did not pass');
const candidate=path.join(root,'qa-candidate-final');
assert(JSON.parse(fs.readFileSync(path.join(candidate,'config/build-history.json'))).current===version,'Wrong version');
for(const file of ['config/build-history.json','scripts/audio-editing-release-bootstrap.cjs','scripts/audio-editing-worker.py','scripts/audio-editing-restricted-remote.py','scripts/media-gpu-admission.py'])assert(hash(path.join(source,file))===hash(path.join(candidate,file)),'Packaged source mismatch: '+file);
const allowed=new Set(['server.js','package.json','.next','node_modules','public','scripts','lib','config','workflows','comfy_workflows']);
fs.cpSync(candidate,release,{recursive:true,dereference:true,filter:file=>{
 const rel=path.relative(candidate,file),top=rel.split(path.sep)[0];
 return (!top||allowed.has(top))&&!/(?:^|\/)(?:\.env[^/]*|__pycache__|\.cache|cache|\.git)(?:\/|$)|\.(?:pyc|pyo|sqlite3?|db|safetensors|ckpt|gguf|pth)$/i.test(rel);
}});
const artifactFiles=[];
function walk(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,item.name),rel=path.relative(release,file);assert(!item.isSymbolicLink(),'Unexpected deployment link');
 if(item.isDirectory())walk(file);else if(item.isFile())artifactFiles.push({file:rel,sha256:hash(file),bytes:fs.statSync(file).size});
}}
walk(release);artifactFiles.sort((a,b)=>a.file.localeCompare(b.file));
const buildId=fs.readFileSync(path.join(release,'.next/BUILD_ID'),'utf8').trim();
const metadata={name,buildVersion:version,commit,node:process.version,buildId,builtAt:JSON.parse(fs.readFileSync(path.join(root,'candidate-final.json'))).builtAt,
 sourceFiles:git('ls-files','-z').split('\0').filter(Boolean).map(file=>({file,sha256:hash(path.join(source,file))})),artifactFiles,
 validation:{contracts:tests.numPassedTests,productionModeRealAudioBothGpus:true,sharedPhysicalAuthority:true,gpuDriversChanged:false,paidApisCalled:false},productionActivated:false};
fs.writeFileSync(path.join(release,'RELEASE_PROVENANCE.json'),JSON.stringify(metadata,null,2));
const runtime=JSON.parse(fs.readFileSync(path.join(root,'private-runtime.json')));
const rootEngineConfig='/var/lib/slr-private-media-runtime/build-2.12-'+commit.slice(0,12)+'/engines.json';
const program="import hashlib,json,pathlib,sys;p=json.load(sys.stdin);c=json.loads(pathlib.Path(p['source']).read_text());r=pathlib.Path(p['destination']).parent;\nfor gpu,t in c['transports'].items():\n t['identityFile']=str(r/'keys'/(gpu+'.key'));t['knownHostsFile']=str(r/'keys'/(gpu+'.known_hosts'))\nprint(hashlib.sha256(json.dumps(c,indent=2,sort_keys=True).encode()).hexdigest())";
const shellQuote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const rootEngineConfigSha256=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','HostName=192.168.1.113','-o','HostKeyAlias=100.98.212.116','otg-slr','/usr/bin/python3 -c '+shellQuote(program)],{input:JSON.stringify({source:runtime.engineConfig,destination:rootEngineConfig}),encoding:'utf8'}).trim();
assert(/^[a-f0-9]{64}$/.test(rootEngineConfigSha256),'Invalid root configuration derivation');
const plan={buildVersion:version,commit,buildId,node:process.version,rootEngineConfig,rootEngineConfigSha256,candidate:'/opt/otg/releases/'+name,expectedOld:'/mnt/otg_bulk/slr-offload/opt-otg/releases/prod-build-2.08-82b83035d67c',
 manifestSha256:hash(path.join(release,'RELEASE_PROVENANCE.json')),systemdRuntimeSha256:hash(path.join(release,'scripts/deploy/systemd_runtime.py')),runtime};
const planFile=path.join(root,'activation-plan.json');fs.writeFileSync(planFile,JSON.stringify(plan,null,2));
const template=fs.readFileSync(path.join(source,'scripts/deploy/activate-private-media-prod.py'),'utf8');assert(template.includes('__ACTIVATION_PLAN_SHA256__'),'Missing plan hash marker');
fs.writeFileSync(path.join(root,'activate-build-2.12.py'),template.replace('__ACTIVATION_PLAN_SHA256__',hash(planFile)));
const archive=path.join(root,name+'.tar.gz');cp.execFileSync('tar',['-czf',archive,'-C',root,name]);
const report={version,commit,buildId,localRelease:release,archive,archiveSha256:hash(archive),stage:'/opt/otg/staging/build-2.12-'+commit.slice(0,12),candidate:plan.candidate,activated:false};
fs.writeFileSync(path.join(root,'production-package.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
