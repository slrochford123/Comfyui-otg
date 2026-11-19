import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {RequestError} from '@/lib/requestError';
import {atomicJson,createSession,readSession,assetFile} from '@/lib/audioEditing/store';
import {startJob,reconcileJob,sessionJobs} from '@/lib/audioEditing/jobs';
import {characterVoiceEngines} from '@/lib/h3SpecialModes/characterVoiceAudition';
import {createElevenLabsDesignPreview,getElevenLabsStatus,getElevenLabsModel,getElevenLabsOutputFormat,saveElevenLabsDesignedVoice} from '@/lib/elevenlabsVoiceDesign';
import {loadCharacter,updateCharacterVoiceSelection} from '@/lib/characters/store';
import {attachSavedCharacterVoice} from '@/lib/characters/savedVoice';
import {newVoiceId,upsertVoice,voicesSamplesDir} from '@/lib/voicesStudio';
import {requireStorageHeadroom} from '@/lib/storageAdmission';
import {CHARACTER_VOICE_SAMPLE,expandCharacterVoiceDescription} from './voiceContract';
import type {CharacterVoiceProvider,CharacterVoiceAudition,CharacterVoiceOptions} from './voiceContract';
import type {Workspace,Candidate} from './contract';
const run=promisify(execFile);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Preview={id:string;path:string;generatedVoiceId?:string};
type Audition={pid?:number;id:string;characterId:string;provider:CharacterVoiceProvider;description:string;expanded:string;text:string;seed:number;model:string;status:string;message?:string;session?:string;job?:string;previews:Preview[];savedVoiceId?:string;selectedPreview?:string;providerVoiceId?:string;registrationStarted?:boolean;created:string};
function context(w:Workspace,cid:string){
 const c=w.candidates.find(c=>c.id===cid),owner=w.libraryOwner||w.owner;
 if(!c?.globalId||!loadCharacter(owner,c.globalId))throw new RequestError('Save this character before adding a voice. A single saved image is enough.',409);
 return {c,owner,characterId:c.globalId};
}
function file(dir:string,c:Candidate,id?:string){return path.join(dir,`voice-${c.id}-${id||'current'}.json`);}
function load(dir:string,c:Candidate,id?:string):Audition|null{
 try { const current=JSON.parse(fs.readFileSync(file(dir,c,id),'utf8'));return id?current:load(dir,c,current.id); }catch{return null;}
}
function persist(dir:string,c:Candidate,a:Audition){atomicJson(file(dir,c,a.id),a);atomicJson(file(dir,c),{id:a.id});}
function reconcile(w:Workspace,dir:string,c:Candidate,a:Audition){
 const alive=()=>{if(!a.pid)return false;try{process.kill(a.pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code==='EPERM';}};
 if(a.provider==='elevenlabs'&&a.status==='starting'&&!alive()){a.status='failed';a.message='Preview generation was interrupted. Check account usage before generating another preview; nothing was automatically retried.';persist(dir,c,a);}

 if(a.provider==='qwen3'&&a.session&&['starting','queued','running'].includes(a.status)){
  if(!a.job){const jobs=sessionJobs(w.owner,a.session);if(jobs.length===1)a.job=jobs[0].id;}
  if(a.job){const job=reconcileJob(w.owner,a.session,a.job);a.status=job.status;a.message=job.stage;
   if(a.status==='completed') {const session=readSession(w.owner,a.session),assets=session.assets.filter(x=>x.kind==='audio');
    if(assets.length!==1){a.status='failed';a.message='The preview did not contain one clean audio result. Your current voice is unchanged.';}
    else a.previews=[{id:a.job,path:assetFile(w.owner,session,assets[0].id)}];
   }
   persist(dir,c,a);
  }else if(!alive()){a.status='failed';a.message='The voice request stopped before a queued job could be found. No duplicate was started.';persist(dir,c,a);}
 }
 return a;
}
function publicState(w:Workspace,c:Candidate,a:Audition):CharacterVoiceAudition {
 return {id:a.id,provider:a.provider,description:a.description,status:a.status,message:a.message,savedVoiceId:a.savedVoiceId,selectedPreview:a.selectedPreview,
  previews:a.previews.map(p=>({id:p.id,audioUrl:'/api/experiments/video-characters/voice?'+new URLSearchParams({id:w.id,character:c.id,audition:a.id,audio:p.id})}))};
}
export async function characterVoiceOptions(accountId?:string,provider:CharacterVoiceProvider='elevenlabs'):Promise<CharacterVoiceOptions>{
 const qwenAvailable=characterVoiceEngines().some(e=>e.id==='qwen3'&&e.available);
 if(provider==='qwen3')return {qwenAvailable,elevenAvailable:false,elevenMessage:'Choose ElevenLabs to check credits.',remaining:null,creditNote:'Uses ElevenLabs credits for a preview set.'};
 try {const status=await getElevenLabsStatus(accountId);return {qwenAvailable,elevenAvailable:status.canGenerate,elevenMessage:status.message,remaining:status.remaining,creditNote:'Uses ElevenLabs credits for one preview set. Final usage is reported by ElevenLabs; retries use more credits.'};}
 catch{return {qwenAvailable,elevenAvailable:false,elevenMessage:'Unable to check ElevenLabs credits. No paid request will be sent.',remaining:null,creditNote:'Uses ElevenLabs credits.'};}
}
export function currentCharacterVoice(w:Workspace,dir:string,cid:string){
 const {c,characterId}=context(w,cid),a=load(dir,c);if(!a)return null;
 if(a.characterId!==characterId)throw new RequestError('This preview belongs to a different saved character.',409);
 return publicState(w,c,reconcile(w,dir,c,a));
}
export async function generateInlineCharacterVoice(w:Workspace,dir:string,cid:string,body:Record<string,unknown>,accountId?:string){
 const {c,characterId}=context(w,cid),requestId=String(body.requestId||''),provider=String(body.provider),description=String(body.description||'').trim();
 if(!uuid.test(requestId)||!['qwen3','elevenlabs'].includes(provider)||body.consent!==true)throw new RequestError('Choose a voice provider and press Generate Voice.',400);
 let expanded:string;try {expanded=expandCharacterVoiceDescription(description);}catch(e){throw new RequestError((e as Error).message,400);}
 const existing=load(dir,c,requestId);
 if(existing){if(existing.characterId!==characterId||existing.provider!==provider||existing.description!==description)throw new RequestError('The request has changed. Generate a new preview.',409);return publicState(w,c,reconcile(w,dir,c,existing));}
 const previous=load(dir,c);if(previous){reconcile(w,dir,c,previous);if(['starting','queued','running','registering'].includes(previous.status))throw new RequestError('The current voice request is still pending. No duplicate was started.',409);}
 const options=await characterVoiceOptions(accountId,provider as CharacterVoiceProvider);
 if(provider==='qwen3'&&!options.qwenAvailable||provider==='elevenlabs'&&!options.elevenAvailable)throw new RequestError(provider==='qwen3'?'The local Qwen voice worker is unavailable. Your saved voice is unchanged.':options.elevenMessage,409);
 requireStorageHeadroom(dir,32*1024**2);
 const a:Audition={pid:process.pid,id:requestId,characterId,provider:provider as CharacterVoiceProvider,description,expanded,text:CHARACTER_VOICE_SAMPLE,seed:randomInt(1,2147483647),model:provider==='qwen3'?'Qwen3-TTS-12Hz-1.7B-VoiceDesign':getElevenLabsModel(),status:'starting',previews:[],created:new Date().toISOString()};
 // Persist before any external/GPU request. Reloading never resubmits it.
 if(provider==='qwen3')a.session=createSession(w.owner).id;
 persist(dir,c,a);
 try {
  if(provider==='qwen3'){
   const job=await startJob(w.owner,a.session!,'speech',undefined,{text:a.text,description:a.expanded,seed:a.seed,seconds:10,voiceDesignEngine:'qwen3'},'rtx3090');a.job=job.id;a.status=job.status;
  }else {
   const result=await createElevenLabsDesignPreview({voiceDescription:a.expanded,sampleText:a.text,seed:a.seed,shouldEnhance:false},accountId);
   a.text=result.text;a.previews=result.previews.slice(0,3).map(p=>({id:randomUUID(),path:p.audioPath,generatedVoiceId:p.generatedVoiceId}));a.status='completed';
  }
 }catch(error){
  // A queue commit may outlive the HTTP response. Recover its identity; never
  // treat a durably queued operation as permission to launch a replacement.
  const recovered=a.provider==='qwen3'&&a.session?sessionJobs(w.owner,a.session):[];
  if(recovered.length===1){a.job=recovered[0].id;a.status='queued';a.message='The queued voice request was recovered. No duplicate was started.';}
  else {a.status='failed';a.message='Voice generation did not complete. No automatic retry was made. '+(error instanceof Error?error.message:'Please try again.');}
 }
 persist(dir,c,a);return publicState(w,c,a);
}
export function inlineVoiceAudio(w:Workspace,dir:string,cid:string,aid:string,pid:string){
 const {c,characterId}=context(w,cid);if(!uuid.test(aid))throw new RequestError('Preview not found.',404);
 const a=load(dir,c,aid);if(!a||a.characterId!==characterId)throw new RequestError('Preview not found.',404);
 reconcile(w,dir,c,a);const preview=a.previews.find(p=>p.id===pid);
 if(!preview||a.status!=='completed'&&a.status!=='saved')throw new RequestError('Preview is not ready.',404);
 const stat=fs.lstatSync(preview.path);if(!stat.isFile()||stat.isSymbolicLink())throw new RequestError('Preview not found.',404);
 return preview.path;
}
export async function useInlineCharacterVoice(w:Workspace,dir:string,cid:string,body:Record<string,unknown>){
 const {c,owner,characterId}=context(w,cid),a=load(dir,c);
 if(!a||a.id!==body.audition||a.characterId!==characterId)throw new RequestError('Choose the current voice preview for this character.',409);
 reconcile(w,dir,c,a);const preview=a.previews.find(p=>p.id===body.preview);
 if(!preview||!['completed','saved'].includes(a.status))throw new RequestError('Listen to a completed voice preview first.',409);
 if(a.selectedPreview&&a.selectedPreview!==preview.id)throw new RequestError('That preview has already been saved with another selection.',409);
 a.savedVoiceId ||= newVoiceId(owner);a.selectedPreview=preview.id;persist(dir,c,a);
 const dest=voicesSamplesDir(a.savedVoiceId),master=path.join(dest,'original'+path.extname(preview.path)),wav=path.join(dest,'ref.wav');
 if(!fs.existsSync(master))fs.copyFileSync(preview.path,master,fs.constants.COPYFILE_EXCL);
 if(!fs.existsSync(wav)){
  const tmp=path.join(dest,randomUUID()+'.wav');try{await run('ffmpeg',['-v','error','-nostdin','-n','-protocol_whitelist','file,pipe','-i',master,'-vn','-ac','1','-ar','32000','-c:a','pcm_s16le',tmp],{timeout:45000,maxBuffer:1024**2});fs.renameSync(tmp,wav);}finally{fs.rmSync(tmp,{force:true});}
 }
 const probe=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',wav],{timeout:15000,maxBuffer:65536});
 const durationSeconds=Number(JSON.parse(probe.stdout).format?.duration);
 if(!Number.isFinite(durationSeconds)||durationSeconds<2||durationSeconds>30.05)throw new RequestError('The voice sample must be 2–30 seconds. The preview is preserved; your saved voice is unchanged.',409);
 fs.chmodSync(master,0o600);fs.chmodSync(wav,0o600);
 if(a.provider==='elevenlabs'&&!a.providerVoiceId){
  if(a.registrationStarted)throw new RequestError('ElevenLabs voice registration needs review after an interrupted response. No duplicate voice was created. Your existing character voice is unchanged.',409);
  a.registrationStarted=true;persist(dir,c,a);
  try {a.providerVoiceId=await saveElevenLabsDesignedVoice({name:loadCharacter(owner,characterId)!.name+' — Voice',description:a.expanded,generatedVoiceId:preview.generatedVoiceId!});persist(dir,c,a);}
  catch {throw new RequestError('ElevenLabs could not confirm voice registration. Your previous voice is unchanged; no registration was retried. Please review the account before trying another voice.',409);}
 }
 const design={provider:a.provider,providerVoiceId:a.providerVoiceId||null,generatedVoiceId:preview.generatedVoiceId||null,model:a.model,description:a.description,expandedDescription:a.expanded,seed:a.seed,source:'character-voice-design',auditionId:a.id,durationSeconds,sha256:createHash('sha256').update(fs.readFileSync(wav)).digest('hex'),settings:{sampleRate:32000,channels:1,normalization:false,preview:a.provider==='qwen3'?{voiceDesignEngine:'qwen3',seconds:10,gpu:'rtx3090'}:{outputFormat:getElevenLabsOutputFormat(),loudness:0.5,guidanceScale:5,shouldEnhance:false}},createdAt:a.created};
 atomicJson(path.join(dest,'design.json'),design);
 upsertVoice(owner,{voiceId:a.savedVoiceId,name:loadCharacter(owner,characterId)!.name+' — '+(a.provider==='qwen3'?'Qwen':'ElevenLabs'),tags:[a.provider,'character-voice-design'],type:'created',refText:a.text,refAudioRel:`samples/${a.savedVoiceId}/ref.wav`,createdAt:a.created,updatedAt:new Date().toISOString(),design});
 const saved=attachSavedCharacterVoice(owner,characterId,a.savedVoiceId);
 updateCharacterVoiceSelection(owner,characterId,{referenceAudioPath:saved!.referenceAudioPath!,voiceSettings:{...saved!.voiceSettings,providerVoiceId:a.providerVoiceId||null,generatedVoiceId:preview.generatedVoiceId||null,voiceDesign:design}});
 c.voiceId=a.savedVoiceId;c.voiceReviewed=true;a.status='saved';persist(dir,c,a);w.message='Voice saved and assigned to '+c.name+'. Visual references and RefMods are unchanged.';
 return publicState(w,c,a);
}
