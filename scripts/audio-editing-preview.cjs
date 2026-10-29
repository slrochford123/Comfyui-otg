// Run the exact staged artifact on the owned QA port. No managed service changes.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(process.argv[2]||''),pid=Number(process.argv[3]);
if(!root.startsWith('/home/shawn-rochford/AI/research/unified-audio-build209-'))throw Error('Unexpected candidate');
const {release}=JSON.parse(fs.readFileSync(path.join(root,'test-candidate.json')));
if(!release.startsWith('/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-unified-audio-build209-'))throw Error('TEST artifact only');
const entries=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean),env=Object.fromEntries(entries.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
if(env.OTG_ENV!=='test')throw Error('Not TEST');
Object.assign(env,{PORT:'3308',HOSTNAME:'100.75.162.64',NODE_ENV:'production',OTG_AUDIO_ISOLATED_DEV:'1',NEXT_TELEMETRY_DISABLED:'1'});
const child=spawn(process.execPath,['server.js'],{cwd:release,env,stdio:'inherit'});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));child.on('exit',code=>process.exitCode=code||0);
