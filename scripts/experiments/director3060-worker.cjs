/* Durable TEST Director job. Shared queue, independent model, no cloud calls. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {labRoot}=require('../../lib/experiments/store.ts');
const {directorRoot,director3060Runtime,directorMessages,validateDirectorRevision,directorResponseSchema,nsfwPlanMessages}=require('../../lib/experiments/director3060.ts');
const {nsfwClipMessages}=require('../../lib/experiments/nsfwClipDirection.ts');
const {h3DraftEnhancementInstructions,h3DraftEnhancementInput,h3DraftEnhancementSchema,readH3DraftEnhancement}=require('../../lib/h3DraftEnhancement.ts');
const {compileH3SceneDirection,h3SceneDirectionSchema,validateH3DirectedDialogue}=require('../../lib/openai/h3SceneDirection.ts');
const {acquireExternalMediaGpuChoice,tickMediaGpuQueue,getMediaQueueJob}=require('../../lib/workers/mediaGpuQueue.ts');
const {assertSharedMediaGpuOwned}=require('../../lib/workers/mediaGpuAdmission.ts');
const {readDispatchProcess}=require('../../lib/workers/dispatchProcess.ts');
const {unload3060Ollama,waitFor3060Headroom,LOCAL_COMFY,local3060Headers}=require('../../lib/workers/local3060.ts');
const root=path.resolve(process.argv[2]),qualification=process.argv[3]==='--qualification';
if(!['test','prod'].includes(process.env.OTG_ENV)||path.dirname(root)!==path.join(directorRoot(),'jobs')||fs.lstatSync(root).isSymbolicLink())throw Error('Invalid TEST Director job directory');
const request=JSON.parse(fs.readFileSync(path.join(root,'request.json'))),status=JSON.parse(fs.readFileSync(path.join(root,'status.json')));
if(request.id!==path.basename(root)||!['director-studio','h3-nsfw-prompt','h3-nsfw-director'].includes(request.model)||request.settings.directorModel!=='huihui9b'||request.settings.mode!=='text'||request.sources.length)throw Error('Invalid Director request');
const write=(file,value)=>{const target=path.join(root,file),tmp=target+'.node-writing';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,target);};
const update=patch=>{Object.assign(status,patch,{heartbeat:Date.now()/1000});write('status.json',status);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const abort=new AbortController();let server,reservation,heartbeat,monitor,monitorBusy=false,cleanup=false,peak=0;
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>abort.abort(Error('Director canceled')));
const cancelled=()=>{if(fs.existsSync(path.join(root,'cancel')))abort.abort(Error('Director canceled'));abort.signal.throwIfAborted();};
// Huihui can mistake the selected art style for a speech language. Keep the
// visual prose, and keep legitimate speech and its cut-boundary tags intact.
function repairVisualDialogueMarkup(response, styleLabel) {
  if (!Array.isArray(response?.shots)) return response;
  const matchesStyle = label => Boolean(styleLabel) && label.trim().toLowerCase() === styleLabel.toLowerCase();
  const shots = response.shots.map(shot => {
    if (typeof shot?.direction !== 'string') return shot;
    const prose = shot.direction.replace(/<d>\[([^\]\n]+)\]\s*([\s\S]*?)<\/d>/gi, (whole, label, words) => matchesStyle(label) ? words : whole);
    const direction = prose.split(/(<d>[\s\S]*?<\/d>)/gi).map((part, index) => {
      if (index % 2) return part;
      return part.replace(/<\/?scenetrans>/gi, '').replace(/^\s*\[([^\]\n]+)\]\s*/i, (whole, label) => matchesStyle(label) ? '' : whole);
    }).join('');
    return {...shot,direction};
  });
  return {...response,shots};
}

