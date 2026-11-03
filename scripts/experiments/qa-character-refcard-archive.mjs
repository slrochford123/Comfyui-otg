// Recoverably archive only this run's synthetic RefMods, never model weights or user assets.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const evidence=fs.realpathSync(process.argv[2]||'');assert.match(evidence,/^\/home\/shawn-rochford\/AI\/research\/h3-nsfw-access-\d{8}-\w+$/);
const owners=new Set();
function scan(dir,depth=0){if(depth>3)return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory()&&!['data','source','node_modules','.next','worker-refmods'].includes(e.name))scan(file,depth+1);else if(e.name==='results.json'&&e.isFile()){try{const r=JSON.parse(fs.readFileSync(file));if(['character-refcard','character-refcard-real'].includes(r.suite)&&/^(refcard_qa_[a-f0-9]{10}|refcard_http_[a-f0-9]{8})$/.test(r.owner))owners.add(r.owner);}catch{}}}}
scan(evidence);assert(owners.size);
const hashes=new Set([...owners].map(o=>crypto.createHash('sha256').update(o).digest('hex').slice(0,24))),plan=[];
for(const [gpu,base]of [['rtx3090','http://100.75.162.64:8189'],['rtx5060ti','http://100.98.212.116:8188']]){
 const response=await fetch(base+'/refmods/library');assert(response.ok);const entries=await response.json();
 for(const entry of entries){const match=/^characters\/slr-test-cards\/([a-f0-9]{24})\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/.exec(entry.name||'');if(!match||!hashes.has(match[1]))continue;
  const suffix='/'+entry.name+'.safetensors';assert(entry.path.endsWith(suffix));const root=entry.path.slice(0,-suffix.length),source=root+'/characters/slr-test-cards/'+match[1];assert(source.includes('/refmods/characters/slr-test-cards/'));assert(/^[A-Za-z0-9_./-]+$/.test(source)&&!source.split('/').includes('..'));
  if(!plan.some(p=>p.gpu===gpu&&p.source===source))plan.push({gpu,source,ownerHash:match[1]});
 }
}
const remoteRoot='/mnt/otg_bulk/refcard-qa-archive-'+path.basename(evidence).replace('h3-nsfw-access-','');
const report={recoverable:true,owners:[...owners],moves:[],planned:plan,productionReleaseChanged:false};
fs.writeFileSync(path.join(evidence,'qa-refmods-archive-plan.json'),JSON.stringify(report,null,2),{mode:0o600});
if(process.argv.includes('--archive')){
 for(const base of ['http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188']){const q=await(await fetch(base+'/queue')).json();assert.equal(q.queue_running.length,0,'No worker is interrupted for cleanup');assert.equal(q.queue_pending.length,0);}
 for(const item of plan){const destination=item.gpu==='rtx3090'?path.join(evidence,'worker-refmods',item.gpu,item.ownerHash):remoteRoot+'/'+item.ownerHash;
  if(item.gpu==='rtx3090'){assert(!fs.existsSync(destination));fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});const stat=fs.lstatSync(item.source);assert(stat.isDirectory()&&!stat.isSymbolicLink());execFileSync('sudo',['-n','mv','--',item.source,destination]);}
  else{assert(/^[A-Za-z0-9_./-]+$/.test(destination));execFileSync('ssh',['-o','BatchMode=yes','otg-slr',`test -d ${item.source} && test ! -L ${item.source} && test ! -e ${destination} && sudo -n install -d -m 700 -o slrochford123 -g slrochford123 ${remoteRoot} && sudo -n mv -- ${item.source} ${destination}`]);}
  report.moves.push({...item,destination});fs.writeFileSync(path.join(evidence,'qa-refmods-archive.json'),JSON.stringify(report,null,2),{mode:0o600});
 }
}
console.log(JSON.stringify({planned:plan.length,archived:report.moves.length,recoverable:true,manifest:path.join(evidence,report.moves.length?'qa-refmods-archive.json':'qa-refmods-archive-plan.json')}));
