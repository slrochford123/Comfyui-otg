import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import sharp from 'sharp';
import type {Workspace,Candidate,View} from '@/lib/videoCharacters/contract';
const mock=vi.hoisted(()=>({upload:vi.fn(),enqueue:vi.fn(),slots:16,folder:256,preference:'auto',busy:[] as string[],wrong3090:false,held:false,dispatchValid:true,voiceBusy:false,mutexBusy:false,assertDispatch:vi.fn(),voiceReleased:vi.fn(),peer:vi.fn()}));
vi.mock('@/lib/workers/mediaGpuQueue',()=>({acquireExternalMediaGpuChoice:vi.fn(),enqueueMediaJob:mock.enqueue,probeMediaGpu:async(gpu:string)=>({ready:!mock.busy.includes(gpu)}),mediaQueueEnabled:()=>true,assertComfyMediaDispatch:mock.assertDispatch,enqueueComfyMedia:vi.fn(),requireH3QualificationSharedQueue:vi.fn()}));
vi.mock('@/lib/mediaGpuRoutingServer',()=>({requestedMediaGpu:async()=>mock.preference}));
vi.mock('@/lib/production/h3Comfy',()=>({uploadH3InputToBaseUrl:mock.upload}));
vi.mock('@/lib/workers/clusterGpu',()=>({resolveComfyPhysicalGpu:(url:string)=>url.startsWith('http://100.75.162.64:8188')?'shawn-3090':url.startsWith('http://100.98.212.116:8188')?'slr-5060':null}));
vi.mock('@/lib/workers/comfy5060Lease',()=>({isRtx5060Comfy8188Endpoint:(url:string)=>url.startsWith('http://100.98.212.116:8188')}));
vi.mock('@/lib/workers/comfySubmissionCriticalSection',()=>({runWithComfySubmissionCriticalSection:async(_args:unknown,run:()=>Promise<Response>)=>{if(mock.mutexBusy)return {ok:false,status:409,error:'The GPU is reserved.'};mock.held=true;try{return {ok:true,value:await run()};}finally{mock.held=false;}}}));
vi.mock('@/lib/workers/comfy3090Peer',()=>({releaseIdle3090Peer:mock.peer}));
vi.mock('@/lib/workers/voiceGpuFileLease',()=>({acquireVoiceGpuFileLease:async()=>{if(mock.voiceBusy)throw Error('Voice operation owns the 3090');return mock.voiceReleased;}}));
import {submitComfyPromptWithGpuLease} from '@/lib/workers/comfyPromptLease';
import {queueExtractionView,queueExtractionBundle} from '@/lib/videoCharacters/routing';
let directory:string,w:Workspace,c:Candidate;
function schema(){const out:any={};for(const node of ['TextEncodeQwenImage21','QwenImage21Cache','KSampler','SaveImage','MiniMaxH3RefModFolderLoader','MiniMaxH3RefModExtract','MiniMaxH3RefModSave','MiniMaxH3RefModMasterExtract','MiniMaxH3RefModBundleSave','MiniMaxH3RefModInspect','PreviewAny','LoadAudio'])out[node]={};
 for(const [node,field,models] of [['UNETLoader','unet_name',['qwen_image_2.1_int8_convrot.safetensors']],['CLIPLoader','clip_name',['qwen3vl_8b_int8_convrot.safetensors']],['VAELoader','vae_name',['qwen_image_2.1_vae_bf16.safetensors','minimax_h3_video_vae_fp16.safetensors','minimax_h3_audio_vae_fp32.safetensors']],['LoraLoaderModelOnly','lora_name',['qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors']]] as const)out[node]={input:{required:{[field]:[models]}}};
 out.TextEncodeQwenImage21={input:{required:{images:['COMFY_AUTOGROW_V3',{template:{names:Array.from({length:mock.slots},(_,i)=>'image_'+(i+1))}}]}}};out.MiniMaxH3RefModFolderLoader={input:{required:{max_items:['INT',{max:mock.folder}]}}};return out;}
