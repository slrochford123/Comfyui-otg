import {requireCharacterDevelopment} from "@/lib/h3CharacterDevelopmentAvailability";
import {withNsfwWorkspace,nsfwEnabled} from "@/lib/experiments/availability";
import {runtimePath,voicePython} from "@/lib/runtime/configPaths";
import { DEVELOPMENT_ACTIONS, actDevelopment, saveDevelopmentCharacter } from './development';
import {writeH3RefModSidecar} from "@/lib/h3SpecialModes/refModCreation";
import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,randomInt} from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import sharp from 'sharp';
import type {NextRequest} from 'next/server';
import {OTG_DATA_ROOT,safeSegment} from '@/lib/paths';
import {RequestError} from '@/lib/requestError';
import {requireTestLab,listSessions,getAsset} from '@/lib/experiments/store';
import {getGallerySourcesForRequest,listGalleryItemsFromSources} from '@/lib/gallery';
import {requireStorageHeadroom} from '@/lib/storageAdmission';
import {getMediaQueueJob,mediaQueueEnabled} from '@/lib/workers/mediaGpuQueue';
import {extractComfyHistoryImages} from '@/lib/comfyImageOutputLookup';
import {verifyCharacterVoiceBundle,characterRefVoiceChoices,resolveCharacterRefVoice,snapshotCharacterRefVoice} from '@/lib/h3SpecialModes/characterRefVoice';
import {CHARACTER_REF_VIEWS} from '@/lib/h3SpecialModes/characterRefCardContract';
import {characterRefOwnerHash} from '@/lib/h3SpecialModes/characterRefCardAccess';
import {createCharacter,loadCharacter,updateCharacterVoiceSelection} from '@/lib/characters/store';
import { characterReferenceIds, MAX_CHARACTER_REFERENCES, SOURCE_VIEW_ROLES } from './contract';
import type {Workspace,Candidate,Voice,View} from './contract';
import {MAX_EXTRACTION_VIDEO_BYTES, MAX_EXTRACTION_VIDEO_SECONDS} from './limits';
const run=promisify(execFile);
import { queueExtractionView, queueExtractionMaster, queueExtractionBundle, jobBackend, copyExtractionBundle } from './routing';
const taskRoot='/home/shawn-rochford/AI/research/video-character-0sypptue';
const python=taskRoot+'/mirage-venv/bin/python';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function id(s:string){if(!uuid.test(s))throw new RequestError('Invalid workspace identifier.',400);return s;}
export function folder(owner:string,wid?:string){requireCharacterDevelopment();return path.join(OTG_DATA_ROOT,'video-characters',characterRefOwnerHash(owner),...(wid?[id(wid)]:[]));}
const locks=new Map<string,Promise<unknown>>();
export async function locked<T>(owner:string,wid:string,fn:()=>Promise<T>){const key=folder(owner,wid),before=locks.get(key)||Promise.resolve();const work=before.catch(()=>{}).then(fn);locks.set(key,work);try{return await work;}finally{if(locks.get(key)===work)locks.delete(key);}}
export async function write(w:Workspace){w.revision++;w.updated=new Date().toISOString();const f=folder(w.owner,w.id);await fs.mkdir(f,{recursive:true,mode:0o700});const tmp=path.join(f,randomUUID()+'.tmp');await fs.writeFile(tmp,JSON.stringify(w),{mode:0o600});await fs.rename(tmp,path.join(f,'workspace.json'));return w;}
export async function read(owner:string,wid:string):Promise<Workspace>{try{const w=JSON.parse(await fs.readFile(path.join(folder(owner,wid),'workspace.json'),'utf8'));if(w.owner!==owner||w.id!==wid)throw Error();return w;}catch{throw new RequestError('Workspace not found.',404);}}
export async function list(owner:string){const names=await fs.readdir(folder(owner)).catch(()=>[]);return (await Promise.all(names.filter(s=>uuid.test(s)).map(s=>read(owner,s).catch(()=>null)))).filter((w):w is Workspace=>!!w).sort((a,b)=>b.updated.localeCompare(a.updated)).map(w=>({id:w.id,sourceName:w.sourceName,updated:w.updated,state:w.state}));}
export async function sources(req:NextRequest,owner:string){
 const {sources:gallery}=await getGallerySourcesForRequest(req);
 const g=listGalleryItemsFromSources(gallery,{filter:'videos',per:200}).items.map(v=>({key:'gallery:'+v.name,name:v.name,file:v.path,createdAt:v.createdAt,productionId:String(v.meta.submitPayload?.productionId||''),refs:[] as Array<{id:string;name:string;file:string}>}));
 const lab=nsfwEnabled()?withNsfwWorkspace(()=>listSessions(owner).flatMap(s=>s.assets.filter(a=>a.mime==='video/mp4').map(a=>({key:'lab:'+a.id,name:s.title+' · '+a.name,file:getAsset(owner,a.id).file,createdAt:Date.parse(a.created)||0,productionId:'test-session:'+s.id,refs:s.assets.filter(a=>a.role==='source'&&a.mime.startsWith('audio/')).map(a=>({id:a.id,name:a.name,file:getAsset(owner,a.id).file}))})))):[];
 return [...lab,...g];
}
export async function newWorkspace(owner:string,name:string,source:string,productionId:string,refs:Workspace['sourceRefs']=[],requestedId?:string|{id?:string;continuation?:Workspace["continuation"];libraryOwner?:string},libraryOwner?:string){
 const options=typeof requestedId==="object"?requestedId:undefined;requestedId=options?.id||(typeof requestedId==="string"?requestedId:undefined);libraryOwner=options?.libraryOwner||libraryOwner;
 requireStorageHeadroom(OTG_DATA_ROOT,512*1024**2);
 const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_EXTRACTION_VIDEO_BYTES)throw new RequestError('Use a video up to 256 MiB.',400);
 const {stdout}=await run('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration,format_name:stream=codec_type,width,height','-of','json',source],{timeout:15000,maxBuffer:1024**2});
 const p=JSON.parse(stdout),duration=Number(p.format?.duration);if(!p.streams?.some((s:{codec_type:string})=>s.codec_type==='video')||!String(p.format?.format_name).includes('mp4')||!Number.isFinite(duration)||duration<=0||duration>MAX_EXTRACTION_VIDEO_SECONDS)throw new RequestError('Choose an MP4 video up to three minutes.',400);
 const wid=requestedId?id(requestedId):randomUUID(),dir=folder(owner,wid);await fs.mkdir(dir,{recursive:true,mode:0o700});
 try { await fs.copyFile(source,path.join(dir,'source.mp4'),sync.constants.COPYFILE_EXCL); }
 catch(error){if(!requestedId||(error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 await fs.chmod(path.join(dir,'source.mp4'),0o600);
 const hash=await digest(path.join(dir,'source.mp4'));if(hash!==await digest(source))throw new RequestError('Source changed during import. Retry.',409);
 const savedRefs=[];for(const ref of refs||[]){const target=randomUUID()+'.audio';await fs.copyFile(ref.file,path.join(dir,target));const normalized=randomUUID()+'.wav';await run('ffmpeg',['-v','error','-nostdin','-n','-protocol_whitelist','file,pipe','-i',path.join(dir,target),'-vn','-ac','1','-ar','32000','-c:a','pcm_s16le',path.join(dir,normalized)],{timeout:45000,maxBuffer:1024**2});savedRefs.push({...ref,file:normalized,originalFile:target});}
 return write({id:wid,revision:0,owner,continuation:options?.continuation,libraryOwner,productionId:productionId||'private-video:'+wid,sourceName:name.slice(0,160),sourceSha256:hash,created:new Date().toISOString(),updated:'',stage:0,state:'draft',message:'Original copied and preserved. Analyze when ready.',frames:[],candidates:[],voices:[],warnings:[],duration,sourceRefs:savedRefs});
}
async function digest(file:string){const h=createHash('sha256');for await(const chunk of sync.createReadStream(file))h.update(chunk);return h.digest('hex');}
export async function mediaFile(w:Workspace,name:string){
 const allowed=['source.mp4',w.continuationLastFrame||'',...w.frames.map(f=>f.file),...w.candidates.flatMap(c=>[c.file,c.extractedFile||'',...c.views.map(v=>v.file||''),...(c.priorViews||[]).map(v=>v.file||''),c.development?.sheet?.file||'',...(c.development?.priorSheets||[]).map(s=>s.file),c.bundle?.file||'']),...w.voices.flatMap(v=>[v.file,...v.segments.map(s=>s.file||'')])];
 if(!allowed.includes(name)||name!==path.basename(name))throw new RequestError('Media not found.',404);
 const file=path.join(folder(w.owner,w.id),name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new RequestError('Media not found.',404);return {file,stat};
}
function candidate(w:Workspace,cid:unknown){const c=w.candidates.find(c=>c.id===cid);if(!c)throw new RequestError('Character candidate not found.',404);return c;}
function invalidate(c:Candidate){c.approved=false;c.voiceReviewed=false;c.voiceId=null;delete c.card;if(c.bundle)c.priorBundles=[...(c.priorBundles||[]),c.bundle];delete c.bundle;}
function setCharacterReferences(c: Candidate, references: Candidate[]) {
  c.referenceIds = references.map(item => item.id);
  c.file = references[0].extractedFile || references[0].file;
  c.frame = references[0].extractedFrame || references[0].frame;
  if (c.views.length) c.priorViews = [...(c.priorViews || []), ...c.views];
  c.views = [];
  invalidate(c);
  if(c.development){if(c.development.sheet)c.development.priorSheets=[...(c.development.priorSheets||[]),c.development.sheet];c.development={version:1,priorSheets:c.development.priorSheets};}
}

async function dispatchView(w: Workspace, c: Candidate, view: View, directory: string) {
  try {
    await queueExtractionView(w, c, view, directory, () => write(w));
  } catch (error) {
    view.state = "attention";
    view.error = (error as Error).message;
  }
}

function mutable(w:Workspace){if(w.state==='analyzing'||w.candidates.some(c=>c.views.some(v=>['queued','dispatching','running','preparing'].includes(v.state))||c.bundle&&['queued','dispatching','running','preparing'].includes(c.bundle.state)))throw new RequestError('Wait for current processing. Your work is saved.',409);}
let cpuBusy=false;
export async function analyze(w:Workspace,expectedVoices?:unknown,separate=false,includeVoice=true,voiceOnly=false){
 if(expectedVoices!==undefined&&(!Number.isInteger(expectedVoices)||Number(expectedVoices)<1||Number(expectedVoices)>5))throw new RequestError('Choose 1–5 voices, or automatic.',400);
 mutable(w);if(w.frames.length&&!voiceOnly)throw new RequestError('Analysis is already saved. Add a frame manually or create a new workspace to reanalyze.',409);if(cpuBusy)throw new RequestError('CPU extraction is busy. Try again shortly.',409);
 const dir=folder(w.owner,w.id),output=path.join(dir,'analysis-'+randomUUID());await fs.mkdir(output,{mode:0o700});const request=path.join(output,'request.json');
 await fs.writeFile(request,JSON.stringify({source:path.join(dir,'source.mp4'),output,expectedVoices,separate,includeVoice,voiceOnly,separationPython:process.env.OTG_AUDIO_ANALYSIS_PYTHON||runtimePath('unified-audio','.venv','bin','python'),separationScript:path.join(process.cwd(),'scripts/video-characters/separate.py'),diarizationPython:process.env.OTG_SPEAKER_DIARIZATION_PYTHON||runtimePath('voice-dubbing','diarization-venv','bin','python'),diarizationScript:path.join(process.cwd(),'scripts/video-characters/diarize.py'),diarizationModel:process.env.OTG_SPEAKER_DIARIZATION_MODEL||runtimePath('voice-dubbing','models','pyannote-community-1')}),{mode:0o600});
 cpuBusy=true;w.state='analyzing';w.message='Sampling frames and grouping voices locally on CPU…';await write(w);
 const child=execFile(python,[path.join(process.cwd(),'scripts/video-characters/extract.py'),request],{timeout:12*60*1000,maxBuffer:1024**2,env:{...process.env,CUDA_VISIBLE_DEVICES:'',XDG_CACHE_HOME:taskRoot+'/cache',HF_HUB_OFFLINE:'1',CACTUS_TELEMETRY:'0',DO_NOT_TRACK:'1',OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'2'}},async(error,stdout,stderr)=>{cpuBusy=false;await fs.writeFile(path.join(output,'worker.log'),stdout+'\n'+stderr,{mode:0o600});if(error)await locked(w.owner,w.id,async()=>{const current=await read(w.owner,w.id);current.state='attention';current.message='Analysis stopped. Original and partial results retained; inspect or start a new workspace.';await write(current);}).catch(()=>{});});
 w.analysis={pid:child.pid!,request,output,voiceOnly};return write(w);
}
async function finishAnalysis(w:Workspace){
 if(w.state!=='analyzing'||!w.analysis)return false;const f=path.join(w.analysis.output,'analysis.json');
 if(!sync.existsSync(f)){
  const alive=sync.existsSync('/proc/'+w.analysis.pid+'/cmdline')&&sync.readFileSync('/proc/'+w.analysis.pid+'/cmdline','utf8').includes(w.analysis.request);
  if(!alive&&Date.now()-Date.parse(w.updated)>10000){w.state='attention';w.message='CPU worker stopped. Source preserved; no duplicate analysis started.';return true;}return false;
 }
 const r=JSON.parse(await fs.readFile(f,'utf8'));if(r.sourceSha256!==w.sourceSha256)throw Error('Source integrity mismatch.');
 for(const entry of await fs.readdir(w.analysis.output))if(/^[a-f0-9-]{36}\.(png|wav)$/.test(entry)||['soundtrack.wav','speech.wav','music.wav','sfx.wav'].includes(entry))await fs.copyFile(path.join(w.analysis.output,entry),path.join(folder(w.owner,w.id),entry));
 if(w.analysis.voiceOnly){
  Object.assign(w,{voices:r.voices,warnings:r.warnings,diarization:r.diarization,separation:r.separation,state:'review',message:'Listen to each candidate before attaching it to a character.'});
  return true;
 }
 Object.assign(w,{frames:r.frames,candidates:r.candidates,voices:r.voices,warnings:r.warnings,detector:r.detector,diarization:r.diarization,separation:r.separation,state:'review',stage:1,message:'Select characters. Object detections may include props; merge recurring appearances yourself.'});
 for(const c of w.candidates){c.extractedFile=c.file;c.extractedFrame=c.frame;}
 for(const ref of w.sourceRefs||[]){try{const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',path.join(folder(w.owner,w.id),ref.file)],{timeout:10000});const duration=Number(JSON.parse(stdout).format.duration);if(duration>0&&duration<=30)w.voices.push({id:ref.id,name:'Saved source reference · '+ref.name,file:ref.file,duration,segments:[],warning:'Supplied alongside this generation. Listen and confirm whose voice it is.',combined:false,sourceReference:true});}catch{/* keep original reference in provenance */}}
 return true;
}
function registerExtractedRefMod(workspace: Workspace, character: Candidate) {
  const bundle=character.bundle;
  if(!bundle?.visualOnly||bundle.state!=="ready"||!character.globalId) return;
  const dir=folder(workspace.owner,workspace.id);
  const time=new Date().toISOString();
  writeH3RefModSidecar({version:1,libraryName:bundle.name,name:character.name,category:"character",
    subfolder:bundle.name.split("/").slice(0,-1).join("/"),sourceType:"otg-created",createdAt:time,updatedAt:time,
    jobId:bundle.job,ownerKey:workspace.libraryOwner||workspace.owner,characterId:character.globalId,
    sourceAssets:(character.approvedViews||[]).map(view=>({name:view.label,kind:"image",path:path.join(dir,view.file)}))});
}
async function retryView(workspace: Workspace, character: Candidate, old: Candidate["views"][number], directory: string, fallback: boolean) {
  const id = randomUUID();
  const replacement: Candidate["views"][number] = { ...old, id, job: id, file: undefined, gpu: undefined, baseUrl: undefined, state: "preparing", error: undefined };
  character.priorViews = [...(character.priorViews || []), old];
  character.views = character.views.map(view => view.id === old.id ? replacement : view);
  try {
    await queueExtractionView(workspace, character, replacement, directory, () => write(workspace), fallback ? "rtx3060" : undefined);
    workspace.message = "Character view queued for " + replacement.gpu + ". Previous attempt preserved.";
  } catch (error) {
    replacement.state = "attention";
    replacement.error = (error as Error).message;
  }
}

export async function refresh(workspace: Workspace) {
  let changed = await finishAnalysis(workspace);
  const directory = folder(workspace.owner, workspace.id);
  for (const character of workspace.candidates) {
    for (const view of [...character.views]) {
      if (view.state === "preparing") {
        view.state = "attention";
        view.error = "Preparation was interrupted. Recreate this view to continue.";
        changed = true;
      }
      if (!view.job || !["queued", "dispatching", "running", "canceled"].includes(view.state)) continue;
      const job = getMediaQueueJob(view.job);
      changed = true;
      if (!job) {
        view.state = "attention";
        view.error = "Queue receipt missing. Check the original job before retrying.";
        continue;
      }
      const requestedReroute = job.status === "canceled" && job.error === "Owner requested extraction reroute to 5060 Ti / 3060";
      if (!view.developmentRole && !view.master && (requestedReroute || job.status === "failed" && job.gpu === "rtx5060ti")) {
        view.state = job.status;
        await retryView(workspace, character, view, directory, !requestedReroute);
        continue;
      }
      view.state = job.status;
      view.error = job.error || undefined;
      if (["failed", "unknown", "canceled"].includes(job.status)) view.error = job.error || "Original GPU result needs review.";
      if (job.status !== "completed") continue;
      const baseUrl = jobBackend(job, view.baseUrl);
      const response = await fetch(baseUrl + "/history/" + view.job, { signal: AbortSignal.timeout(8000) });
      const history = await response.json();
      const image = extractComfyHistoryImages(history, view.job).find(item => item.nodeId === (view.master ? "9" : "461"));
      if (!response.ok || !history[view.job]?.status?.completed || !image) {
        view.state = "attention";
        view.error = "The completed reference image is unavailable.";
        continue;
      }
      const output = await fetch(baseUrl + "/view?" + new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type }), { signal: AbortSignal.timeout(20000) });
      if (!output.ok) throw Error("Qwen output unavailable.");
      const imagePipeline=sharp(Buffer.from(await output.arrayBuffer()));
      if (view.master) {
        const size=await imagePipeline.metadata();
        if(size.width!==1080||size.height!==1920) {
          view.state="attention";
          view.error="The character master was not 1080 × 1920. The original has been retained.";
          continue;
        }
      }
      await imagePipeline.png().toFile(path.join(directory, view.id + ".png"));
      view.file = view.id + ".png";
      view.state = "ready";
    }
    const bundle = character.bundle;
    if (bundle?.execution === "private3060" && bundle.state !== "ready") {
      const resultFile = path.join(directory, "encode-" + bundle.job, "result.json");
      if (sync.existsSync(resultFile)) {
        try {
          const result = JSON.parse(await fs.readFile(resultFile, "utf8"));
          if (!result.history?.status?.completed || !Number.isFinite(result.library?.tokens) || result.library.tokens <= 0) throw Error("Private encoder verification receipt missing.");
          if (character.voiceId && !bundle.visualOnly) verifyCharacterVoiceBundle(result.history, character.views.length, result.library.tokens);
          else if (result.library.shape?.[0] !== (bundle.sourceCount ?? character.views.length)) throw Error("Private encoder reference count differs.");
          const source = path.join(directory, "encode-" + bundle.job, bundle.job + ".safetensors");
          if (await digest(source) !== result.sha256) throw Error("Private bundle integrity check failed.");
          bundle.file = bundle.job + ".safetensors";
          await fs.copyFile(source, path.join(directory, bundle.file));
          bundle.sha256 = result.sha256;
          bundle.tokens = result.library.tokens;
          bundle.state = "ready";
          registerExtractedRefMod(workspace,character);
          delete bundle.error;
        } catch (error) { bundle.state = "attention"; bundle.error = (error as Error).message; }
        changed = true;
      } else if (bundle.coordinatorPid && !sync.existsSync("/proc/" + bundle.coordinatorPid)) {
        bundle.state = "attention";
        bundle.error = "The original private encoder needs reconciliation. Sources are saved.";
        changed = true;
      }
      continue;
    }
    if (!bundle || !["queued", "dispatching", "running"].includes(bundle.state)) continue;
    const job = getMediaQueueJob(bundle.job);
    changed = true;
    bundle.state = job?.status || "attention";
    bundle.error = job?.error || undefined;
    if (!bundle.visualOnly && job?.status === "failed" && job.gpu === "rtx5060ti") {
      character.priorBundles = [...(character.priorBundles || []), bundle];
      try { await queueExtractionBundle(workspace, character, directory, () => write(workspace), "rtx3060"); }
      catch (error) { bundle.state = "attention"; bundle.error = (error as Error).message; }
      continue;
    }
    if (job && ["failed", "unknown", "canceled"].includes(job.status)) bundle.error = job.error || "Encoding needs review.";
    if (job?.status !== "completed") continue;
    try {
      const baseUrl = jobBackend(job, bundle.baseUrl);
      const [historyResponse, libraryResponse] = await Promise.all([
        fetch(baseUrl + "/history/" + bundle.job, { signal: AbortSignal.timeout(10000) }),
        fetch(baseUrl + "/refmods/library", { signal: AbortSignal.timeout(10000) }),
      ]);
      const [history, library] = await Promise.all([historyResponse.json(), libraryResponse.json()]);
      const item = Array.isArray(library) ? library.find(entry => entry.name === bundle.name) : null;
      if (!historyResponse.ok || !libraryResponse.ok || !history[bundle.job]?.status?.completed || !item || !Number.isFinite(item.tokens) || item.tokens <= 0) throw Error("Missing encoder or library verification receipt.");
      if (character.voiceId && !bundle.visualOnly) {
        verifyCharacterVoiceBundle(history[bundle.job], character.views.length, item.tokens);
        if (item.kind !== "bundle") throw Error("Voice bundle is missing.");
      } else if (item.shape?.[0] !== (bundle.sourceCount ?? character.views.length)) throw Error("Reference count differs.");
      const file = bundle.job + ".safetensors";
      await copyExtractionBundle(bundle.gpu, bundle.name, String(item.path || item.file || ""), path.join(directory, file));
      bundle.file = file;
      bundle.sha256 = await digest(path.join(directory, file));
      bundle.tokens = item.tokens;
      bundle.state = "ready";
      registerExtractedRefMod(workspace,character);
      await fs.writeFile(path.join(directory, bundle.job + ".receipt.json"), JSON.stringify({ history: history[bundle.job], library: item }), { mode: 0o600 });
    } catch (error) {
      bundle.state = "attention";
      bundle.error = (error as Error).message;
    }
  }
  if (changed) await write(workspace);
  return workspace;
}
export async function act(w:Workspace,data:Record<string,unknown>){
 if(data.revision!==w.revision)throw new RequestError('Workspace changed. Refresh before editing.',409);mutable(w);
 const dir=folder(w.owner,w.id),action=String(data.action);
 if((DEVELOPMENT_ACTIONS as readonly string[]).includes(action)){await actDevelopment(w,data,{directory:dir,persist:()=>write(w),media:file=>mediaFile(w,file)});return write(w);}
 if(w.libraryOwner&&['reconstruct','regenerate-view','prepare-player-master','approve','save'].includes(action))throw new RequestError('Use Create Model, approve the default model, then create its five-view Character Card.',409);
 if(action==='analyze')return analyze(w,data.expectedVoices,data.separate===true,data.includeVoice!==false);
 if(action==='analyze-voices')return analyze(w,undefined,true,true,true);
 if(action==='source-role'){
  const c=candidate(w,data.character),ref=String(data.reference);
  if(!characterReferenceIds(c,w.candidates).includes(ref)||!SOURCE_VIEW_ROLES.includes(data.role as typeof SOURCE_VIEW_ROLES[number]))throw new RequestError('Select a source view and its role.',400);
  c.referenceRoles={...c.referenceRoles,[ref]:data.role as typeof SOURCE_VIEW_ROLES[number]};
 } else if(action==='recheck'){await refresh(w);}
 else if(action==='complete-character'){
  const c=candidate(w,data.character);if(!c.globalId||!loadCharacter(w.libraryOwner||w.owner,c.globalId))throw new RequestError('Save this character before completing. Voice and RefMod are optional.',409);
  w.completedAt=new Date().toISOString();w.completedCharacterIds=Array.from(new Set([...(w.completedCharacterIds||[]),c.globalId]));w.stage=4;w.message='Character saved. You can return later to continue developing it.';
 }
 else if(action==='stage'){const n=Number(data.stage);if(!Number.isInteger(n)||n<0||n>4)throw new RequestError('Invalid step.',400);w.stage=n;}
 else if(action==='character'){
  const c=candidate(w,data.character);const name=String(data.name??c.name).trim(),description=String(data.description??c.description).trim();if(!name||name.length>96||description.length>2000)throw new RequestError('Name up to 96 and description up to 2000 characters.',400);
  if(c.name!==name||c.description!==description){c.name=name;c.description=description;invalidate(c);}if(typeof data.selected==='boolean')c.selected=data.selected;
 }else if(action==='merge'){
  const c=candidate(w,data.character),other=candidate(w,data.other);if(c.id===other.id)throw new RequestError('Select another appearance.',400);invalidate(c);c.mergedFrom=[...new Set([...(c.mergedFrom||[]),other.id,...(other.mergedFrom||[])])];other.selected=false;
 }else if(action==='split'){
  const c=candidate(w,data.character), other=candidate(w,data.other);
  if(!c.mergedFrom?.includes(other.id))throw new RequestError('This appearance was not merged.',400);
  const referenceIds = characterReferenceIds(c, w.candidates);
  c.mergedFrom = c.mergedFrom.filter(item => item !== other.id);
  other.selected = true;
  if (referenceIds.includes(other.id)) {
    const remaining = referenceIds.filter(item => item !== other.id);
    setCharacterReferences(c, (remaining.length ? remaining : [c.id]).map(item => candidate(w, item)));
  } else invalidate(c);
 }else if(action==='link-form'){const c=candidate(w,data.character),other=candidate(w,data.other);if(c.id===other.id)throw new RequestError('Choose a different form.',400);c.alternateForms=[...new Set([...c.alternateForms,other.id])];other.alternateForms=[...new Set([...other.alternateForms,c.id])];
 }else if(action==='source'||action==='references'){
  const c = candidate(w, data.character);
  const ids = action === 'source' ? [data.other] : data.references;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_CHARACTER_REFERENCES ||
      new Set(ids).size !== ids.length || ids.some(item => item !== c.id && !c.mergedFrom?.includes(item))) {
    throw new RequestError('Choose one to four distinct appearances of the same character.', 400);
  }
  const old = characterReferenceIds(c, w.candidates);
  if (ids.length !== old.length || ids.some((item, index) => item !== old[index])) {
    setCharacterReferences(c, ids.map(item => candidate(w, item)));
  }
 }else if(action==='frame'){
  const time=Number(data.time);
  if(!Number.isFinite(time)||time<0||time>=w.duration)throw new RequestError('Choose a time inside the video.',400);
  const fid=randomUUID(),file=fid+'.png',output=path.join(dir,file);
  await run('ffmpeg',['-v','error','-nostdin','-n','-ss',String(time),'-i',path.join(dir,'source.mp4'),'-frames:v','1','-vf','scale=1280:1280:force_original_aspect_ratio=decrease',output],{timeout:30000});
  // A slider can land after the last frame's presentation timestamp.
  // Decode the bounded final second to select the same final frame as a video player.
  if(!sync.existsSync(output)&&time>=Math.max(0,w.duration-1)){
   await run('ffmpeg',['-v','error','-nostdin','-n','-sseof',String(-Math.min(1,w.duration)),'-i',path.join(dir,'source.mp4'),'-frames:v','1','-vf','scale=1280:1280:force_original_aspect_ratio=decrease,reverse',output],{timeout:30000});
  }
  const meta=await sharp(output).metadata();
  w.frames.push({id:fid,file,time,width:meta.width!,height:meta.height!});
 }else if(action==='crop'){
  const owner = data.character === undefined ? null : candidate(w, data.character);
  const referenceIds = owner ? characterReferenceIds(owner, w.candidates) : [];
  if (referenceIds.length >= MAX_CHARACTER_REFERENCES) throw new RequestError('Remove a reference before adding another frame.',400);
  const f=w.frames.find(f=>f.id===data.frame),box=data.box as number[];if(!f||!Array.isArray(box)||box.length!==4||box.some(x=>!Number.isFinite(x)||x<0||x>1000)||box[2]<=box[0]+10||box[3]<=box[1]+10)throw new RequestError('Draw a character region in the frame.',400);
  const cid=randomUUID(),file=cid+'.png';const left=Math.floor(box[0]*f.width/1000),top=Math.floor(box[1]*f.height/1000);await sharp(path.join(dir,f.file)).extract({left,top,width:Math.max(1,Math.floor(box[2]*f.width/1000)-left),height:Math.max(1,Math.floor(box[3]*f.height/1000)-top)}).png().toFile(path.join(dir,file));w.candidates.push({id:cid,name:'Character '+(w.candidates.length+1),description:'',frame:f.id,file,bbox:box,selected:!owner,approved:false,views:[],alternateForms:[],voiceId:null,voiceReviewed:false,extractedFile:file,extractedFrame:f.id,origin:'manual extracted crop'});
  if (owner) {
    owner.mergedFrom = [...(owner.mergedFrom || []), cid];
    setCharacterReferences(owner, [...referenceIds, cid].map(item => candidate(w, item)));
  }
 }else if(action==='reconstruct'){
  const c=candidate(w,data.character);if(!c.selected)throw new RequestError('Select the character first.',400);if(!mediaQueueEnabled())throw new RequestError('Shared GPU scheduler unavailable.',503);
  if(c.views.length && (typeof data.angle!=='string'||c.views.some(view=>view.angle===data.angle&&!view.master)))throw new RequestError('This view already exists. Use its retry action.',409);
  const references = characterReferenceIds(c, w.candidates).map(id => {
    const appearance = candidate(w, id);
    return {file: appearance.extractedFile || appearance.file, frame: appearance.extractedFrame || appearance.frame, role:c.referenceRoles?.[id]};
  });
  const imageTags = references.map((_, index) => `<image${index + 1}>`).join(", ");
  const identity = references.length === 1
    ? `Recreate only the selected character from ${imageTags} against a clean light gray background.`
    : `These reference images show the same character: ${imageTags}. Combine the visible face, proportions, clothing and details across these views to recreate that one character against a clean light gray background.`;
  invalidate(c);
  const angles = typeof data.angle === "string" ? CHARACTER_REF_VIEWS.filter(angle => angle.id === data.angle) : CHARACTER_REF_VIEWS;
  if (!angles.length) throw new RequestError("Choose an available reference view.",400);
  const evidence = references.map((ref,index) => ref.role ? `<image${index+1}> shows ${ref.role}.` : "").join(" ");
  const generated:View[] = angles.map(angle => ({
    id: randomUUID(), angle: angle.id, seed: randomInt(0, 2**48-1), references,
    prompt: `${identity} ${evidence} Use Primary Face for facial identity and apparent age, Clothing / Full Body for outfit and proportions, and side or back evidence for visible angle-specific details. If the character is a child, preserve child proportions. Blur is not evidence for new details. ${angle.instruction} Preserve recognizable identity, species, facial features, clothing, colors, distinctive marks and the exact artistic style. ${c.description} Infer missing anatomy conservatively. One view, no collage, no other characters or text.`,
    state: "preparing",
  }));
  c.views.push(...generated);
  for (const view of generated) await dispatchView(w, c, view, dir);
  w.message = "Review the reconstructed views when processing finishes.";
 }else if(action==='regenerate-view'){
  const c=candidate(w,data.character),old=c.views.find(v=>v.id===data.view);if(!old)throw new RequestError('View not found.',404);const previous=old.job?getMediaQueueJob(old.job):null;if(old.job&&(previous ? !['completed','failed','canceled'].includes(previous.status) : old.state!=='attention'))throw new RequestError('Original image job is unresolved. Recheck it before retrying.',409);if(!mediaQueueEnabled())throw new RequestError('Shared GPU scheduler unavailable.',503);
  const correction = String(data.correction || "").trim();
  if (correction.length > 1000) throw new RequestError("Use a correction up to 1000 characters.", 400);
  c.priorViews = [...(c.priorViews || []), old];
  invalidate(c);
  const id = randomUUID();
  const view = { id, angle: old.angle, seed: randomInt(0, 2**48-1), prompt: old.prompt + " " + correction, references: old.references, state: "preparing" };
  c.views = c.views.map(item => item.id === old.id ? view : item);
  await dispatchView(w, c, view, dir);
 }else if(action==='prepare-player-master'){
  const c=candidate(w,data.character);
  if(!c.selected||c.globalId||!mediaQueueEnabled())throw new RequestError('Select the character before preparing a master.',409);
  const ref=String(data.view||'');
  const crop=characterReferenceIds(c,w.candidates).includes(ref) ? candidate(w,ref) : undefined;
  const derived=c.views.find(view=>view.id===ref&&view.state==='ready'&&!view.master);
  const file=crop?(crop.extractedFile||crop.file):derived?.file;
  if(!file)throw new RequestError('Select a captured or reconstructed reference.',400);
  const source=await mediaFile(w,file);
  const size=await sharp(source.file).metadata();
  if(!size.width||!size.height||size.height<=size.width)throw new RequestError('The 1080 × 1920 master path is intended for portrait references.',400);
  const master:View={id:randomUUID(),angle:'1080 × 1920',master:true,sourceViewId:ref,state:'preparing'};
  c.views.push(master);
  try {await queueExtractionMaster(w,master,source.file,dir,()=>write(w));}
  catch(error){master.state='attention';master.error=(error as Error).message;}
 }else if(action==='create-player-refmod'){
  await actDevelopment(w,{...data,action:'create-visual-refmod'},{directory:dir,persist:()=>write(w),media:file=>mediaFile(w,file)});
 }else if(action==='approve-player'){
  const c=candidate(w,data.character),refs=characterReferenceIds(c,w.candidates);
  if(refs.length!==1||!Array.isArray(data.views)||data.views.length!==1||data.views[0]!==refs[0])throw new RequestError('Save one original image, or use Create Model for multiple images.',409);
  c.look=String(data.look||'').slice(0,96);c.approved=true;c.approvedViews=[{id:refs[0],file:c.extractedFile||c.file,label:'Original extracted image',origin:'captured',frame:c.extractedFrame||c.frame}];
 }else if(action==='save-player'){
  const c=candidate(w,data.character);await saveDevelopmentCharacter(w,c,'basic',{directory:dir,persist:()=>write(w),media:file=>mediaFile(w,file)});w.message='Original image saved to Characters.';
 }else if(action==='attach-player-voice'){
  const c=candidate(w,data.character);
  const owner=w.libraryOwner||w.owner;
  if(!c.globalId||!data.confirm)throw new RequestError('Save the Character Card and confirm the voice first.',409);
  const choice=String(data.voice||'');
  const sample=w.voices.find(voice=>voice.id===choice);
  if(sample?.combined)throw new RequestError('Overlapping or unseparated speech cannot be attached. Choose another sample.',400);
  const voice=sample ? {path:path.join(dir,sample.file), name:sample.name} : resolveCharacterRefVoice(owner,choice);
  const saved=await snapshotCharacterRefVoice(owner,c.globalId,voice);
  if(!updateCharacterVoiceSelection(owner,c.globalId,{referenceAudioPath:saved.path,voiceEngineUsed:'reference-audio'}))throw new RequestError('Character Card unavailable.',404);
  c.voiceId=choice;c.voiceReviewed=true;
  w.message='Voice added to the saved Character Card.';
 }else if(action==='approve'){
  const c=candidate(w,data.character);if(c.views.length!==4||c.views.some(v=>v.state!=='ready'||!v.file))throw new RequestError('Wait for all four reconstructed views, then review them.',409);c.approved=true;
 }else if(action==='voice-region'){
  const start=Number(data.start),end=Number(data.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>w.duration||end-start<.5||end-start>30)throw new RequestError('Choose 0.5–30 seconds inside the soundtrack.',400);const vid=randomUUID(),file=vid+'.wav';await run('ffmpeg',['-v','error','-nostdin','-n','-ss',String(start),'-i',path.join(dir,'source.mp4'),'-t',String(end-start),'-vn','-ac','1','-ar','32000','-c:a','pcm_s16le',path.join(dir,file)],{timeout:45000});let sampleFile=file,sampleDuration=end-start,segments:Voice["segments"]=[{start,end,file}],groupName='Voice '+(w.voices.length+1)+' · manual region';if(data.group){const group=w.voices.find(v=>v.id===data.group);if(!group||group.duration+end-start>30)throw new RequestError('Choose a group with a combined duration under 30 seconds.',400);const combined=vid+'-group.wav';await run('ffmpeg',['-v','error','-nostdin','-n','-i',path.join(dir,group.file),'-i',path.join(dir,file),'-filter_complex','[0:a]aresample=32000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[a];[1:a]aresample=32000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]','-map','[out]','-c:a','pcm_s16le',path.join(dir,combined)],{timeout:45000});sampleFile=combined;sampleDuration+=group.duration;segments=[...group.segments,{start,end,file}];groupName=group.name+' · manually regrouped';}w.voices.push({id:vid,name:groupName,file:sampleFile,duration:sampleDuration,segments,combined:true,warning:'Unseparated soundtrack region. Confirm that only the intended voice is audible; overlapping voices and background remain.'});
 }else if(action==='assign-voice'){
  const c=candidate(w,data.character);if(!c.approved)throw new RequestError('Approve appearance before assigning a voice.',409);const v=data.voice? w.voices.find(v=>v.id===data.voice):null;if(data.voice&&!v)throw new RequestError('Voice sample not found.',404);if(v&&(v.duration<2||v.duration>30.05))throw new RequestError('Voice references must be 2–30 seconds. Select another sample or a longer clean region.',400);c.voiceId=v?.id||null;c.voiceReviewed=true;delete c.card;if(c.bundle)c.priorBundles=[...(c.priorBundles||[]),c.bundle];delete c.bundle;
 }else if(action==='save'){
  const c=candidate(w,data.character);if(!c.selected||!c.approved||!c.voiceReviewed)throw new RequestError('Approve appearance and explicitly attach a voice or choose No Voice.',409);if(!['card','refmod','both'].includes(String(data.target)))throw new RequestError('Choose a save option.',400);const voice=w.voices.find(v=>v.id===c.voiceId);const metadata={sourceVideo:{workspace:w.id,sha256:w.sourceSha256,name:w.sourceName},productionId:w.productionId,alternateForms:c.alternateForms,approvedImages:c.views.map(v=>({file:v.file,angle:v.angle,origin:'AI reconstructed',prompt:v.prompt,seed:v.seed})),sourceFrame:c.frame,sourceReferences:c.views[0]?.references,manualVoiceAssignment:true,voice:voice?{...voice,sha256:await digest(path.join(dir,voice.file))}:null};
  if(data.target!=='refmod'){
   const cardId=c.card||randomUUID();await fs.writeFile(path.join(dir,cardId+'.card.json'),JSON.stringify({id:cardId,name:c.name,description:c.description,images:c.views,voice,metadata,visibility:'source-production-private',approvedAt:new Date().toISOString()}),{mode:0o600});c.card=cardId;
   if(data.global===true&&!c.globalId){const characterId=randomUUID();const existing=loadCharacter(w.libraryOwner||w.owner,characterId);c.globalId=(existing||createCharacter(w.libraryOwner||w.owner,{id:characterId,name:c.name,imagePath:path.join(dir,c.views.find(v=>v.angle==='front')!.file!),description:c.description,referenceAudioPath:voice?path.join(dir,voice.file):undefined,source:'video-character-prototype',metadata})).id;}
  }
  if (data.target !== 'card' && !c.bundle) {
    if (!mediaQueueEnabled()) throw new RequestError("Shared GPU scheduler unavailable.", 503);
    await queueExtractionBundle(w, c, dir, () => write(w));
  }
  w.message='Saved privately to this video/production. RefMod is ready only after encoder validation.';
 }else throw new RequestError('Unknown prototype action.',400);
 return write(w);
}
export function present(w:Workspace){
 const owner=w.libraryOwner||w.owner,savedCharacters:NonNullable<Workspace['savedCharacters']>={};
 for(const c of w.candidates){const saved=c.globalId?loadCharacter(owner,c.globalId):null;if(!saved)continue;
  const url=(file:string)=>'/api/file?path='+encodeURIComponent(file);
  savedCharacters[c.id]={id:saved.id,name:saved.name,imageUrl:url(saved.imagePath),voiceName:saved.referenceAudioPath?saved.name+' — saved voice':undefined,voiceProvider:saved.voiceEngineUsed,voiceAudioUrl:saved.referenceAudioPath?url(saved.referenceAudioPath):undefined};
 }
 return {...w,savedCharacters,voiceChoices:w.libraryOwner?characterRefVoiceChoices(w.libraryOwner):undefined,owner:undefined,analysis:undefined,sourceRefs:undefined,libraryOwner:undefined};
}
