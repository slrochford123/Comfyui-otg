// Metadata/admission proof only. No generation, cache clearing or interruption.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const evidence=path.resolve(process.argv[2]||'');assert.match(evidence,/^\/home\/shawn-rochford\/AI\/research\/h3-nsfw-access-\d{8}-\w+$/);
const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
for(const line of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){const i=line.indexOf('=');if(/^(OTG_MEDIA_|OTG_WORKER_CONTROL_STORE_DIR$)/.test(line.slice(0,i)))process.env[line.slice(0,i)]=line.slice(i+1);}
assert(process.env.OTG_MEDIA_ADMISSION_CONFIG);Object.assign(process.env,{AUTH_SECRET:crypto.randomBytes(48).toString('hex'),OTG_ENV:'test',NODE_ENV:'production',OTG_MEDIA_GPU_ROUTING:'1',OTG_MEDIA_GPU_QUEUE_DB:'/home/shawn-rochford/AI/runtime/test/data/media-gpu-queue/queue.sqlite'});
const queue=require('../../lib/workers/mediaGpuQueue.ts'),admission=require('../../lib/workers/mediaGpuAdmission.ts'),native=require('../../lib/images/nativeImageBackend.ts');
const owner=crypto.randomUUID();let grant;const report={ok:false,realInference:false,paidCalls:0,gpuCacheChanged:false,jobsInterrupted:false,checks:[]};
(async()=>{
 for(const gpu of ['rtx3090','rtx5060ti'])assert((await queue.probeMediaGpu(gpu)).ready,'Both GPUs must be idle for the short routing proof');
 assert.equal((await native.chooseNativeImageBackend('fibo2-edit-turbo','auto')).label,'rtx3090');report.checks.push('Automatic selects the idle 3090 first');
 grant=await admission.acquireSharedMediaGpu('rtx3090',owner);assert(grant.granted&&grant.token);
 try{
  assert.equal((await native.chooseNativeImageBackend('fibo2-edit-turbo','auto')).label,'rtx5060ti');report.checks.push('Automatic selects the 5060 Ti while the 3090 is reserved');
  assert.equal((await native.chooseNativeImageBackend('fibo2-edit-turbo','rtx3090')).label,'rtx3090');report.checks.push('Manual 3090 remains pinned and must queue, rather than silently switching');
 }finally{await admission.releaseSharedMediaGpu('rtx3090',owner,grant.token);grant=null;}
 assert.equal((await native.chooseNativeImageBackend('fibo2-edit-turbo','rtx5060ti')).label,'rtx5060ti');report.checks.push('Manual 5060 Ti remains pinned');report.ok=true;
})().catch(error=>{report.error=String(error);process.exitCode=1;}).finally(async()=>{
 if(grant?.token)await admission.releaseSharedMediaGpu('rtx3090',owner,grant.token);
 fs.writeFileSync(path.join(evidence,'refcard-routing.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));queue.closeMediaGpuQueueForTests();
});
