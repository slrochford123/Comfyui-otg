// Real local inference through the existing fenced TEST GPU queue. No paid APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const evidence=path.resolve(process.argv[2]||'');
assert.match(evidence,/^\/home\/shawn-rochford\/AI\/research\/h3-nsfw-access-\d{8}-\w+$/);
const out=fs.mkdtempSync(path.join(evidence,'real-refcard-')),data=path.join(out,'data');fs.mkdirSync(data,{mode:0o700});
// Import only routing/admission configuration; never copy an API key or cookie.
const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
for(const line of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){const i=line.indexOf('=');if(/^(OTG_MEDIA_|OTG_WORKER_CONTROL_STORE_DIR$)/.test(line.slice(0,i)))process.env[line.slice(0,i)]=line.slice(i+1);}
assert(process.env.OTG_MEDIA_ADMISSION_CONFIG,'Real GPU tests require the installed shared authority');
Object.assign(process.env,{NODE_ENV:'production',OTG_ENV:'test',OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_MEDIA_GPU_ROUTING:'1',OTG_MEDIA_GPU_QUEUE_DB:'/home/shawn-rochford/AI/runtime/test/data/media-gpu-queue/queue.sqlite',OPENAI_ENABLED:'0',OPENAI_KILL_SWITCH:'1'});
process.env.AUTH_SECRET=crypto.randomBytes(48).toString('hex');
// The app's progress collector uses import.meta for createRequire. Keep that
// module's filename when running its TS through this isolated CJS QA harness.
const originalTsLoader=require.extensions['.ts'];
require.extensions['.ts']=(module,filename)=>{
 const source=fs.readFileSync(filename,'utf8');if(!source.includes('import.meta.url'))return originalTsLoader(module,filename);
 const ts=require('typescript');module._compile(ts.transpileModule(source.replaceAll('import.meta.url',JSON.stringify(require('node:url').pathToFileURL(filename).href)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
};
const sharp=require('sharp'),cards=require('../../lib/h3SpecialModes/characterRefCard.ts'),queue=require('../../lib/workers/mediaGpuQueue.ts');
const owner='refcard_qa_'+crypto.randomBytes(5).toString('hex'),report={ok:false,suite:'character-refcard-real',realInference:true,paidCalls:0,prodDeploymentChanged:false,owner,out,gpus:{},errors:[]};
const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2),{mode:0o600});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function action(c,action,extra={}){return cards.editCharacterRefCard(owner,c.id,{action,revision:c.revision,...extra});}
async function waitFor(id,state,max=40*60*1000){
 const started=Date.now();let old='';
 while(Date.now()-started<max){const c=await cards.advanceCharacterRefCard(owner,id);const status=c.state+':'+c.views.map(v=>v.state).join(',');if(status!==old){console.log(JSON.stringify({id,state:c.state,views:c.views.map(v=>({label:v.label,state:v.state,gpu:v.gpu})),message:c.message,error:c.error}));old=status;}
 if(c.state==='attention')throw Error(c.error);if(c.state===state)return c;await pause(4000);}
 throw Error('Timed out waiting for original card; no duplicate work was submitted.');
}
(async()=>{
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#dedde8"/><ellipse cx="384" cy="947" rx="190" ry="25" fill="#bebbc9"/><g stroke="#3c334e" stroke-width="7"><ellipse cx="320" cy="205" rx="43" ry="155" fill="#f49ebc" transform="rotate(-12 320 205)"/><ellipse cx="454" cy="205" rx="43" ry="155" fill="#fffafa" transform="rotate(12 454 205)"/><ellipse cx="384" cy="742" rx="145" ry="185" fill="#f8f4fb"/><ellipse cx="264" cy="925" rx="66" ry="28" fill="#f8f4fb"/><ellipse cx="505" cy="925" rx="66" ry="28" fill="#f8f4fb"/><ellipse cx="226" cy="732" rx="35" ry="90" fill="#f8f4fb"/><ellipse cx="543" cy="732" rx="35" ry="90" fill="#f8f4fb"/><circle cx="384" cy="457" r="150" fill="#f8f4fb"/><path d="M270 600 L498 600 L470 795 L300 795 Z" fill="#8050c5"/><path d="M335 605 L384 652 L435 605" fill="none"/><circle cx="384" cy="739" r="22" fill="#ebc349"/></g><ellipse cx="326" cy="438" rx="17" ry="25" fill="#273041"/><ellipse cx="440" cy="438" rx="17" ry="25" fill="#273041"/><path d="M365 485 Q384 468 403 485 L384 502 Z" fill="#e892b4"/><path d="M384 502 L384 525 M384 525 Q357 543 343 518 M384 525 Q411 543 425 518" fill="none" stroke="#3c334e" stroke-width="5"/></svg>`;
 const source=await sharp(Buffer.from(svg)).png().toBuffer();fs.writeFileSync(path.join(out,'original-bunny.png'),source,{mode:0o600});
 for(const gpu of ['rtx3090','rtx5060ti']){
  const started=Date.now();let c=await cards.createCharacterRefCard(owner,crypto.randomUUID());c=await action(c,'settings',{name:'Reference Bunny '+gpu,description:'Friendly illustrated rabbit wearing a purple vest with one gold button. The ear on the viewer left is pink; the ear on the viewer right is white. Preserve the same face, clothing and soft illustrative style.',characterId:'',mode:'single',gpu});
  c=await cards.uploadCharacterRefAsset(owner,c.id,crypto.randomUUID(),source,'original-bunny.png','original');c=await action(c,'generate');report.gpus[gpu]={cardId:c.id,startedAt:new Date().toISOString()};save();
  c=await waitFor(c.id,'review');report.gpus[gpu].views=c.views.map(v=>({id:v.id,path:v.file,seed:v.seed,gpu:v.gpu,jobId:v.nativeId}));save();
  c=await action(c,'encode');c=await waitFor(c.id,'completed',15*60*1000);report.gpus[gpu]={...report.gpus[gpu],libraryName:c.libraryName,characterId:c.characterId,previewPath:c.previewPath,tokens:c.tokenCount,seconds:(Date.now()-started)/1000,encodeId:c.encode.id};save();
  // Reopen from persisted state, not from the in-memory result.
  assert.equal((await cards.readCharacterRefCard(owner,c.id)).libraryName,c.libraryName);
  console.log(JSON.stringify({gpu,completed:true,cardId:c.id,preview:c.previewPath,seconds:report.gpus[gpu].seconds}));
 }
 report.ok=true;save();
})().catch(error=>{report.errors.push(String(error.stack||error));save();console.error(String(error));process.exitCode=1;}).finally(async()=>{
 // Do not abandon a queue reservation if an HTTP result was temporarily lost.
 for(let i=0;i<600;i++){const pending=Object.values(report.gpus).flatMap(g=>[...(g.views||[]).map(v=>v.jobId),g.encodeId].filter(Boolean)).map(id=>queue.getMediaQueueJob(id)).filter(j=>j&&['queued','dispatching','running','unknown'].includes(j.status));if(!pending.length)break;await pause(1000);}
 cards.closeCharacterRefCardsForTests();console.log(JSON.stringify({results:path.join(out,'results.json'),ok:report.ok}));process.exit(process.exitCode||0);
});
