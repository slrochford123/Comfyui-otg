// Additive TEST-only user service. Never edits/restarts the shared ACE service.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root='/home/shawn-rochford/AI/runtime/test/ace-isolated';
const original='/home/shawn-rochford/AI/ACE-Step-1.5';
const code=path.join(root,'service-code'),runtime=path.join(root,'runtime-checkpoints');
function header(file){const fd=fs.openSync(file,'r');try{const b=Buffer.alloc(8);fs.readSync(fd,b,0,8,0);const n=Number(b.readBigUInt64LE());if(n<2||n>20e6)throw Error('Invalid tensor header');const json=Buffer.alloc(n);fs.readSync(fd,json,0,n,8);const h=JSON.parse(json.toString());const last=Math.max(...Object.entries(h).filter(([k])=>k!=='__metadata__').map(([,v])=>v.data_offsets[1]));if(fs.statSync(file).size!==8+n+last)throw Error('Incomplete tensor file');return h;}finally{fs.closeSync(fd);}}
function link(target,value){fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target)){if(!fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==fs.realpathSync(value))throw Error('Refusing to replace existing dependency '+target);}else fs.symlinkSync(value,target);}
fs.mkdirSync(runtime,{recursive:true});
const excluded=new Set(['.git','.venv','.env','checkpoints','outputs','output','logs','__pycache__','.cache']);
const applicationFiles=new Set(['acestep','pyproject.toml','uv.lock','LICENSE','README.md']);
if(!fs.existsSync(path.join(code,'acestep/api_server.py')))fs.cpSync(original,code,{recursive:true,filter:src=>{
  const relative=path.relative(original,src);if(!relative)return true;
  const parts=relative.split(path.sep);
  return applicationFiles.has(parts[0])&&!parts.some(part=>excluded.has(part)||part.startsWith('.env.'));
}});
link(path.join(code,'checkpoints'),runtime);
for(const name of ['vae','Qwen3-Embedding-0.6B'])link(path.join(runtime,name),path.join(original,'checkpoints',name));
// Reuse the already installed official XL Base BF16 weights only after every
// tensor name matches its official HF index. No 2B or Turbo substitution.
const base=path.join(root,'checkpoints/acestep-v15-xl-base');
const existingBase='/home/shawn-rochford/AI/ComfyUI/models/diffusion_models/acestep_v1.5_xl_base_bf16.safetensors';
const expected=Object.keys(JSON.parse(fs.readFileSync(path.join(base,'model.safetensors.index.json'))).weight_map).sort();
const actual=Object.keys(header(existingBase)).filter(k=>k!=='__metadata__').sort();
if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Existing XL Base tensors differ from official index; do not substitute');
link(path.join(base,'model.safetensors'),existingBase);
// The official BF16 distributions are the same XL variants, not 2B fallbacks.
// Verify both publisher hash and exact HF tensor-key identity before exposing
// them to the runtime inventory. Incomplete downloads are never registered.
const publisherHashes={turbo:'86a1afb0a1f711f0e3304ff65d874df3ae6783db683dcf982513fb9b6d14ae71',sft:'3c05ae268353b3540fb1fd7db4fd77ffbda9802ec641b624e15648e030ecf3ce'};
for(const variant of ['turbo','sft']){
 const file=path.join(root,'official-bf16/split_files/diffusion_models',`acestep_v1.5_xl_${variant}_bf16.safetensors`);
 if(!fs.existsSync(file))continue;
 const dir=path.join(root,'checkpoints',`acestep-v15-xl-${variant}`);
 const keys=Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'model.safetensors.index.json'))).weight_map).sort();
 if(JSON.stringify(keys)!==JSON.stringify(Object.keys(header(file)).filter(k=>k!=='__metadata__').sort()))throw Error('XL variant tensor-key mismatch');
 const stat=fs.statSync(file),receipt=file+'.qa-sha256.json';let verified=false;
 try{const r=JSON.parse(fs.readFileSync(receipt));verified=r.sha256===publisherHashes[variant]&&r.bytes===stat.size&&r.mtimeMs===stat.mtimeMs;}catch{}
 if(!verified){const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(8*1024*1024),hash=crypto.createHash('sha256');try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}const digest=hash.digest('hex');if(digest!==publisherHashes[variant])throw Error('XL publisher checksum mismatch');fs.writeFileSync(receipt,JSON.stringify({sha256:digest,bytes:stat.size,mtimeMs:stat.mtimeMs,source:'Comfy-Org/ace_step_1.5_ComfyUI_files',license:'Apache-2.0'}));}
 link(path.join(dir,'model.safetensors'),file);
}
const installed=[];
for(const name of ['acestep-v15-xl-turbo','acestep-v15-xl-base','acestep-v15-xl-sft']){
  const dir=path.join(root,'checkpoints',name);
  if(!['config.json','silence_latent.pt'].every(file=>fs.existsSync(path.join(dir,file))))continue;
  const weights=fs.existsSync(path.join(dir,'model.safetensors'))?['model.safetensors']:['model-00001-of-00004.safetensors','model-00002-of-00004.safetensors','model-00003-of-00004.safetensors','model-00004-of-00004.safetensors'];
  if(!weights.every(f=>fs.existsSync(path.join(dir,f))))continue;
  weights.forEach(f=>header(path.join(dir,f)));
  link(path.join(runtime,name),dir);installed.push(name);
}
for(const dir of ['tmp','cache/hf','cache/modules','cache/pycache'])fs.mkdirSync(path.join(root,dir),{recursive:true});
const unit=path.resolve('scripts/test-maintenance/otg-test-ace-api.service');
const target='/home/shawn-rochford/.config/systemd/user/otg-test-ace-api.service';
fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(unit,target);
cp.execFileSync('systemctl',['--user','daemon-reload']);
console.log(JSON.stringify({isolatedRoot:root,installed,sharedServiceChanged:false}));
if(process.argv.includes('--start')){
  if(!installed.includes('acestep-v15-xl-base'))throw Error('Exact XL Base is not fully installed; refusing to start');
  (async()=>{
    const listener=cp.execFileSync('ss',['-ltnp','sport = :3001'],{encoding:'utf8'});const pid=listener.match(/pid=(\d+)/)?.[1];
    if(!pid||!fs.realpathSync('/proc/'+pid+'/cwd').startsWith('/home/shawn-rochford/AI/deploy/otg-test/releases/'))throw Error('TEST web boundary cannot be verified');
    for(const entry of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){const i=entry.indexOf('=');if(['OTG_DATA_ROOT','OTG_WORKER_CONTROL_STORE_DIR'].includes(entry.slice(0,i)))process.env[entry.slice(0,i)]=entry.slice(i+1);}
    require(path.resolve('scripts/register-ts-worker.cjs'));
    const {acquireAuxiliary3090}=require(path.resolve('lib/workers/auxiliary3090Lease.ts'));
    const release=await acquireAuxiliary3090('test-ace-service-start:'+Date.now());
    try{
      cp.execFileSync('systemctl',['--user','enable','--now','otg-test-ace-api.service']);
      const deadline=Date.now()+300000;
      while(Date.now()<deadline){
        try{const r=await fetch('http://127.0.0.1:8002/health',{signal:AbortSignal.timeout(3000)});const raw=await r.json();if(r.ok&&raw.data?.models_initialized===true){console.log(JSON.stringify({service:'otg-test-ace-api.service',initialized:true,model:raw.data.loaded_model,sharedServiceChanged:false}));return;}}catch{}
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      throw Error('Isolated ACE initialization did not pass within five minutes; inspect its user journal');
    }finally{release();}
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
