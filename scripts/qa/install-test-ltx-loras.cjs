// Additive TEST-prefixed aliases only. Never overwrites an existing model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const requirements=JSON.parse(fs.readFileSync('lib/ltxStudiosOfficialRequirements.json','utf8'));
const root='/home/shawn-rochford/AI/runtime/test/qualification/ltx25-loras';
const aliases='/home/shawn-rochford/AI/ComfyUI/models/loras/TEST-LTX-Closure';
fs.mkdirSync(aliases,{recursive:true});
(async()=>{const records=[];for(const id of requirements.filter(x=>x.id!=='alpha-gen').map(x=>x.id)){
 const row=requirements.find(x=>x.id===id),source=path.join(root,row.file),target=path.join(aliases,row.file);
 if(fs.statSync(source).size!==row.downloadBytes)throw Error('Unexpected model byte count: '+id);
 const handle=fs.openSync(source,'r'),prefix=Buffer.alloc(8);fs.readSync(handle,prefix,0,8,0);const length=Number(prefix.readBigUInt64LE());if(length<2||length>10000000)throw Error('Invalid safetensors header');const header=Buffer.alloc(length);fs.readSync(handle,header,0,length,8);fs.closeSync(handle);JSON.parse(header.toString());
 const sha256=await new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),s=fs.createReadStream(source);s.on('data',c=>h.update(c));s.on('error',reject);s.on('end',()=>resolve(h.digest('hex')));});
 if(fs.existsSync(target)){if(!fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==source)throw Error('Refusing existing model replacement');}else fs.symlinkSync(source,target);
 records.push({id,source:row.source,license:row.license,bytes:row.downloadBytes,sha256,storedPath:source,workerAlias:'TEST-LTX-Closure/'+row.file});
 }fs.writeFileSync('/home/shawn-rochford/AI/runtime/test/qualification/installed-ltx-closure-models.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records));})().catch(e=>{console.error(e.message);process.exitCode=1});
