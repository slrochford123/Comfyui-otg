import fs from "node:fs";
import path from "node:path";
import {randomInt} from "node:crypto";
import {NextRequest} from "next/server";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {listCharacters, loadCharacter, createCharacter, updateCharacterVoiceSelection} from "@/lib/characters/store";
import {upsertVoice, voicesSamplesDir} from "@/lib/voicesStudio";
import {attachStoryVisualUpload,addStoryCreatorMessage,listStoryVisualAssets} from "./store";
import {contentTypeForMedia} from "@/lib/mediaResponse";
import {assertStoryMediaScope, claimStoryMedia, createStoryMedia, getStoryMedia, listStoryMedia, storyMediaByRequest, updateStoryMedia, type StoryMediaRecord} from "./mediaStore";
import {parseStoryMediaCommand} from "./mediaContract";
import {requireStoryMediaEnabled} from "./mediaAvailability";

export function requireStoryMediaTest() {
  requireStoryMediaEnabled();
}
export function storyMediaRoot(record: Pick<StoryMediaRecord,"ownerKey"|"projectId"|"id">) {
  return path.join(OTG_DATA_ROOT,"story-creator","generated",safeSegment(record.ownerKey),safeSegment(record.projectId),safeSegment(record.id));
}
function safeDataFile(file: string) {
  const root = fs.realpathSync(OTG_DATA_ROOT), resolved = fs.realpathSync(file), relative = path.relative(root,resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(resolved).isFile()) throw Error("Source is not available in protected app storage.");
  return resolved;
}
export function storyMediaFile(record: StoryMediaRecord) {
  if (!record.filePath || record.status !== "ready") throw Error("Media is not ready.");
  const file = safeDataFile(record.filePath), root = fs.realpathSync(storyMediaRoot(record));
  if (!file.startsWith(root+path.sep)) throw Error("Invalid media storage location.");
  return file;
}
export function storyMediaContext(ownerKey: string, projectId: string,query="") {
  const characters=listCharacters(ownerKey).sort((a,b)=>Number(query.toLowerCase().includes(b.name.toLowerCase()))-Number(query.toLowerCase().includes(a.name.toLowerCase())));
  return JSON.stringify({
    media:listStoryMedia(ownerKey,projectId).slice(0,20).map(r=>({id:r.id,name:r.command.name,operation:r.command.operation,status:r.status,description:r.command.prompt.slice(0,400),characterId:r.characterId})),
    characters:characters.slice(0,40).map(c=>({id:c.id,name:c.name,description:c.description?.slice(0,300),hasVoice:!!c.referenceAudioPath})),
  });
}
function sourceFor(record: StoryMediaRecord): {image?: string; voice?: string; name?: string; characterId?: string; refText?:string} {
  const sourceId = record.command.sourceId;
  if (!sourceId) return {};
  const character = loadCharacter(record.ownerKey,sourceId);
  if (character) return {image:safeDataFile(character.imagePath),voice:character.referenceAudioPath?safeDataFile(character.referenceAudioPath):undefined,
    name:character.name,characterId:character.id,refText:String(character.metadata?.storyVoiceText||character.introLine||"")};
  const source = getStoryMedia(record.ownerKey,record.projectId,sourceId);
  const file = storyMediaFile(source);
  if(record.command.operation==="voice"&&source.characterId) {
    const saved=loadCharacter(record.ownerKey,source.characterId);
    if(saved?.referenceAudioPath)return {voice:safeDataFile(saved.referenceAudioPath),name:saved.name,characterId:saved.id,refText:String(saved.metadata?.storyVoiceText||saved.introLine||"")};
  }
  return source.command.operation === "voice" ? {voice:file,name:source.command.name,characterId:source.characterId||undefined,refText:source.command.text}
    : ["image","edit"].includes(source.command.operation)?{image:file,name:source.command.name,characterId:source.characterId||undefined}:{};
}
export function requestStoryMedia(input: {ownerKey:string;projectId:string;sourceMessageId:string;arguments:unknown},requestKey?:string) {
  requireStoryMediaTest();
  const messages = assertStoryMediaScope(input.ownerKey,input.projectId);
  const source = messages.find(m=>m.id===input.sourceMessageId&&m.role==="user");
  if (!source) throw Error("Saved user request is missing.");
  const command = parseStoryMediaCommand(input.arguments,source.content);
  if (command.subject==="character" && command.name && !command.sourceId) {
    const matches=listCharacters(input.ownerKey).filter(c=>c.name.toLowerCase()===command.name.toLowerCase());
    if(matches.length>1)throw Error("More than one character has that name. Choose a character first.");
    if(matches.length===1)command.sourceId=matches[0].id;
  }
  if (command.subject === "character" && command.name) {
    const known = listCharacters(input.ownerKey).some(c=>c.name.toLowerCase()===command.name.toLowerCase())
      || listStoryMedia(input.ownerKey,input.projectId).some(r=>r.command.name.toLowerCase()===command.name.toLowerCase());
    // A historical user message may have named a character; assistant suggestions never do.
    if (!known && !messages.some(m=>m.role==="user"&&m.content.toLowerCase().includes(command.name.toLowerCase()))) command.name="";
  }
  if (command.operation==="edit" && !command.sourceId) throw Error("Which image should I edit? Choose Edit on the image you want.");
  if (command.operation==="voice"&&!command.text) throw Error("What should the character say? Include the exact dialogue.");
  if (command.sourceId) {
    const probe = {...input,command} as unknown as StoryMediaRecord;
    const media = sourceFor(probe);
    if (["edit","video"].includes(command.operation)&&!media.image) throw Error("Choose a ready image for this operation.");
    if (media.name && command.subject==="character")command.name=media.name;
    if(command.operation==="image"&&media.image)command.operation="edit";
  }
  return createStoryMedia({...input,command},requestKey);
}
/** Direct, explicit result-card action. The replay key survives a lost HTTP response. */
export function requestStoryMediaFromCard(ownerKey:string,projectId:string,body:Record<string,unknown>) {
  requireStoryMediaTest();assertStoryMediaScope(ownerKey,projectId);
  const requestKey=String(body.requestKey||"");
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey))throw Error("A stable request ID is required.");
  const existing=storyMediaByRequest(ownerKey,projectId,`ui:${requestKey}`);
  if(existing)return {record:existing,created:false};
  const sourceId=String(body.sourceId||"");
  const source=getStoryMedia(ownerKey,projectId,sourceId);
  storyMediaFile(source);
  const operation=String(body.operation||"");
  if(!["edit","video","voice"].includes(operation))throw Error("Choose Edit, Animate, or Voice.");
  const evidence=`Generate ${operation} for ${source.command.name||"this image"}.`;
  const command=parseStoryMediaCommand({operation,subject:source.command.subject,name:source.command.name,sourceId,
    prompt:String(body.prompt||""),text:String(body.text||""),evidence},evidence);
  const message=addStoryCreatorMessage({ownerKey,projectId,role:"user",content:`${evidence}\n${command.prompt}\n${command.text}`});
  return requestStoryMedia({ownerKey,projectId,sourceMessageId:message.id,arguments:command},`ui:${requestKey}`);
}
export function nameStoryMedia(record:StoryMediaRecord,name:string) {
  if(record.status!=="needs_name")return record;
  name=name.trim();if(!name||name.length>100)throw Error("Enter a character name (up to 100 characters).");
  if(listCharacters(record.ownerKey).some(c=>c.name.toLowerCase()===name.toLowerCase()))throw Error("That character already exists. Use its saved card instead of creating a duplicate.");
  addStoryCreatorMessage({ownerKey:record.ownerKey,projectId:record.projectId,role:"user",content:`Name this character ${name} and generate the requested ${record.command.operation}.`});
  return updateStoryMedia(record,{command:{...record.command,name},status:"queued"});
}
async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok || data.ok===false) {
    const error=Error(data.error || "Media worker refused this request.");
    if([400,401,403,404,413,415,422,429].includes(response.status))error.name="RejectedStoryMedia";
    throw error;
  }
  return data;
}
function internalRequest(route:string,cookie:string,body:FormData|Record<string,unknown>) {
  const headers:Record<string,string>={cookie};
  if (!(body instanceof FormData)) headers["content-type"]="application/json";
  // The legacy asset endpoint derives its local worker from this hostname.
  // Use the configured rendering host, never localhost or a user-supplied URL.
  const host=new URL(process.env.OTG_MEDIA_3090_IMAGE_URL||"http://100.75.162.64:8188").hostname;
  return new NextRequest(`http://${host}:3001${route}`,{method:"POST",headers,body:body instanceof FormData?body:JSON.stringify(body)});
}
/** One durable claim per request. Unknown submission is NEVER retried automatically. */
export async function executeStoryMedia(record:StoryMediaRecord,cookie:string) {
  requireStoryMediaTest();
  if (!claimStoryMedia(record)) return;
  record=getStoryMedia(record.ownerKey,record.projectId,record.id);
  try {
    const source=sourceFor(record), prompt=record.command.prompt;
    let backendJob:Record<string,any>;
    if(record.command.operation==="image") {
      const {POST}=await import("@/app/api/assets/create-image/route");
      backendJob=await responseJson(await POST(internalRequest("/api/assets/create-image",cookie,{
        model:"krea-2",name:record.command.name||"Story image",prompt,artStyle:"",visualKind:record.command.subject,persistOutput:true,
      })));
    } else if(record.command.operation==="edit") {
      if(!source.image)throw Error("Select a source image before editing.");
      const {POST}=await import("@/app/api/images/native/route");
      const form=new FormData();form.set("model","fibo2-edit-turbo");form.set("prompt",prompt);form.set("clientRequestId",record.id);
      form.set("image",new File([fs.readFileSync(source.image)],path.basename(source.image),{type:contentTypeForMedia(source.image)}));
      backendJob=await responseJson(await POST(internalRequest("/api/images/native",cookie,form)));
    } else if(record.command.operation==="video") {
      const {createH3DirectJob,validateH3DirectInput,startH3DirectJob}=await import("@/lib/h3DirectJobs");
      const {requestedH3MediaGpu}=await import("@/lib/mediaGpuRoutingServer");
      const ref=source.image?{path:source.image,name:source.name||"Story reference",description:source.name||"Selected image"}:null;
      const job=await createH3DirectJob(record.ownerKey,validateH3DirectInput({
        mode:ref?"h3-reference-to-video":"h3-text-to-video",quality:"sh",orientation:"landscape",durationSeconds:5,prompt,seed:randomInt(0,2**32),targetBackend:await requestedH3MediaGpu(),
        h3Settings:{renderMode:"turbo",checkpointMode:"fasth3",combatLoraEnabled:false,refMod:{enabled:false,strength:"balanced"},motionLab:{enabled:false}},
        optionalLoras:[],firstImage:null,lastImage:null,images:ref?[ref]:[],videos:[],audios:[],
      }));
      backendJob={id:job.id};
      record=updateStoryMedia(record,{backendJob,status:"running"});
      startH3DirectJob(job);return;
    } else {
      record=updateStoryMedia(record,{status:"running",backendJob:{engine:"qwen3",pid:process.pid}});
      const {generateStoryVoice}=await import("./mediaVoice");
      const file=await generateStoryVoice(record,source);
      await finishStoryMedia(record,file);return;
    }
    updateStoryMedia(record,{backendJob,status:"running"});
  } catch(error) {
    const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
    if(current.status==="canceled")return;
    updateStoryMedia(current,{status:error instanceof Error&&error.name==="AbortError"?"canceled":error instanceof Error&&error.name==="RejectedStoryMedia"?"failed":error instanceof Error&&error.name==="UnconfirmedStoryVoice"||current.status==="submitting"?"unknown":"failed",error:error instanceof Error?error.message:"Generation failed."});
  }
}
async function finishStoryMedia(record:StoryMediaRecord,file:string) {
  const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
  if(current.status!=="running")return current;
  const root=storyMediaRoot(record);fs.mkdirSync(root,{recursive:true,mode:0o700});
  const destination=path.join(root,`result${path.extname(file).toLowerCase()}`);
  if(path.resolve(file)!==destination)fs.copyFileSync(safeDataFile(file),destination);
  if(!fs.statSync(destination).size)throw Error("The worker returned an empty file.");
  if(["image","edit"].includes(record.command.operation)&&!listStoryVisualAssets(record).some(asset=>asset.metadata.storyMediaId===record.id)) attachStoryVisualUpload({ownerKey:record.ownerKey,projectId:record.projectId,
    visualKind:record.command.subject==="character"?"character":record.command.subject==="object"?"object":"scene_image",
    name:record.command.name||"Story image",prompt:record.command.prompt,url:`/api/story-creator/media/file?projectId=${record.projectId}&id=${record.id}`,filePath:destination,
    metadata:{storyMediaId:record.id,engine:record.command.operation==="image"?"krea-2":"fibo2-edit-turbo"}});
  return updateStoryMedia(current,{status:"ready",filePath:destination,error:null});
}
const refreshing = new Map<string,Promise<StoryMediaRecord>>();
export async function refreshStoryMedia(record:StoryMediaRecord):Promise<StoryMediaRecord> {
  if(record.status==="submitting"&&Date.now()-record.updatedAt>120_000)return updateStoryMedia(record,{status:"unknown",error:"Submission could not be confirmed. No duplicate job was sent; an administrator can inspect the original request."});
  if(record.status!=="running")return record;
  const key=`${record.ownerKey}:${record.id}`;
  if(refreshing.has(key))return refreshing.get(key)!;
  const task=(async()=>{
    const job=record.backendJob;
    if(!job)return record;
    if(record.command.operation==="image") {
      const {resolveComfyPromptImageStatus,candidateComfyImageBaseUrls}=await import("@/lib/comfyImageOutputLookup");
      const result=await resolveComfyPromptImageStatus({promptId:job.promptId,filters:{nodeId:job.outputNodeId},preferredBaseUrl:job.comfyBaseUrl,strictPreferred:true});
      if(result.status==="completed"&&result.image) {
        const {retrieveRemoteComfyMedia}=await import("./remoteComfyMedia");
        const file=await retrieveRemoteComfyMedia({baseUrl:result.baseUrl,trustedBaseUrls:candidateComfyImageBaseUrls(),file:result.image,
          storageRoot:storyMediaRoot(record),destinationPath:path.join(storyMediaRoot(record),"result.png"),kind:"image"});
        return finishStoryMedia(record,file.filePath);
      }
      if(["failed","missing_output"].includes(result.status))return updateStoryMedia(record,{status:"failed",error:result.error||"The worker finished without a usable image."});
    } else if(record.command.operation==="edit") {
      const {reconcileNativeImageJob}=await import("@/lib/images/nativeImageJobs");
      const result=await reconcileNativeImageJob(record.ownerKey,job.jobId);
      if(result.status==="completed"&&result.imagePath)return finishStoryMedia(record,result.imagePath);
      if(["failed","canceled"].includes(result.status))return updateStoryMedia(record,{status:result.status as "failed"|"canceled",error:result.error||null});
    } else if(record.command.operation==="video") {
      const {getH3DirectJob,ensureH3DirectJobRunner}=await import("@/lib/h3DirectJobs");
      const result=await getH3DirectJob(record.ownerKey,job.id);ensureH3DirectJobRunner(result);
      if(result?.status==="completed"&&result.outputPath) {
        try {
          const {finalizeStoryPreview}=await import("./mediaVideo");
          const root=storyMediaRoot(record);fs.mkdirSync(root,{recursive:true,mode:0o700});
          const file=await finalizeStoryPreview(safeDataFile(result.outputPath),path.join(root,"result.mp4"));
          return finishStoryMedia(record,file);
        } catch(error) {return updateStoryMedia(record,{status:"failed",error:error instanceof Error?error.message:"The video preview could not be prepared."});}
      }
      if(result&&["failed","canceled"].includes(result.status))return updateStoryMedia(record,{status:result.status as "failed"|"canceled",error:result.error});
    } else if(record.command.operation==="voice") {
      const {storyVoiceActive}=await import("./mediaVoice");
      if(!storyVoiceActive(record.id)&&job.pid!==process.pid)return updateStoryMedia(record,{status:"unknown",error:"The speech worker connection ended. No automatic retry was sent."});
    }
    return getStoryMedia(record.ownerKey,record.projectId,record.id);
  })();
  refreshing.set(key,task);try{return await task;}finally{refreshing.delete(key);}
}
export function saveStoryCharacter(record:StoryMediaRecord) {
  requireStoryMediaTest();
  if(record.characterId)return record;
  if(record.command.subject!=="character"||!["image","edit"].includes(record.command.operation)||!record.command.name)throw Error("Choose a named character image.");
  const image=storyMediaFile(record);
  const existing=listCharacters(record.ownerKey).find(c=>c.metadata?.storyMediaId===record.id);
  const character=existing||createCharacter(record.ownerKey,{id:`story-${record.id}`,name:record.command.name,imagePath:image,previewImagePath:image,
    description:record.command.prompt,characterCardPath:image,defaultCharacterImagePath:image,characterStatus:"complete",voiceStatus:"not_added",hasCustomVoice:false,
    source:"story-creator",metadata:{storyMediaId:record.id,storyProjectId:record.projectId}});
  return updateStoryMedia(record,{characterId:character.id});
}
export function saveStoryVoice(record:StoryMediaRecord,characterId?:string) {
  requireStoryMediaTest();
  if(record.command.operation!=="voice")throw Error("Choose a generated voice.");
  const file=storyMediaFile(record);
  const character=characterId?loadCharacter(record.ownerKey,characterId):null;
  if(characterId&&!character)throw Error("Character not found for this account.");
  const voiceId=record.voiceId||`${safeSegment(record.ownerKey)}__story_${record.id}`,dir=voicesSamplesDir(voiceId),target=path.join(dir,"ref.wav");
  fs.copyFileSync(file,target);
  upsertVoice(record.ownerKey,{voiceId,name:record.command.name||"Story voice",tags:["story-creator","qwen3"],type:record.command.sourceId?"cloned":"created",
    refText:record.command.text,refAudioRel:`samples/${voiceId}/ref.wav`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  if(character)updateCharacterVoiceSelection(record.ownerKey,character.id,{referenceAudioPath:target,voiceEngineUsed:"qwen3",metadata:{storyVoiceId:voiceId,storyVoiceText:record.command.text}});
  return updateStoryMedia(record,{voiceId,characterId:character?.id||record.characterId});
}
export async function cancelStoryMedia(record:StoryMediaRecord) {
  if(["ready","failed","canceled","unknown"].includes(record.status))return record;
  if(record.status==="submitting")throw Error("Checking the original submission. Wait for its job ID before canceling; no second job will run.");
  if(record.status==="running") {
    if(record.command.operation==="voice") {
      const {cancelStoryVoice}=await import("./mediaVoice");await cancelStoryVoice(record.id).catch(error=>{if(!String(error).includes("Speech canceled"))throw error;});
    } else if(record.command.operation==="video") {
      const {cancelH3DirectJob}=await import("@/lib/h3DirectJobs");const result=await cancelH3DirectJob(record.ownerKey,record.backendJob!.id);
      if(result.status!=="canceled")throw Error("Cancellation requested. Refresh to check the original video job.");
    } else {
      const {cancelComfyPrompt}=await import("@/lib/comfySafeCancel");
      const job=record.backendJob!;
      const result=await cancelComfyPrompt(job.comfyBaseUrl,job.promptId);
      if(result.status!=="canceled")throw Error("Cancellation is not yet confirmed. Refresh to check the original job.");
    }
  }
  return updateStoryMedia(record,{status:"canceled"});
}