beforeEach(async()=>{vi.clearAllMocks();mock.slots=16;mock.folder=256;mock.preference='auto';mock.busy=[];mock.wrong3090=false;mock.held=false;mock.dispatchValid=true;mock.voiceBusy=false;mock.mutexBusy=false;mock.assertDispatch.mockImplementation(()=>{if(!mock.dispatchValid)throw Error('The GPU dispatch grant is no longer valid.');});vi.stubEnv('OTG_ENV','test');directory=await fs.mkdtemp(path.join(os.tmpdir(),'character-graph-'));for(let i=1;i<=5;i++)await sharp({create:{width:64,height:100,channels:3,background:'#aaa'}}).png().toFile(path.join(directory,i+'.png'));
 c={id:randomUUID(),name:'Child',file:'1.png',frame:'frame',description:'Boy',views:[],voiceId:'old-voice',development:{version:1}} as Candidate;w={id:randomUUID(),owner:'owner',candidates:[c],voices:[{id:'old-voice',file:'voice.wav'}]} as Workspace;
 mock.upload.mockImplementation(async input=>input.uploadName+'.png');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/system_stats')?{devices:[{name:url.includes('100.75.162.64')?(mock.wrong3090?'NVIDIA GeForce RTX 3060':'NVIDIA GeForce RTX 3090'):url.includes('127.0.0.1')?'NVIDIA GeForce RTX 3060':'NVIDIA GeForce RTX 5060 Ti'}]}:url.includes('/object_info/TextEncode')?{TextEncodeQwenImage21:schema().TextEncodeQwenImage21}:url.includes('/object_info/MiniMaxH3RefModFolderLoader')?{MiniMaxH3RefModFolderLoader:schema().MiniMaxH3RefModFolderLoader}:schema())));
});
afterEach(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await fs.rm(directory,{recursive:true,force:true});});
describe('fast qualified extraction routing',()=>{
 async function image(){const v={id:randomUUID(),angle:'face',state:'preparing',prompt:'Preserve identity',seed:42,references:[{file:'1.png',frame:'frame'}]} as View;await queueExtractionView(w,c,v,directory,async()=>{});return mock.enqueue.mock.calls.at(-1)[0];}
 it('prefers the qualified RTX 3090 with the unchanged eight-step Qwen Turbo graph',async()=>{const job=await image();expect(job.gpu).toBe('rtx3090');expect(job.payload.baseUrl).toBe('http://100.75.162.64:8188');const g=job.payload.body.prompt;expect(g['458'].inputs).toMatchObject({steps:8,cfg:1,sampler_name:'euler',scheduler:'simple',denoise:1});expect(g['455'].inputs.strength_model).toBe(1);expect(g['455'].inputs.lora_name).toBe('qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors');expect(mock.upload.mock.calls[0][0].baseUrl).toBe(job.payload.baseUrl);});
 it('uses 5060 Ti when another workload occupies the 3090 in Auto',async()=>{mock.busy=['rtx3090'];expect((await image()).gpu).toBe('rtx5060ti');});
 it('keeps an explicit 3090 selection queued on that GPU while it is busy',async()=>{mock.busy=['rtx3090'];mock.preference='rtx3090';expect((await image()).gpu).toBe('rtx3090');});
 it('honors an explicit 5060 Ti selection',async()=>{mock.preference='rtx5060ti';expect((await image()).gpu).toBe('rtx5060ti');});
 it('keeps the remaining card views on the first view’s GPU instead of spilling its own batch',async()=>{mock.busy=['rtx3090'];c.views=[{id:randomUUID(),job:randomUUID(),gpu:'rtx3090',baseUrl:'http://100.75.162.64:8188',state:'queued',angle:'face'}];expect((await image()).gpu).toBe('rtx3090');});
 it('rejects a wrong physical GPU report and chooses the compatible fallback in Auto',async()=>{mock.wrong3090=true;expect((await image()).gpu).toBe('rtx5060ti');});
 it('does not substitute another GPU for an incompatible explicit selection',async()=>{mock.wrong3090=true;mock.preference='rtx3090';await expect(image()).rejects.toThrow('compatible selected GPU');expect(mock.enqueue).not.toHaveBeenCalled();});
 it('keeps RefMod encodes on their previously qualified lane',async()=>{c.approvedViews=Array.from({length:5},(_,i)=>({id:String(i),file:(i+1)+'.png',label:'view',origin:'reconstructed'}));await queueExtractionBundle(w,c,directory,async()=>{},undefined,true);expect(mock.enqueue.mock.calls[0][0].gpu).toBe('rtx5060ti');await expect(queueExtractionBundle(w,c,directory,async()=>{},'rtx3090',true)).rejects.toThrow('qualified');});
});
describe('actual extraction graph construction',()=>{
 it.each([4,5])('binds all %i Qwen references without dropping sources',async count=>{const v={id:randomUUID(),angle:'Default',state:'preparing',prompt:'Preserve child',seed:42,references:Array.from({length:count},(_,i)=>({file:(i+1)+'.png',frame:'frame'}))} as View;await queueExtractionView(w,c,v,directory,async()=>{});const job=mock.enqueue.mock.calls[0][0],graph=job.payload.body.prompt;expect(mock.upload).toHaveBeenCalledTimes(count);expect(Object.keys(graph['474'].inputs).filter(k=>k.startsWith('images.image_'))).toHaveLength(count);for(let i=1;i<=count;i++){const node=graph['474'].inputs['images.image_'+i][0];expect(graph[node].class_type).toBe('LoadImage');expect(graph[node].inputs.image).toContain('reference-'+i);}expect(graph['458'].inputs.seed).toBe(42);expect(job.payload.workerId).toBe('video-character-qwen21');});
 it('rejects a Qwen worker with insufficient slots before uploading',async()=>{mock.slots=3;await expect(queueExtractionView(w,c,{id:randomUUID(),references:Array.from({length:4},(_,i)=>({file:(i+1)+'.png',frame:'frame'}))} as View,directory,async()=>{})).rejects.toThrow('No image was omitted');expect(mock.upload).not.toHaveBeenCalled();expect(mock.enqueue).not.toHaveBeenCalled();});
 it('encodes five individual visual sources, never sheet or audio',async()=>{c.approvedViews=Array.from({length:5},(_,i)=>({id:String(i),file:(i+1)+'.png',label:'view',origin:'reconstructed'}));await queueExtractionBundle(w,c,directory,async()=>{},undefined,true);const job=mock.enqueue.mock.calls[0][0],graph=job.payload.body.prompt;expect(mock.upload).toHaveBeenCalledTimes(5);expect(graph['2'].inputs.max_items).toBe(5);expect(graph['3'].inputs.budget_policy).toBe('error');expect(graph['3'].inputs.audio).toBeUndefined();expect(Object.values(graph).some((n:any)=>n.class_type==='LoadAudio')).toBe(false);expect(c.bundle?.sourceCount).toBe(5);expect(c.bundle?.visualOnly).toBe(true);});
 it('rejects an encoder that cannot take five views without substitutions',async()=>{mock.folder=4;c.approvedViews=Array.from({length:5},(_,i)=>({id:String(i),file:(i+1)+'.png',label:'view',origin:'reconstructed'}));await expect(queueExtractionBundle(w,c,directory,async()=>{},undefined,true)).rejects.toThrow('No images were omitted');expect(mock.upload).not.toHaveBeenCalled();expect(mock.enqueue).not.toHaveBeenCalled();});
});


