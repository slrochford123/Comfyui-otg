import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn, execFileSync, type ChildProcess} from "node:child_process";
import {acquireExternalMediaGpuChoice} from "@/lib/workers/mediaGpuQueue";
import {acquireVoiceGpuFileLease} from "@/lib/workers/voiceGpuFileLease";
import {requestedMediaGpu} from "@/lib/mediaGpuRoutingServer";
import {MEDIA_GPUS, type MediaGpu, type MediaGpuChoice} from "@/lib/mediaGpuRouting";
import {prepareAudioGpuMemory} from "@/lib/audioEditing/gpuMemory";
import {getStoryMedia, updateStoryMedia, type StoryMediaRecord} from "./mediaStore";
import {storyMediaRoot} from "./mediaExecution";

type Run = {canceled:boolean; waiting?:AbortController; child?:ChildProcess; done?:Promise<void>; remoteRoot?:string};
const shared=globalThis as typeof globalThis & {__storyMediaVoices?:Map<string,Run>};
const active = shared.__storyMediaVoices ||= new Map<string,Run>();
function canceled(){const error=Error("Speech canceled.");error.name="AbortError";return error;}
export function storyVoiceActive(id:string) { return active.has(id); }
export async function cancelStoryVoice(id:string) {
  const run=active.get(id);
  if(!run)throw Error("The original speech process is not attached. No new job was submitted.");
  run.canceled=true;
  run.waiting?.abort(canceled());
  if(run.remoteRoot) {
    fs.writeFileSync(path.join(run.remoteRoot,"cancel"),"",{mode:0o600});
    // The restricted client waits for the exact remote worker to exit.
    await run.done?.catch(()=>{});return;
  }
  if(run.child?.pid) {
    try { process.kill(-run.child.pid,"SIGTERM"); } catch { /* process may have just exited */ }
    const timer=setTimeout(()=>{try{process.kill(-run.child!.pid!,"SIGKILL");}catch{}},5000);
    try { await run.done?.catch(()=>{}); } finally { clearTimeout(timer); }
  }
}
export function storyVoiceRuntime(clone=false, gpu:MediaGpu="rtx3090") {
  // This TEST-only sidecar is separate from the installed PROD voice worker.
  const remoteConfig=gpu==="rtx5060ti" ? process.env.OTG_STORY_QWEN_5060_CONFIG : process.env.OTG_STORY_QWEN_REMOTE_CONFIG;
  if(gpu==="rtx5060ti" && !remoteConfig)throw Error("Qwen3-TTS is not yet qualified on the RTX 5060 Ti. Select Automatic or RTX 3090.");
  if(remoteConfig) {
    const cfg=JSON.parse(fs.readFileSync(remoteConfig,"utf8")),target=cfg.transports?.[gpu];
    const host=gpu==="rtx3090"?"shawn-rochford@100.75.162.64":"slrochford123@100.98.212.116";
    if(target?.protocol!=="slr-audio-v1"||!target.qualified||target.host!==host)throw Error("The Story speech connection is not qualified.");
    if(gpu==="rtx5060ti" && (cfg.engine!=="qwen3"||!cfg.verified?.[clone?"speech-base":"speech"]?.[gpu]))throw Error("This Qwen3 voice operation is not qualified on the RTX 5060 Ti.");
    return {python:"/usr/bin/python3",model:"",remoteConfig};
  }
  const root=process.env.OTG_RUNTIME_ROOT || path.join(os.homedir(),"AI/runtime/test");
  const python=process.env.OTG_STORY_QWEN_PYTHON || path.join(root,"qwen3-tts-venv/bin/python");
  const model=clone ? (process.env.OTG_STORY_QWEN_BASE || path.join(root,"models/qwen3-tts/Qwen3-TTS-12Hz-1.7B-Base"))
    : (process.env.OTG_STORY_QWEN_DESIGN || path.join(root,"models/qwen3-tts/Qwen3-TTS-12Hz-1.7B-VoiceDesign"));
  if(!fs.existsSync(python))throw Error("Qwen3-TTS runtime is unavailable. No substitute voice engine was used.");
  if(path.isAbsolute(model) && !["config.json","model.safetensors","speech_tokenizer/model.safetensors"].every(file=>fs.existsSync(path.join(model,file)))) {
    throw Error(`Qwen3-TTS ${clone?"saved voice":"voice creation"} model is unavailable. No GPU job was started.`);
  }
  return {python,model,remoteConfig:undefined};
}
/** Dedicated one-job process, protected by the same cross-app GPU admission as renders. */
export async function generateStoryVoice(record:StoryMediaRecord, source:{voice?:string;refText?:string}, context?:{gpuChoice:MediaGpuChoice}) {
  const run:Run={canceled:false};
  active.set(record.id,run);
  let release:(()=>void)|undefined,releaseVoice:(()=>void)|undefined,markUncertain:(()=>void)|undefined;
  let unconfirmed=false;
  const check=async()=>{
    if(run.canceled || getStoryMedia(record.ownerKey,record.projectId,record.id).status!=="running") throw canceled();
  };
  try {
    // Durable callers carry the request-time preference, never request cookies.
    // Keep the request-scoped path for existing Story Creator callers.
    const gpuChoice=context ? context.gpuChoice : await requestedMediaGpu();
    const runtimes=new Map<MediaGpu,ReturnType<typeof storyVoiceRuntime>>();
    for(const gpu of MEDIA_GPUS.filter(g=>gpuChoice==="auto"||gpuChoice===g)) {
      try {runtimes.set(gpu,storyVoiceRuntime(!!source.voice,gpu));}
      catch(error) {if(gpuChoice!=="auto")throw error;}
    }
    if(!runtimes.size)throw Error("No qualified Qwen3-TTS runtime is available. No substitute voice engine was used.");
    await check();
    run.waiting=new AbortController();
    const waiting=getStoryMedia(record.ownerKey,record.projectId,record.id);
    updateStoryMedia(waiting,{stage:gpuChoice==="auto"?"Waiting for a qualified speech GPU":`Waiting for ${gpuChoice==="rtx3090"?"RTX 3090":"RTX 5060 Ti"}`});
    const reservation=await acquireExternalMediaGpuChoice([...runtimes.keys()],"story-qwen3-tts",600_000,run.waiting.signal);
    run.waiting=undefined;
    const gpu=reservation.gpu,config=runtimes.get(gpu)!;
    release=reservation.release;markUncertain=reservation.uncertain;
    await check();
    updateStoryMedia(getStoryMedia(record.ownerKey,record.projectId,record.id),{backendJob:{engine:"qwen3",gpu,pid:process.pid},stage:`Generating voice on ${gpu==="rtx3090"?"RTX 3090":"RTX 5060 Ti"}`});
    if(!config.remoteConfig)releaseVoice=await acquireVoiceGpuFileLease();
    await prepareAudioGpuMemory(gpu,6500,check);
    await check();
    // UUID selection remains stable if another card is installed later.
    let uuid="";
    if(!config.remoteConfig) {
      const devices=execFileSync("nvidia-smi",["--query-gpu=uuid,name","--format=csv,noheader"],{encoding:"utf8",timeout:5000});
      uuid=devices.split("\n").find(line=>/RTX 3090(?:,|\s|$)/i.test(line))?.split(",")[0].trim()||"";
      if(!uuid)throw Error("The qualified RTX 3090 speech GPU is unavailable.");
    }
    const root=storyMediaRoot(record);fs.mkdirSync(root,{recursive:true,mode:0o700});
    const output=path.join(root,"result.wav"), log=fs.openSync(path.join(root,"qwen.log"),"a",0o600);
    let args=[path.join(process.cwd(),"scripts/story-creator/qwen_media.py")];
    if(config.remoteConfig) {
      run.remoteRoot=root;
      let reference:string|null=null;
      if(source.voice) {
        const suffix=path.extname(source.voice).toLowerCase();
        if(![".wav",".mp3",".flac",".ogg",".m4a",".aac",".webm"].includes(suffix)||fs.statSync(source.voice).size>50*1024*1024)throw Error("The saved voice reference needs a supported audio file smaller than 50 MiB.");
        reference=path.join(root,"reference"+suffix);fs.copyFileSync(source.voice,reference);
      }
      const request=path.join(root,"request.json");
      fs.writeFileSync(request,JSON.stringify({id:record.id,gpu,operation:"speech",source:reference,params:{text:record.command.text,instruction:record.command.prompt,description:source.refText||"",seconds:5,variant:reference?"base":"flash"}}),{mode:0o600});
      args=[path.join(process.cwd(),"scripts/audio-editing-restricted-remote.py"),request];
    }
    const child=spawn(config.python,args,{
      detached:true,stdio:["pipe",log,log],env:{...process.env,...(config.remoteConfig?{OTG_AUDIO_ENGINE_CONFIG:config.remoteConfig}:{CUDA_VISIBLE_DEVICES:uuid}),HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",TOKENIZERS_PARALLELISM:"false"},
    });
    fs.closeSync(log);run.child=child;
    run.done=new Promise<void>((resolve,reject)=>{
      child.once("error",()=>reject(Error("Qwen3-TTS could not start.")));
      child.once("close",code=>{
        let pending=false;
        if(config.remoteConfig&&fs.existsSync(path.join(root,"remote-execution.json"))) {
          try {pending=JSON.parse(fs.readFileSync(path.join(root,"remote-execution.json"),"utf8")).outcome==="pending";} catch {pending=true;}
        }
        if(config.remoteConfig&&(code===2||pending)) {
          unconfirmed=true;markUncertain?.();const error=Error("Speech execution is unconfirmed. Its GPU reservation is retained; no duplicate was submitted.");error.name="UnconfirmedStoryVoice";reject(error);
        } else if(code===0)resolve();
        else reject(run.canceled?canceled():Error("Qwen3-TTS failed. The private job log contains diagnostic details; no fallback engine was used."));
      });
    });
    // Listen immediately so cancellation cannot produce an unhandled rejection.
    const done=run.done;
    child.stdin!.on("error",()=>{});
    child.stdin!.end(config.remoteConfig?undefined:JSON.stringify({parent_pid:process.pid,model:config.model,output,text:record.command.text,language:record.command.language,instruction:record.command.prompt,reference:source.voice||"",reference_text:source.refText||""}));
    const timeout=setTimeout(()=>{void cancelStoryVoice(record.id).catch(()=>{});},15*60_000);
    try { await done; } finally { clearTimeout(timeout); }
    await check();
    if(config.remoteConfig) {
      const result=JSON.parse(fs.readFileSync(path.join(root,"result.json"),"utf8")),file=result.assets?.[0]?.file;
      if(!file||fs.realpathSync(file)!==path.join(fs.realpathSync(root),"remote-output","0.wav"))throw Error("The speech worker returned an invalid audio receipt.");
      fs.copyFileSync(file,output);
    }
    return output;
  } finally { releaseVoice?.();if(!unconfirmed)release?.();active.delete(record.id); }
}
