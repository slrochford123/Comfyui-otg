import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { callStoryCpu } from "@/lib/storyCreator/cpuClient";
import { storySpeechCapabilities } from "@/lib/storyCreator/speech";
import { validStoryVoice, STORY_VOICES } from "@/lib/storyCreator/speechVoices";
import { normalizeStorySpeechText } from "@/lib/storyCreator/speechText";
import type { StudioStore } from "./store";
import { StudioError } from "./store";
import { previewFromPlan } from "./storyPreview";
import {shotNarration} from "./shotPreparation";
export const NARRATOR_MODEL = "Paradee 1.2";
const revision = "ed2934d4df8a4fd891e29584c5e1104649409765";
type Voice = typeof STORY_VOICES.paradee[number]["id"];
type Narration = {key:string;jobId:string;pid:number;status:"queued"|"running"|"completed"|"failed"|"canceled"|"attention";error?:string;duration?:number;engine:"paradee";voice:Voice;text:string};
type Target = {segmentId?:string;proposalId?:string;messageId?:string;shotId?:string;expectedText?:string;voice?:string;retry?:boolean};
function directory(s:StudioStore,owner:string,project:string){s.get(owner,project);return path.join(s.root,"narration",createHash("sha256").update(owner).digest("hex"),project);}
function filename(s:StudioStore,owner:string,project:string,key:string,ext:string){if(!/^[a-f0-9]{64}$/.test(key))throw new StudioError("Narration not found.",404);return path.join(directory(s,owner,project),key+ext);}
function save(s:StudioStore,owner:string,project:string,job:Narration){const file=filename(s,owner,project,job.key,".json"),temp=file+"."+randomUUID()+".tmp";fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(temp,JSON.stringify(job),{mode:0o600});fs.renameSync(temp,file);}
export function getNarration(s:StudioStore,owner:string,project:string,key:string){
  const file=filename(s,owner,project,key,".json");let job:Narration;try{job=JSON.parse(fs.readFileSync(file,"utf8"));}catch{throw new StudioError("Narration not found.",404);}
  if(["running","queued"].includes(job.status)&&job.pid!==process.pid){job.status="attention";job.error="Narration was interrupted by a restart. Retry after the shared CPU service becomes idle.";save(s,owner,project,job);}
  return job;
}
export function narrationAudio(s:StudioStore,owner:string,project:string,key:string){const job=getNarration(s,owner,project,key);if(job.status!=="completed")throw new StudioError("Narration is not ready.",409);const file=filename(s,owner,project,key,".wav");if(!fs.existsSync(file))throw new StudioError("The cached audio is unavailable. Tap the speaker again to rebuild it.",404);return file;}
export function prepareNarration(s:StudioStore,owner:string,project:string,target:Target|string,proposalId?:string){
  const input:Target=typeof target==="string"?{segmentId:target,proposalId}:target;
  const p=s.get(owner,project),voice=input.voice||p.narratorVoice||"af_heart";
  if(!validStoryVoice("paradee",voice))throw new StudioError("Choose one of Story Creator's four narrator voices.");
  let raw:string;
  if(input.shotId){raw=shotNarration(p,input.shotId);}
  else if(input.messageId){
    const message=p.assistant.find(m=>m.id===input.messageId&&m.role==="assistant");
    if(!message)throw new StudioError("This filmmaker reply is no longer available.",404);
    raw=message.text;
  }else{
    const story=input.proposalId?p.assistant.find(m=>m.id===input.proposalId&&m.storySuggestion)?.storySuggestion:previewFromPlan(p.plan),segment=story?.segments.find(v=>v.id===input.segmentId);
    if(!segment)throw new StudioError("The selected story scene is no longer available. Refresh the preview.",409);
    raw=`${segment.title}. ${segment.narrative}`;
  }
  if(input.expectedText!==undefined&&raw!==input.expectedText)throw new StudioError("The displayed story or reply changed. Refresh it before listening.",409);
  const text=normalizeStorySpeechText(raw),capabilities=storySpeechCapabilities();
  if(!capabilities.engines.paradee)throw new StudioError("Story Creator's Paradee CPU narrator is unavailable. Retry when its service is restored; no other engine or paid fallback was used.",503);
  if(!text||text.length>capabilities.maxChars)throw new StudioError("This passage is too long or empty for narration. Shorten it and try again.");
  const key=createHash("sha256").update(JSON.stringify([text,"paradee",voice,revision,"production-narration-v2"])).digest("hex");
  try{const old=getNarration(s,owner,project,key);if(!["failed","canceled"].includes(old.status)&&!(old.status==="attention"&&input.retry)&&!(old.status==="completed"&&!fs.existsSync(filename(s,owner,project,key,".wav"))))return{job:old,created:false};}catch(e){if((e as StudioError).status!==404)throw e;}
  const job:Narration={key,jobId:randomUUID(),pid:process.pid,status:"queued",engine:"paradee",voice:voice as Voice,text};save(s,owner,project,job);return{job,created:true};
}
export async function cancelNarration(s:StudioStore,owner:string,project:string,key:string){const job=getNarration(s,owner,project,key);if(job.status==="completed")return job;job.status="canceled";save(s,owner,project,job);await callStoryCpu("/cancel",{jobId:job.jobId},3000).catch(()=>{});return job;}
// Same installed Unix-socket service as Story Creator, never a new model process.
// Its process-wide BUSY lock prevents concurrent inference across both clients.
let queue:Promise<unknown>=Promise.resolve();
export function enqueueNarration(s:StudioStore,owner:string,project:string,key:string){
  const requested=getNarration(s,owner,project,key);
  const run=async()=>{
    let job=getNarration(s,owner,project,key);if(job.status!=="queued"||job.jobId!==requested.jobId)return;
    const current=()=>{const j=getNarration(s,owner,project,key);return j.jobId===requested.jobId&&j.status!=="canceled";};
    try{
      const deadline=Date.now()+120000;let result:{audio:string;durationSeconds:number}|undefined;
      while(current()){
        if(Date.now()>deadline)throw new Error("CPU service busy");
        const health=await callStoryCpu<{busy:boolean}>("/health");
        if(health.busy){await new Promise(r=>setTimeout(r,500));continue;}
        if(!current())return;job.status="running";save(s,owner,project,job);
        try{result=await callStoryCpu<{audio:string;durationSeconds:number}>("/tts",{jobId:job.jobId,text:job.text,engine:"paradee",voice:job.voice},600000);break;}
        catch(e){if(/worker is busy/i.test(String((e as Error).message))){await new Promise(r=>setTimeout(r,500));continue;}throw e;}
      }
      if(!current()||!result)return;const bytes=Buffer.from(result.audio,"base64");if(bytes.length<44||bytes.toString("ascii",0,4)!=="RIFF"||bytes.toString("ascii",8,12)!=="WAVE"||!(result.durationSeconds>0))throw new Error("Invalid audio");
      const file=filename(s,owner,project,key,".wav");fs.writeFileSync(file+".partial",bytes,{mode:0o600});fs.renameSync(file+".partial",file);job.status="completed";job.duration=result.durationSeconds;save(s,owner,project,job);
    }catch{if(current()){job=getNarration(s,owner,project,key);job.status="failed";job.error="Paradee CPU narration could not finish. Tap the speaker to retry. Your story and character voices are unchanged; no paid fallback was used.";save(s,owner,project,job);}}
  };const result=queue.then(run,run);queue=result.catch(()=>{});return result;
}