describe('prepared extraction request at the actual Comfy submission boundary',()=>{
 async function prepared(gpu:'rtx3090'|'rtx5060ti') {
  mock.preference=gpu;
  const v={id:randomUUID(),angle:'Default front full body',state:'preparing',prompt:'A friendly adult firefighter tiger in a complete uniform, neutral standing pose.',seed:42,references:[{file:'1.png',frame:'frame'}]} as View;
  await queueExtractionView(w,c,v,directory,async()=>{});
  return mock.enqueue.mock.calls.at(-1)![0];
 }
 function harness(job:any,queueBusy=false,freeOK=true){
  const original=JSON.stringify(job.payload.body),transport=vi.fn(async(url:string)=>{
   expect(mock.held).toBe(true);
   if(url.endsWith('/queue'))return Response.json({queue_running:queueBusy?[[0,'other-job']]:[],queue_pending:[]});
   if(url.endsWith('/free'))return new Response('{}',{status:freeOK?200:503});
   if(url.endsWith('/prompt'))return Response.json({prompt_id:job.id});
   throw Error('Unexpected transport '+url);
  });
  const beforeSubmit=vi.fn(async()=>{expect(mock.held).toBe(true);expect(JSON.stringify(job.payload.body)).toBe(original);});
  const submit=(extra:Record<string,unknown>={})=>submitComfyPromptWithGpuLease({baseUrl:job.payload.baseUrl,workerId:job.payload.workerId,ownerId:job.id,queueDispatch:true,preSubmitCleanup:job.payload.preSubmitCleanup,mediaQueueProducer:job.payload.producer,init:{method:'POST',body:JSON.stringify(job.payload.body)},fetcher:transport,beforeSubmit,...extra});
  return {transport,beforeSubmit,submit};
 }
 it('submits the exact 3090 Qwen graph once without the 5060-only cleanup request',async()=>{const job=await prepared('rtx3090'),h=harness(job);const result=await h.submit();expect(result.status).toBe(200);expect(await result.json()).toEqual({prompt_id:job.id});expect(h.transport.mock.calls.map(([url])=>url)).toEqual([job.payload.baseUrl+'/prompt']);expect(mock.assertDispatch).toHaveBeenCalledTimes(2);expect(h.beforeSubmit).toHaveBeenCalledTimes(1);expect(mock.voiceReleased).toHaveBeenCalledTimes(1);expect(mock.peer).not.toHaveBeenCalled();expect(job.payload.preSubmitCleanup).toBeNull();});
 it('preserves the qualified 5060 queue-check, cleanup and single-submit order',async()=>{const job=await prepared('rtx5060ti'),h=harness(job);expect((await h.submit()).status).toBe(200);expect(h.transport.mock.calls.map(([url])=>url)).toEqual(['/queue','/free','/prompt'].map(p=>job.payload.baseUrl+p));expect(job.payload.preSubmitCleanup).toBe('free');expect(h.beforeSubmit).toHaveBeenCalledTimes(1);});
 it('leaves the shared guard rejecting an accidental 3090 cleanup flag',async()=>{const job=await prepared('rtx3090'),h=harness(job);const result=await h.submit({preSubmitCleanup:'free'});expect(result.status).toBe(503);expect((await result.json()).error).toContain('qualified only');expect(h.transport).not.toHaveBeenCalled();});
 it.each(['rtx3090','rtx5060ti'] as const)('rejects a stale %s grant before cleanup or submission',async gpu=>{const job=await prepared(gpu),h=harness(job);mock.dispatchValid=false;await expect(h.submit()).rejects.toThrow('grant');expect(h.transport).not.toHaveBeenCalled();});
 it('does not interrupt an active 3090 voice job',async()=>{const h=harness(await prepared('rtx3090'));mock.voiceBusy=true;expect((await h.submit()).status).toBe(409);expect(h.transport).not.toHaveBeenCalled();});
 it('does not bypass an occupied physical GPU mutex',async()=>{const h=harness(await prepared('rtx3090'));mock.mutexBusy=true;expect((await h.submit()).status).toBe(409);expect(h.transport).not.toHaveBeenCalled();});
 it('does not clear or submit to a 5060 worker that becomes busy',async()=>{const job=await prepared('rtx5060ti'),h=harness(job,true);expect((await h.submit()).status).toBe(409);expect(h.transport.mock.calls.map(([url])=>url)).toEqual([job.payload.baseUrl+'/queue']);expect(h.beforeSubmit).not.toHaveBeenCalled();});
 it('does not submit after a failed 5060 cleanup',async()=>{const job=await prepared('rtx5060ti'),h=harness(job,false,false);expect((await h.submit()).status).toBe(503);expect(h.transport.mock.calls.map(([url])=>url)).toEqual([job.payload.baseUrl+'/queue',job.payload.baseUrl+'/free']);expect(h.beforeSubmit).not.toHaveBeenCalled();});
});