async function main(){
 const cfg=director3060Runtime(!qualification),promptOnly=request.model==='h3-nsfw-prompt';
 const enhancement=promptOnly&&request.promptOperation?.kind==='enhance'?request.promptOperation:null;
 const clipDirection=promptOnly&&request.promptOperation?.kind==='direct'?request.promptOperation.direction:null;
 const checkAccess=()=>{if(request.standalone&&!require('../../lib/auth/admin.ts').isAdminUserId(request.owner))throw Error('Director administrator access changed');if(request.authorization){const {withNsfwWorkspace}=require('../../lib/experiments/availability.ts');withNsfwWorkspace(()=>{const a=require('../../lib/experiments/nsfwAccess.ts').requireNsfwAccess(request.owner);if(a.version!==request.authorization.version)throw Error('H3 NSFW permission changed');});}};
 checkAccess();
 let messages;
 let format;
 if(enhancement){
   messages=[{role:'system',content:h3DraftEnhancementInstructions(enhancement.level)},{role:'user',content:h3DraftEnhancementInput(enhancement.scene)}];
   format=h3DraftEnhancementSchema(enhancement.scene);
 }else if(clipDirection){
   messages=nsfwClipMessages(clipDirection);
   format=h3SceneDirectionSchema(clipDirection.context.mode);
   format.properties.shots.minItems=clipDirection.shotFlow==='Multiple cinematic shots'?2:1;
   format.properties.shots.maxItems=clipDirection.shotFlow==='One continuous shot'?1:8;
 }else if(promptOnly){
   // Resume jobs written before the typed NSFW prompt actions.
   messages=[{role:'system',content:'You are the Huihui filmmaking Director. Return JSON with a prompt and reply. Improve only the scene prompt as requested. Preserve exact spoken lines, character identities, reference tags, timing, and locked style. Never change the chosen model, GPU, references, LoRAs, or settings. Reference names describe inputs, not visible contents. Return one clip prompt, not a multi-clip plan. Use natural-language MiniMax H3 instructions only. Never emit Midjourney flags, --ar, --stylize, negative-prompt flags, <lora:...>, --lora, seeds, GPU instructions, or LoRA weights in the prompt; the application supplies these separately. For text/image mode use integrated_multimodal_description, overall_soundscape, and non_diegetic_music sections. Reference mode uses subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, and non_diegetic_music. Keep each spoken line exactly once, with its speaker, (S1)/(S2) labels, and <d>[en] exact spoken words</d> markup (preserve the actual spoken language code). Never invent new reference tags or dialogue. Do not include music unless requested.'},{role:'user',content:request.settings.prompt}];
   format={type:'object',additionalProperties:false,properties:{prompt:{type:'string'},reply:{type:'string'}},required:['prompt','reply']};
 }else{
   messages=request.model==='h3-nsfw-director'?nsfwPlanMessages(request.settings.prompt,request.directorContext,request.creative):directorMessages(request.settings.prompt,request.directorContext);
   format=directorResponseSchema(request.settings.prompt,request.directorContext);
 }
 write('messages.json',messages);
 heartbeat=setInterval(()=>{try{cancelled();update({elapsedSeconds:status.started?Math.round(Date.now()/1000-status.started):0});}catch{abort.abort(Error('Director canceled'));}},1000);
 update({state:'queued',stage:'Waiting for shared RTX 3060 · Huihui Director',gpu:'rtx3060'});
 reservation=await acquireExternalMediaGpuChoice(['rtx3060'],'director-plan',86400000,abort.signal);
 write('reservation.json',{gpu:'rtx3060',...reservation.fence});
 cancelled();
 checkAccess();
 await unload3060Ollama(reservation.fence);
 const r=await fetch(LOCAL_COMFY+'/free',{method:'POST',headers:{'content-type':'application/json',...local3060Headers(reservation.fence)},body:JSON.stringify({unload_models:true,free_memory:true}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('RTX 3060 cleanup was not confirmed');
 await waitFor3060Headroom(10000);cancelled();
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const parent=readDispatchProcess();
 write('private-server.json',{port,parent:parent.pid,parentTicks:parent.startTicks,modelsRoot:cfg.modelsRoot,binary:cfg.binary,gpuUuid:cfg.gpuUuid});
 server=spawn('/usr/bin/python3',[path.join(__dirname,'director3060-supervisor.py'),root],{stdio:'inherit'});
 await once(server,'spawn');reservation.bindBackend(server.pid);
 write('supervisor.json',readDispatchProcess(server.pid));
 const base='http://127.0.0.1:'+port,started=Date.now();
 for(;;){cancelled();if(server.exitCode!==null)throw Error('Private Director runtime exited');try{const r=await fetch(base+'/api/version',{signal:AbortSignal.timeout(2000)});if(r.ok)break;}catch{}if(Date.now()-started>30000)throw Error('Private Director startup timed out');await delay(250);}
 const discovery=fs.readFileSync(path.join(root,'private-ollama.log'),'utf8').split('\n').filter(line=>line.includes('msg="inference compute"'));
 if(discovery.length!==1||!discovery[0].includes('library=CUDA')||!discovery[0].includes(cfg.gpuUuid)||!discovery[0].includes('RTX 3060'))throw Error('Private Director GPU discovery did not verify CUDA on the 3060 only');
 write('gpu-discovery.json',{gpuUuid:cfg.gpuUuid,lines:discovery,verifiedBeforeInference:true});
 update({state:'running',started:Date.now()/1000,stage:enhancement?'Huihui is enhancing the draft':'Huihui is planning the scene',checkpointSha256:cfg.manifest.sha256,actual:{engine:'Huihui Qwen3.5 9B Q4_K_M',model:cfg.model,modelDigest:cfg.manifest.sha256,gpu:'rtx3060',gpuUuid:cfg.gpuUuid,context:8192,format:'json'}});
 await assertSharedMediaGpuOwned('rtx3060',reservation.fence.owner,reservation.fence.token);
 monitor=setInterval(async()=>{if(monitorBusy)return;monitorBusy=true;try{
   await assertSharedMediaGpuOwned('rtx3060',reservation.fence.owner,reservation.fence.token);
   const mb=Number(execFileSync('nvidia-smi',['-i',cfg.gpuUuid,'--query-gpu=memory.used','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:3000}).trim());peak=Math.max(peak,mb);
   update({peakGpuMiB:peak});
 }catch(e){abort.abort(e);}finally{monitorBusy=false;}},4000);
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(600000)]),body:JSON.stringify({model:cfg.model,messages,stream:true,think:false,format,keep_alive:'30s',options:{seed:request.settings.seed,temperature:enhancement?.level==='short'?.25:enhancement?.level==='medium'?.35:.6,num_ctx:8192,num_predict:2200}})});
 if(!response.ok)throw Error('Director inference HTTP '+response.status);
 let text='',buffer='',final;
 const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
 try{while(true){cancelled();const next=await reader.read();if(next.done)break;buffer+=next.value;if(buffer.length>100000)throw Error('Oversized Director response');let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n).trim();buffer=buffer.slice(n+1);if(!line)continue;const row=JSON.parse(line);if(row.error)throw Error('Director inference error');text+=row.message?.content||'';if(text.length>30000)throw Error('Director plan too large');if(row.done)final=row;}}}finally{reader.releaseLock();}
 if(buffer.trim()||!final||final.done_reason==='length')throw Error('Incomplete Director response; previous plan preserved');
 const resident=await (await fetch(base+'/api/ps',{signal:AbortSignal.timeout(5000)})).json();
 const model=resident.models?.find(m=>m.name===cfg.model);
 if(!model||model.size<=0||model.size_vram!==model.size||model.context_length!==8192)throw Error('Director did not verify full RTX 3060 residency');
 const executionLog=fs.readFileSync(path.join(root,'private-ollama.log'),'utf8');
 if(!executionLog.includes('description="NVIDIA GeForce RTX 3060"')||/using device Vulkan|library=Vulkan|Vulkan0 model buffer/.test(executionLog))throw Error('Director execution GPU validation failed');
 write('residency.json',resident);cancelled();
 const rawPlan=JSON.parse(text);write('model-response.json',rawPlan);
 checkAccess();
 let plan=rawPlan;
 if(enhancement){
   plan={prompt:readH3DraftEnhancement(enhancement.scene,text)};
 }else if(clipDirection){
   const repaired=repairVisualDialogueMarkup(rawPlan,clipDirection.styleLabel);
   const result=compileH3SceneDirection(JSON.stringify(repaired),clipDirection.context,{shotFlow:clipDirection.shotFlow,styleLabel:clipDirection.styleLabel});
   if (result.shotCount<format.properties.shots.minItems) throw Error('Direct Scene returned fewer shots than the selected shot flow.');
   validateH3DirectedDialogue(clipDirection.input.scene,result.prompt);
   plan={prompt:result.prompt,reply:''};
 }else if(!promptOnly){
   plan=validateDirectorRevision(rawPlan,request.settings.prompt,request.directorContext);
 }
 if(promptOnly&&(typeof plan.prompt!=='string'||!plan.prompt.trim()||plan.prompt.length>8000))throw Error('Director returned an invalid prompt');
 if(promptOnly&&/(?:--(?:ar|stylize|lora|seed)\b|<lora:)/i.test(plan.prompt))throw Error('Director returned unsupported generation flags. Your draft is unchanged; retry the direction.');
 write('result.json',plan);
 status.director=plan;status.outputSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'result.json'))).digest('hex');status.outputBytes=fs.statSync(path.join(root,'result.json')).size;
 status.inferenceMetrics=Object.fromEntries(['load_duration','prompt_eval_count','eval_count','eval_duration','total_duration'].map(k=>[k,final[k]]));
 update({state:'completed',stage:enhancement?'Huihui draft enhancement complete':'Huihui Director plan complete',completed:Date.now()/1000,totalSeconds:(Date.now()-started)/1000,peakGpuMiB:peak});
}
(async()=>{
 try{await main();}catch(e){update({state:abort.signal.aborted?'canceled':'failed',stage:e.message,completed:Date.now()/1000});console.error(e.stack);}
 finally{
  if(monitor)clearInterval(monitor);if(heartbeat)clearInterval(heartbeat);
  try{
   if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),delay(15000)]);if(server.exitCode===null)throw Error('Director supervisor shutdown unconfirmed');}
   if(reservation){await waitFor3060Headroom(0);reservation.release();for(let n=0;n<15;n++){await tickMediaGpuQueue();const job=getMediaQueueJob(reservation.fence.jobId);if(!job?.admissionToken){cleanup=true;break;}await delay(200);}if(!cleanup)throw Error('Director GPU release unconfirmed');}
   update({cleanedUp:true});
  }catch(e){reservation?.uncertain();update({state:'needs_attention',stage:e.message,cleanedUp:false});}
 }
 process.exit(status.cleanedUp&&['completed','canceled'].includes(status.state)?0:1);
})();
