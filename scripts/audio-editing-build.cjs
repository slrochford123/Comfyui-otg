// Isolated build snapshot. Reads the verified TEST environment only in memory;
// never changes its service, symlinks, credentials or existing dependencies.
const fs=require('node:fs'),path=require('node:path'),{spawnSync,spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..'),root=path.resolve(process.argv[2]||''),pid=Number(process.argv[3]);
if(!root.startsWith('/home/shawn-rochford/AI/research/unified-audio-build209-')||!fs.statSync(root).isDirectory()||!Number.isInteger(pid))throw Error('Expected owned build directory and verified TEST PID');
const raw=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean),env=Object.fromEntries(raw.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
if(env.OTG_ENV!=='test'||env.OTG_DATA_DIR!=='/home/shawn-rochford/AI/runtime/test/data')throw Error('Not the verified TEST environment');
const build=path.join(root,'source');fs.mkdirSync(build,{recursive:true});
const copied=spawnSync('rsync',['-a','--exclude=.git','--exclude=node_modules','--exclude=.next','--exclude=.cache','--exclude=data','--exclude=.env*','--exclude=*.tsbuildinfo',source+'/',build+'/'],{stdio:'inherit'});if(copied.status!==0)throw Error('Build source copy failed');
fs.symlinkSync(fs.realpathSync(path.join(source,'node_modules')),path.join(build,'node_modules'));
// Preserve the established TEST configuration link without copying secret values.
fs.symlinkSync('/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',path.join(build,'.env.local'));
Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',OTG_AUDIO_ISOLATED_DEV:'1',OTG_AUDIO_EDITING_ENABLED:'1',NODE_OPTIONS:'--max-old-space-size=6144'});
const probe=spawnSync(process.execPath,['-e',"const D=require('better-sqlite3');new D(':memory:').close();require('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1));"],{cwd:build,env,stdio:'inherit'});if(probe.status!==0)throw Error('Native dependency probe failed; no rebuild attempted');
const startedAt=new Date().toISOString(),log=fs.openSync(path.join(root,'build.log'),'a',0o600);
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:build,env,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{fs.writeSync(log,chunk);process.stdout.write(chunk);});
child.on('exit',code=>{fs.closeSync(log);fs.writeFileSync(path.join(root,'build-result.json'),JSON.stringify({source,build,startedAt,finishedAt:new Date().toISOString(),exitCode:code,buildVersion:'2.09',testOnly:true,productionChanged:false},null,2));process.exitCode=code||0;});
