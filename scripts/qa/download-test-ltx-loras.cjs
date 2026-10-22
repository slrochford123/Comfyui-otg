// Fixed official manifest only; uses the owner's existing legitimate HF access.
const fs=require('node:fs'),cp=require('node:child_process');
const root='/home/shawn-rochford/AI/runtime/test/qualification/ltx25-loras';
const rows=JSON.parse(fs.readFileSync('lib/ltxStudiosOfficialRequirements.json','utf8'));
for(const row of rows.filter(x=>x.id!=='alpha-gen')){
 const file=root+'/'+row.file;
 if(fs.existsSync(file)&&fs.statSync(file).size===row.downloadBytes){console.log(JSON.stringify({id:row.id,state:'already-downloaded',bytes:row.downloadBytes}));continue;}
 const result=cp.spawnSync('/home/shawn-rochford/.local/bin/hf',['download',row.repository,row.file,'--local-dir',root],{encoding:'utf8',timeout:1200000,maxBuffer:4*1024*1024,env:{...process.env,HF_DEBUG:'0'}});
 const valid=result.status===0&&fs.existsSync(file)&&fs.statSync(file).size===row.downloadBytes;
 console.log(JSON.stringify({id:row.id,exit:result.status,state:valid?'downloaded':'failed',bytes:valid?fs.statSync(file).size:null,error:valid?null:(/requires approval|Access denied/i.test(result.stderr||'')?'Publisher approval denied':'Download failed; no model alias installed.')}));
 if(!valid)process.exitCode=1;
}
