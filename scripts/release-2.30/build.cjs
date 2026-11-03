// Build only the committed release tree. Uncommitted Testing files never enter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/build-2\.30-promotion-\d{8}-\w+$/.test(evidence))throw Error('Explicit release evidence required');
const reuse=process.argv[3]&&path.resolve(process.argv[3]);if(reuse&&(!reuse.startsWith(evidence+'/build-')||path.basename(reuse)!=='source'||!fs.existsSync(reuse+'/.next')))throw Error('Invalid build-cache boundary');
const root=reuse?path.dirname(reuse):fs.mkdtempSync(evidence+'/build-'),build=root+'/source',data=root+'/data';if(!reuse){fs.mkdirSync(build);fs.mkdirSync(data,{mode:0o700});}
const commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();const archive=root+'/source.tar';
cp.execFileSync('git',['archive','--format=tar','--output='+archive,commit],{cwd:source});cp.execFileSync('tar',['-xf',archive,'-C',build]);if(!reuse)fs.symlinkSync(fs.realpathSync(source+'/node_modules'),build+'/node_modules');
for(const forbidden of ['lib/refmodLab','app/app/components/RefModReplacementLab.tsx','app/api/experiments/refmod-replacement','scripts/refmod-replacement'])if(fs.existsSync(build+'/'+forbidden))throw Error('Experimental lab entered release source');
if(JSON.parse(fs.readFileSync(build+'/config/build-history.json')).current!=='2.30')throw Error('Incorrect release version');
console.log(JSON.stringify({root,build,commit}));const log=fs.openSync(root+'/build.log',reuse?'w':'wx',0o600);
const result=cp.spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:build,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',NODE_ENV:'production',OTG_ENV:'prod',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--max-old-space-size=6144'}});fs.closeSync(log);
const report={build,commit,exitCode:result.status,buildId:fs.existsSync(build+'/.next/BUILD_ID')?fs.readFileSync(build+'/.next/BUILD_ID','utf8').trim():null};fs.writeFileSync(root+'/result.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));process.exitCode=result.status??1;
