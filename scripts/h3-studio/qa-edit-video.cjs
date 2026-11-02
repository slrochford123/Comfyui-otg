// Controlled benign real inference through the ordinary compiler and shared queue.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||''),quality=process.argv[3];
assert.match(out,/^\/home\/shawn-rochford\/AI\/research\/h3-edit-recovery-\d{8}-\w+$/);assert(['0.2','0.6','1'].includes(quality));
const pid=cp.execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const live=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
assert.equal(live.OTG_ENV,'test');assert(live.OTG_MEDIA_ADMISSION_CONFIG);
for(const [k,v]of Object.entries(live))if(k.startsWith('OTG_'))process.env[k]=v;
const data=fs.mkdtempSync(path.join(out,'gpu-'+quality.replace('.','')+'-'));Object.assign(process.env,{OTG_ENV:'test',NODE_ENV:'production',OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_MEDIA_GPU_QUEUE_DB:path.join(data,'queue.sqlite'),OTG_COMFY_INSTANCE_PROBE_CONFIG:path.join(out,'probe-config.json')});
require('../register-ts-worker.cjs');
const queue=require('../../lib/workers/mediaGpuQueue.ts'),{simpleVideoEditPlan,parseSimpleVideoEdit}=require('../../lib/h3SimpleVideoEdit.ts'),{compileH3StudioPlan}=require('../../lib/h3StudioCompiler.ts'),{inspectH3StudioInventory,readH3StudioEvidence}=require('../../lib/h3StudioRegistry.ts');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),base='http://100.75.162.64:8189';
const report={ok:false,quality,realInference:true,prodCodeChanged:false,workerRestarted:false,paidCalls:0,data};let timer,id;
(async()=>{
 for(const url of [base,'http://100.75.162.64:8188','http://100.98.212.116:8188']){const q=await fetch(url+'/queue').then(r=>r.json());assert.deepEqual(q,{queue_running:[],queue_pending:[]});}
 const source=path.join(data,'source.mp4');cp.execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=352x608:rate=24','-t','7.083334','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',source]);
 const form=new FormData();const name='slr-benign-edit-'+crypto.randomUUID()+'.mp4';form.append('image',new Blob([fs.readFileSync(source)]),name);form.append('type','input');form.append('overwrite','false');
 const upload=await fetch(base+'/upload/image',{method:'POST',body:form});assert(upload.ok,await upload.text());
 const plan=simpleVideoEditPlan(parseSimpleVideoEdit({sourceId:crypto.randomUUID(),requestId:'qa-'+crypto.randomUUID(),prompt:'Transform the colorful moving geometric shapes into a playful hand-painted animation. Preserve the portrait composition and continuous motion. No people, no text.',quality,backend:'rtx3090'}),{width:352,height:608,codec:'h264',durationSeconds:7.0476,hasAudio:false});plan.seed=424242;
 const input={backend:'rtx3090',mode:'h3-reference-to-video',h3Quality:quality==='1'?'hq':quality==='0.6'?'lq':'sh',durationSeconds:10,finalPrompt:plan.prompt,seed:plan.seed,outputPrefix:'slr_h3_edit_safe_qa/'+path.basename(data),videoReferences:[{uploadedFilename:name,includeAudio:false}]};
 const compiled=compileH3StudioPlan(plan,input,await inspectH3StudioInventory(undefined,'rtx3090'),readH3StudioEvidence('rtx3090'),{ownerKey:'slrochford123'});
 assert(compiled.manifest.executable,compiled.manifest.blockedReasons.join(','));assert.equal(compiled.graph['41'].class_type,'H3SLAAttention');assert.equal(compiled.graph['41'].inputs.dense_backend,'pytorch');assert.equal(compiled.manifest.frames,175);fs.writeFileSync(path.join(data,'graph.json'),JSON.stringify(compiled.graph,null,2));report.manifest=compiled.manifest;
 const accepted=await queue.enqueueComfyMedia({baseUrl:base,body:{prompt:compiled.graph,client_id:'h3-safe-qa-'+crypto.randomUUID()},workerId:'h3-safe-edit-qa',releaseIdlePeer:false});id=(await accepted.json()).prompt_id;report.promptId=id;report.startedAt=new Date().toISOString();const started=Date.now();console.log(JSON.stringify({id,data,quality,dimensions:[compiled.manifest.width,compiled.manifest.height]}));
 report.telemetry=[];timer=setInterval(()=>{try{const gpu=cp.execFileSync('nvidia-smi',['--query-gpu=memory.used,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:3000}).trim();report.telemetry.push({at:new Date().toISOString(),gpu});}catch{}},5000);
 for(let n=0;n<1800;n++){
  await queue.tickMediaGpuQueue();const job=queue.getMediaQueueJob(id);if(job.status==='failed')throw Error(job.error);
  const history=await fetch(base+'/history/'+id).then(r=>r.json());const record=history[id];
  if(record){fs.writeFileSync(path.join(data,'history.json'),JSON.stringify(record,null,2));if(record.status?.status_str==='error')throw Error('Real inference failed; see private history');
   const outputs=Object.values(record.outputs||{}).flatMap(v=>Object.values(v).flat()).filter(v=>v&&typeof v==='object'&&/\.mp4$/i.test(v.filename||''));
   if(outputs.length){const file=outputs[0];const r=await fetch(base+'/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output'}));assert(r.ok);const native=path.join(data,'native.mp4');fs.writeFileSync(native,Buffer.from(await r.arrayBuffer()));
    const output=await require('../../lib/h3StudioAudio.ts').finalizeH3StudioAudio(native,plan);const probe=JSON.parse(cp.execFileSync('/usr/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,compiled.manifest.width);assert.equal(video.height,compiled.manifest.height);assert.equal(video.avg_frame_rate,'24/1');assert(Math.abs(Number(video.duration)-7.0476)<.12);
    const frames=cp.execFileSync('/usr/bin/ffmpeg',['-v','error','-i',output,'-map','0:v','-f','framemd5','-'],{encoding:'utf8',timeout:60000}).split('\n').filter(s=>s&&!s.startsWith('#'));assert(frames.length>=169);assert(new Set(frames.map(s=>s.split(',').at(-1).trim())).size>20);
    report.output=output;report.probe=probe;report.uniqueFrames=new Set(frames.map(s=>s.split(',').at(-1).trim())).size;report.seconds=(Date.now()-started)/1000;report.ok=true;await queue.tickMediaGpuQueue();await queue.tickMediaGpuQueue();break;
   }
  }
  if(n%12===0)console.log(JSON.stringify({quality,status:job.status,elapsed:Math.round((Date.now()-started)/1000)}));await sleep(2000);
 }
 assert(report.ok,'Real inference wait exceeded; original job not retried');
})().catch(e=>{report.error=String(e);process.exitCode=1;}).finally(async()=>{if(timer)clearInterval(timer);if(id){await queue.tickMediaGpuQueue().catch(()=>{});await queue.tickMediaGpuQueue().catch(()=>{});report.finalQueue=queue.getMediaQueueJob(id)?.status;}queue.closeMediaGpuQueueForTests();fs.writeFileSync(path.join(data,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,error:report.error,evidence:data}));});
