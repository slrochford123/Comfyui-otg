/* Build and package a private QA candidate. Never activates TEST/PROD or pushes Git. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..'),root=path.resolve(process.argv[2]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/media-gpu-routing-20261029-[A-Za-z0-9]+$/.test(root))throw Error('Use a dedicated research root.');
const final=process.argv.includes('--final');
const candidate=path.join(root,final?'qa-candidate-final':'qa-candidate');
if(fs.existsSync(candidate))throw Error('Candidate exists; do not overwrite qualification evidence.');
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',
  AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_ENV:'test',OTG_AUDIO_ISOLATED_DEV:'1',
  OTG_DATA_DIR:path.join(root,'build-data'),OTG_MEDIA_GPU_ROUTING:'1',NEXT_PUBLIC_OTG_MEDIA_GPU_ROUTING:'1'};
const log=fs.openSync(path.join(root,final?'build-final.log':'build.log'),'a',0o600);
const child=spawn(process.execPath,[path.join(source,'node_modules/next/dist/bin/next'),'build'],{cwd:source,env,stdio:['ignore',log,log]});
child.once('error',error=>{fs.closeSync(log);console.error(error.message);process.exitCode=1;});
child.once('exit',code=>{
  fs.closeSync(log);if(code!==0){console.error('Build failed; inspect build.log.');process.exitCode=1;return;}
  fs.cpSync(path.join(source,'.next/standalone'),candidate,{recursive:true,filter:file=>!/^\.env(?:[.-]|$)/.test(path.basename(file))});
  fs.cpSync(path.join(source,'.next/static'),path.join(candidate,'.next/static'),{recursive:true});
  for(const name of ['public','config','comfy_workflows','workflows','lib','scripts'])if(fs.existsSync(path.join(source,name)))fs.cpSync(path.join(source,name),path.join(candidate,name),{recursive:true});
  fs.writeFileSync(path.join(root,final?'candidate-final.json':'candidate.json'),JSON.stringify({source,candidate,buildId:fs.readFileSync(path.join(candidate,'.next/BUILD_ID'),'utf8').trim(),
    builtAt:new Date().toISOString(),testActivated:false,prodChanged:false,githubPushed:false,versionBumpPendingQualification:true},null,2),{mode:0o600});
  console.log(JSON.stringify({ok:true,candidate,activated:false}));
});
