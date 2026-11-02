// Drain only this runner's terminal experimental jobs, never a managed app DB.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'');
assert(/^\/home\/shawn-rochford\/AI\/research\/release-qualification-[\w-]+\/audio-[\w-]+$/.test(root));
const report=JSON.parse(fs.readFileSync(path.join(root,'results.json'),'utf8'));
assert.equal(report.out,root);assert.equal(report.prodChanged,false);assert.equal(report.managedTestChanged,false);
const pid=cp.execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
assert(env.OTG_MEDIA_ADMISSION_CONFIG);
Object.assign(process.env,{OTG_ENV:'test',OTG_DATA_DIR:path.join(root,'data'),OTG_MEDIA_GPU_ROUTING:'1',OTG_MEDIA_GPU_QUEUE_DB:path.join(root,'data/media-gpu-queue/queue.sqlite'),OTG_MEDIA_ADMISSION_CONFIG:env.OTG_MEDIA_ADMISSION_CONFIG});
const db=new(require('better-sqlite3'))(process.env.OTG_MEDIA_GPU_QUEUE_DB,{readonly:true});
const rows=db.prepare('SELECT * FROM media_jobs').all();db.close();
for(const row of rows){
  assert(['completed','failed','canceled'].includes(row.status));assert.equal(row.kind,'audio');
  const payload=JSON.parse(row.payload),owner=require('node:crypto').createHash('sha256').update(payload.owner).digest('hex');
  const file=path.join(root,'data/audio-editing',owner,payload.sessionId,'jobs',payload.jobId,'request.json');
  const job=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(job.id,row.id);
  if(job.pid){let alive=false;try{alive=fs.readFileSync('/proc/'+job.pid+'/cmdline','utf8').includes(file);}catch{}assert(!alive,'Original experimental worker still active');}
}
(async()=>{
  const queue=require('../../lib/workers/mediaGpuQueue.ts');await queue.tickMediaGpuQueue();
  assert(queue.queuedMediaJobs().length===0);
  for(const row of rows)assert.equal(queue.getMediaQueueJob(row.id).admissionToken,null);
  queue.closeMediaGpuQueueForTests();
  fs.writeFileSync(path.join(root,'reservation-cleanup.json'),JSON.stringify({ok:true,jobIds:rows.map(x=>x.id),at:new Date().toISOString(),managedDataChanged:false}));
  console.log(JSON.stringify({ok:true,terminalExperimentJobs:rows.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
