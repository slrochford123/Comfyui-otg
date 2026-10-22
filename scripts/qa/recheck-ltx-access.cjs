// Read-only provider authorization checks. No downloads or license acceptance.
const fs=require('node:fs'),cp=require('node:child_process');
const requirements=JSON.parse(fs.readFileSync('lib/ltxStudiosOfficialRequirements.json','utf8'));
const results=[];
for(const item of requirements.filter(x=>x.id!=='alpha-gen')){
 const result=cp.spawnSync('/home/shawn-rochford/.local/bin/hf',['download',item.repository,item.file,'--dry-run','--local-dir','/home/shawn-rochford/AI/runtime/test/qualification/ltx25-loras'],{encoding:'utf8',timeout:60000,env:{...process.env,HF_DEBUG:'0'}});
 const denied=/requires approval|Access denied/i.test(result.stderr||'');
 const row={id:item.id,repository:item.repository,file:item.file,exit:result.status,access:result.status===0?'accessible':denied?'gated-denied':'check-error',error:denied?'Access denied. This repository requires approval.':result.status===0?null:'Authorization check failed; inspect provider access.',checkedAt:new Date().toISOString()};
 results.push(row);console.log(JSON.stringify(row));
}
fs.writeFileSync('/home/shawn-rochford/AI/runtime/test/qualification/ltx14-access-recheck.json',JSON.stringify(results,null,2),{mode:0o600});
