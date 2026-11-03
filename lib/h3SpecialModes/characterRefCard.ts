import fs from "node:fs/promises";
import {createReadStream,constants as fsConstants} from "node:fs";
import path from "node:path";
import {createHash, randomInt, randomUUID} from "node:crypto";
import sharp from "sharp";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {RequestError} from "@/lib/requestError";
import {type MediaGpuChoice, type MediaGpu, mediaGpuCandidates} from "@/lib/mediaGpuRouting";
import {nativeImageBackendUrls, chooseNativeImageBackend} from "@/lib/images/nativeImageBackend";
import {buildNativeImageGraph} from "@/lib/images/nativeImageModels";
import {nativeImageJobFile, writeNativeImageJob, reconcileNativeImageJob} from "@/lib/images/nativeImageJobs";
import {enqueueMediaJob, getMediaQueueJob, mediaQueueEnabled, preferMediaGpu} from "@/lib/workers/mediaGpuQueue";
import {uploadH3InputToBaseUrl} from "@/lib/production/h3Comfy";
import {prepareLabImage} from "@/lib/experiments/images";
import {MAX_LAB_IMAGE_BYTES} from "@/lib/experiments/imageTypes";
import {buildH3RefModVisualPackWorkflow, buildH3RefModCharacterVoiceWorkflow} from "./refModCreationWorkflow";
import {assertCharacterRefVoiceEnabled, characterRefVoiceEnabled, snapshotCharacterRefVoice, assertCharacterRefVoiceIntact, verifyCharacterVoiceBundle} from "./characterRefVoice";
import type {CharacterRefVoice} from "./characterRefCardContract";
import {writeH3RefModSidecar} from "./refModCreation";
import {createCharacter, listCharacters, loadCharacter, updateCharacterVoiceSelection} from "@/lib/characters/store";
import {resolveComfyPhysicalGpu} from "@/lib/workers/clusterGpu";
import {characterRefOwnerHash} from "./characterRefCardAccess";
import {CHARACTER_REF_VIEWS, CHARACTER_REF_PREFIX, characterRefViewPrompt, type CharacterRefAngle, type CharacterRefCardPublic} from "./characterRefCardContract";
import {characterRefCardsEnabled} from "./characterRefCardAvailability";

type Asset = {id: string; label: string; file?: string; original?: string; angle?: CharacterRefAngle; nativeId?: string; seed?: number; baseUrl?: string; gpu?: MediaGpu; state: string; error?: string};
export type CharacterRefCard = Omit<CharacterRefCardPublic, "views" | "original" | "voice"> & {ownerKey: string; original: Asset | null; views: Asset[]; voice?: CharacterRefVoice | null; encode?: {id: string; baseUrl?: string; gpu?: MediaGpu; libraryName?: string; count: number}; previewPath?: string};
const root = () => path.join(OTG_DATA_ROOT, "h3-character-refcards");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function id(value: string) {if (!uuid.test(value)) throw new RequestError("Invalid card identifier.", 400); return value;}
export function assertCharacterRefCardsEnabled() {if (!characterRefCardsEnabled()) throw new RequestError("Not found.",404);}
const directory = (owner: string, cardId: string) => path.join(root(), safeSegment(owner), id(cardId));
const filename = (owner: string, cardId: string) => path.join(directory(owner,cardId), "card.json");
type Coordinator = {timer?: ReturnType<typeof setInterval>; locks: Map<string,Promise<unknown>>; ticking: boolean};
const globals = globalThis as typeof globalThis & {__otgRefCards?: Coordinator};
const state = (): Coordinator => globals.__otgRefCards ||= {locks:new Map(),ticking:false};
export async function withCharacterRefCard<T>(owner: string, cardId: string, task: () => Promise<T>): Promise<T> {
  const locks=state().locks, key=filename(owner,cardId), before=locks.get(key)||Promise.resolve();
  const run=before.catch(()=>{}).then(task); locks.set(key,run);
  try{return await run;}finally{if(locks.get(key)===run)locks.delete(key);}
}
async function save(card: CharacterRefCard) {
  card.revision++; card.updatedAt=new Date().toISOString();
  const file=filename(card.ownerKey,card.id); await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=file+"."+randomUUID()+".tmp";
  await fs.writeFile(temporary,JSON.stringify(card),{mode:0o600}); await fs.rename(temporary,file); return card;
}
export async function readCharacterRefCard(owner: string, cardId: string) {
  let card: CharacterRefCard;
  try{const file=filename(owner,cardId); const stat=await fs.lstat(file); if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw Error(); card=JSON.parse(await fs.readFile(file,"utf8"));}
  catch(error){if(error instanceof RequestError)throw error;throw new RequestError("Character reference card not found.",404);}
  if(card.ownerKey!==owner||card.id!==cardId)throw new RequestError("Character reference card not found.",404);
  return card;
}
export async function latestCharacterRefCard(owner: string, characterId?: string) {
  const entries=await fs.readdir(path.join(root(),safeSegment(owner)),{withFileTypes:true}).catch(()=>[]);
  const cards=await Promise.all(entries.filter(e=>e.isDirectory()&&uuid.test(e.name)).map(e=>readCharacterRefCard(owner,e.name).catch(()=>null)));
  return cards.filter((c):c is CharacterRefCard=>!!c&&(!characterId||c.characterId===characterId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]||null;
}
export async function createCharacterRefCard(owner: string, cardId: string) {
  assertCharacterRefCardsEnabled(); id(cardId);
  return withCharacterRefCard(owner,cardId,async()=>{
    try{return await readCharacterRefCard(owner,cardId);}catch(error){if((error as RequestError).status!==404)throw error;}
    return save({id:cardId,ownerKey:owner,revision:0,name:"",description:"",characterId:"",mode:"single",gpu:"auto",state:"draft",message:"Add one image or 4–8 reference images.",error:"",original:null,views:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  });
}
export function characterRefCardPublic(card: CharacterRefCard): CharacterRefCardPublic {
  const url=(asset:Asset)=>`/api/h3/special/refmods/character-card?id=${card.id}&asset=${asset.id}`;
  return {id:card.id,revision:card.revision,name:card.name,description:card.description,characterId:card.characterId,mode:card.mode,gpu:card.gpu,state:card.state,createdAt:card.createdAt,updatedAt:card.updatedAt,message:card.message,error:card.error,libraryName:card.libraryName,backend:card.backend,tokenCount:card.tokenCount,voiceEnabled:characterRefVoiceEnabled(),voice:card.voice?{id:card.voice.id,name:card.voice.name,durationSeconds:card.voice.durationSeconds,url:`/api/h3/special/refmods/character-card?id=${card.id}&voice=${card.voice.id}`}:null,original:card.original?{id:card.original.id,url:url(card.original)}:null,views:card.views.map(a=>({id:a.id,label:a.label,angle:a.angle,state:a.state,error:a.error,seed:a.seed,gpu:a.gpu,...(a.file?{url:url(a)}:{})})),...(card.previewPath?{previewUrl:`/api/h3/special/refmods/character-card?id=${card.id}&preview=1`}:{})};
}
export async function attachCharacterRefVoice(owner: string, cardId: string, revision: unknown, source: {path: string; name: string; sourceId?: string} | null) {
  assertCharacterRefCardsEnabled(); assertCharacterRefVoiceEnabled();
  return withCharacterRefCard(owner, cardId, async () => {
    const card = await readCharacterRefCard(owner, cardId); checkCharacterRefRevision(card, revision); mutable(card);
    if(card.encode&&["unknown","queued","running","dispatching"].includes(getMediaQueueJob(card.encode.id)?.status||""))throw new RequestError("Check the original encoding job before changing its voice; it has not been duplicated.",409);
    const voice = source ? await snapshotCharacterRefVoice(owner, cardId, source) : null;
    invalidateEncoding(card); card.voice = voice; card.error = "";
    card.message = voice ? "Voice saved. Approve the images to save one character + voice RefMod." : "Voice removed from this draft. Previously saved RefMods are unchanged.";
    return save(card);
  });
}
export async function prepareCharacterRefFiboAnchor(source:string){
  const anchor=source+".fibo-portrait.png";
  // TextEncodeFibo2 center-crops to the output ratio. Letterbox first so wide
  // source images keep their complete character instead of losing edge details.
  const temporary=anchor+"."+randomUUID()+".tmp";
  try{await sharp(source).resize(768,1344,{fit:"contain",background:"#dedde8"}).png().toFile(temporary);await fs.rename(temporary,anchor);}finally{await fs.rm(temporary,{force:true});}
  return anchor;
}
function mutable(card:CharacterRefCard) {if(["generating","encoding"].includes(card.state))throw new RequestError("Wait for the current operation to finish; the draft is saved.",409);}
function invalidateEncoding(card:CharacterRefCard){delete card.encode;delete card.libraryName;delete card.backend;delete card.previewPath;delete card.tokenCount;card.state="review";}
export function checkCharacterRefRevision(card:CharacterRefCard, revision:unknown) {if(card.revision!==revision)throw new RequestError("This card changed in another window. Refresh before editing.",409);}
async function fileHash(file:string){const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex");}
async function imageFile(card:CharacterRefCard, assetId:string, source:Uint8Array|{file:string}) {
  id(assetId);
  const isFile=!(source instanceof Uint8Array),stat=isFile?await fs.lstat(source.file):null;
  if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw new RequestError("Invalid source image.",400);
  const size=isFile?stat!.size:source.length;
  if(!size||size>MAX_LAB_IMAGE_BYTES)throw new RequestError("Choose a non-empty image up to 512 MiB.",413);
  const folder=path.join(OTG_DATA_ROOT,"uploads","characters",safeSegment(card.ownerKey),"refcard-"+card.id,assetId); await fs.mkdir(folder,{recursive:true,mode:0o700});
  const original=path.join(folder,"original.media");
  const digest=isFile?await fileHash(source.file):createHash("sha256").update(source).digest("hex");
  try{if(isFile){await fs.copyFile(source.file,original,fsConstants.COPYFILE_EXCL);await fs.chmod(original,0o600);}else await fs.writeFile(original,source,{flag:"wx",mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;if(await fileHash(original)!==digest)throw new RequestError("Upload identifier already belongs to a different image.",409);}
  if(await fileHash(original)!==digest)throw new RequestError("The source changed during upload. Retry using the original file.",409);
  const prepared=await prepareLabImage(original,digest);
  return {original,file:prepared.file};
}
export async function uploadCharacterRefAsset(owner:string,cardId:string,assetId:string,bytes:Uint8Array|{file:string},label:string,role:"original"|"view",replaceId?:string) {
  assertCharacterRefCardsEnabled();
  return withCharacterRefCard(owner,cardId,async()=>{
    const card=await readCharacterRefCard(owner,cardId);mutable(card);
    const already=role==="original"?card.original?.id===assetId:card.views.some(a=>a.id===assetId);if(already)return card;
    if(role==="original"&&card.views.length)throw new RequestError("Start a new card to change the original after creating views. Your current images are kept.",409);
    if(role==="view"&&!replaceId&&card.views.length>=8)throw new RequestError("Use 4–8 references for this card.",400);
    const old=replaceId?card.views.find(a=>a.id===replaceId):null;if(replaceId&&!old)throw new RequestError("Reference not found.",404);
    const files=await imageFile(card,assetId,bytes);const asset:Asset={...files,id:assetId,label:label.slice(0,140)||"Reference image",state:"ready",...(old?.angle?{angle:old.angle}:{})};
    invalidateEncoding(card);
    if(role==="original")card.original=asset;else if(old)card.views=card.views.map(a=>a.id===old.id?asset:a);else card.views.push(asset);
    card.state="review";card.error="";card.message="Images saved. Review before creating the RefMod.";return save(card);
  });
}
export async function editCharacterRefCard(owner:string,cardId:string,data:Record<string,unknown>) {
  assertCharacterRefCardsEnabled();
  return withCharacterRefCard(owner,cardId,async()=>{
    const card=await readCharacterRefCard(owner,cardId);checkCharacterRefRevision(card,data.revision);mutable(card);
    if(data.action==="settings"){
      const name=String(data.name||"").trim(),description=String(data.description||"").trim(),characterId=String(data.characterId||"");
      if(name.length>96||description.length>2000||!["single","upload"].includes(String(data.mode))||!["auto","rtx3090","rtx5060ti"].includes(String(data.gpu)))throw new RequestError("Invalid character card settings.",400);
      if(characterId&&!loadCharacter(owner,characterId))throw new RequestError("Character not found for this account.",404);
      if(card.state==="completed"&&(card.name!==name||card.description!==description||card.characterId!==characterId))invalidateEncoding(card);
      card.name=name;card.description=description;card.characterId=characterId;card.mode=data.mode as CharacterRefCard["mode"];card.gpu=data.gpu as MediaGpuChoice;
    }else if(data.action==="remove"){
      if(card.original?.id===data.asset){if(card.views.length)throw new RequestError("Keep the original for regenerating these views, or start a new card.",409);card.original=null;}
      else card.views=card.views.filter(a=>a.id!==data.asset);
      invalidateEncoding(card);
    }
    else if(data.action==="reorder"){
      const order=data.order as string[];if(!Array.isArray(order)||order.length!==card.views.length||new Set(order).size!==order.length||order.some(v=>!card.views.some(a=>a.id===v)))throw new RequestError("Invalid reference order.",400);
      card.views=order.map(v=>card.views.find(a=>a.id===v)!);
      invalidateEncoding(card);
    }else if(data.action==="generate"||data.action==="regenerate"){
      if(!card.name||!card.original?.file)throw new RequestError("Name the character and add a source image first.",400);
      invalidateEncoding(card);
      if(data.action==="generate"){
        if(card.views.length)throw new RequestError("This card already has references. Regenerate individual views or start a new card; nothing was replaced.",409);
        card.views=CHARACTER_REF_VIEWS.map(v=>({id:randomUUID(),label:v.label,angle:v.id,nativeId:randomUUID(),seed:randomInt(0,2**48-1),state:"queued"}));
      }else{
        const view=card.views.find(v=>v.id===data.asset);if(!view?.angle)throw new RequestError("Only generated views can be regenerated. Use Replace for uploaded images.",400);
        if(view.nativeId&&["unknown","queued","running","dispatching"].includes(getMediaQueueJob(view.nativeId)?.status||""))throw new RequestError("The original job is still active or unconfirmed. It has not been duplicated.",409);
        view.nativeId=randomUUID();view.seed=randomInt(0,2**48-1);view.file=undefined;view.baseUrl=undefined;view.state="queued";view.error=undefined;
      }
      card.state="generating";card.error="";card.message="Preparing four reference views with local FIBO 2.0 Turbo.";
    }else if(data.action==="resume"){
      if(card.state!=="attention")throw new RequestError("This card does not need recovery.",409);
      if(card.encode){
        const old=getMediaQueueJob(card.encode.id);
        if(old&&["failed","canceled"].includes(old.status))card.encode={id:randomUUID(),count:card.views.length};
        // Unknown jobs retain their ID: refresh only, never duplicate a render.
        card.state="encoding";
      }else card.state="generating";
      card.error="";
    }else if(data.action==="encode"){
      if(!card.name||card.views.length<4||card.views.length>8||card.views.some(v=>v.state!=="ready"||!v.file))throw new RequestError("Name the character and approve 4–8 completed images.",400);
      if(!card.characterId&&listCharacters(owner).some(c=>c.name.trim().toLocaleLowerCase()===card.name.toLocaleLowerCase()))throw new RequestError("That character name already exists. Choose the saved character or use a different name.",409);
      if(card.voice){assertCharacterRefVoiceEnabled();await assertCharacterRefVoiceIntact(card.voice);}
      card.encode={id:randomUUID(),count:card.views.length};card.state="encoding";card.error="";card.message="Queued to encode all approved references.";
    }else throw new RequestError("Unknown character card action.",400);
    return save(card);
  });
}
async function ensureViewJob(card:CharacterRefCard,view:Asset) {
  const jobId=view.nativeId!;let queue=getMediaQueueJob(jobId);
  if(!queue){
    const backend=view.baseUrl?{baseUrl:view.baseUrl,label:view.gpu!}:await chooseNativeImageBackend("fibo2-edit-turbo",card.gpu);
    view.baseUrl=backend.baseUrl;view.gpu=backend.label;await save(card);
    const anchor=await prepareCharacterRefFiboAnchor(card.original!.file!);
    const uploaded=await uploadH3InputToBaseUrl({baseUrl:backend.baseUrl,sourcePath:anchor,mediaType:"image",uploadName:"anchor-"+jobId,subfolder:"otg_refcards/"+card.id});
    const image="otg_refcards/"+card.id+"/"+uploaded;
    const prompt=characterRefViewPrompt(view.angle!,card.description),graph=buildNativeImageGraph({model:"fibo2-edit-turbo",image,prompt,width:768,height:1344,seed:view.seed!});
    graph["461"].inputs.filename_prefix=`SLR_${process.env.OTG_ENV === "prod" ? "PROD" : "TEST"}_RefCards/${characterRefOwnerHash(card.ownerKey)}/${card.id}/${view.id}`;
    const file=nativeImageJobFile(card.ownerKey,jobId);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
    await writeNativeImageJob(file,{id:jobId,model:"fibo2-edit-turbo",status:"queued",promptId:jobId,baseUrl:backend.baseUrl,width:768,height:1344,seed:view.seed!,createdAt:new Date().toISOString(),prompt});
    queue=enqueueMediaJob({id:jobId,gpu:backend.label,kind:"comfy",payload:{baseUrl:backend.baseUrl,body:{prompt:graph,prompt_id:jobId,client_id:jobId},workerId:"h3-refmods-card-view",preSubmitCleanup:null}});
  }
  const result=await reconcileNativeImageJob(card.ownerKey,jobId);
  if(result.status==="completed"&&result.imagePath){view.file=result.imagePath;view.state="ready";view.error=undefined;}
  else if(["failed","canceled","unknown"].includes(result.status)){view.state=result.status;view.error=result.error||"The original GPU result needs checking.";card.state="attention";card.error=view.error;}
  else view.state=queue.status==="queued"?"queued":"running";
}
async function encodeBackend(choice:MediaGpuChoice, withVoice=false) {
  const urls=nativeImageBackendUrls();const probes=await Promise.all(mediaGpuCandidates(choice,["rtx3090","rtx5060ti"]).map(async gpu=>{
    try{
      const [r,s]=await Promise.all(["/object_info","/system_stats"].map(endpoint=>fetch(urls[gpu]+endpoint,{signal:AbortSignal.timeout(12000)})));
      const info=await r.json(),stats=await s.json(),physical=resolveComfyPhysicalGpu(urls[gpu]);
      const expected=physical==="shawn-3090"?"rtx 3090":physical==="slr-5060"?"rtx 5060 ti":"unrecognized";
      const voiceReady=!withVoice||(["MiniMaxH3RefModMasterExtract","MiniMaxH3RefModBundleSave","MiniMaxH3RefModInspect","PreviewAny","LoadAudio"].every(n=>info[n])&&info.VAELoader?.input.required.vae_name[0].includes("minimax_h3_audio_vae_fp32.safetensors"));
      return voiceReady&&r.ok&&s.ok&&stats.devices?.some((d:{name?:string})=>String(d.name).toLowerCase().includes(expected))&&["MiniMaxH3RefModFolderLoader","MiniMaxH3RefModExtract","MiniMaxH3RefModSave","VAELoader"].every(n=>info[n])&&info.VAELoader.input.required.vae_name[0].includes("minimax_h3_video_vae_fp16.safetensors")?gpu:null;
    }catch{return null;}
  }));const gpu=await preferMediaGpu(probes.filter((p):p is MediaGpu=>!!p));if(!gpu)throw Error("No compatible H3 RefMod encoder is available on the selected GPU.");return {gpu,baseUrl:urls[gpu]};
}
async function finishCard(card:CharacterRefCard, entry:Record<string,unknown>) {
  const response=await fetch(card.encode!.baseUrl+"/refmods/library",{signal:AbortSignal.timeout(12000)});const library=await response.json();
  const item=Array.isArray(library)?library.find(e=>e.name===card.encode!.libraryName):null;
  if(!response.ok||!item||!Number.isFinite(item.tokens))throw Error("The saved RefMod could not be verified. Your source images are kept.");
  const members=card.voice?verifyCharacterVoiceBundle(entry,card.encode!.count,item.tokens):undefined;
  if(card.voice?item.kind!=="bundle":!Array.isArray(item.shape)||item.shape[0]!==card.encode!.count)throw Error("The saved RefMod did not retain all approved reference images. Your source images are kept.");
  // Card thumbnail is for the library only. The encoder receives separate PNGs.
  const tiles=await Promise.all(card.views.map(v=>sharp(v.file!).resize(384,512,{fit:"contain",background:"#181824"}).png().toBuffer()));
  const rows=Math.ceil(tiles.length/2),preview=path.join(OTG_DATA_ROOT,"uploads","characters",safeSegment(card.ownerKey),"refcard-"+card.id,"card-"+card.encode!.id+".png");
  await sharp({create:{width:768,height:rows*512,channels:3,background:"#181824"}}).composite(tiles.map((input,i)=>({input,left:(i%2)*384,top:Math.floor(i/2)*512}))).png().toFile(preview);
  if(!card.characterId){
    const existing=loadCharacter(card.ownerKey,card.id);
    card.characterId=(existing||createCharacter(card.ownerKey,{id:card.id,name:card.name,imagePath:card.views.find(v=>v.angle==="front")?.file||card.views[0].file!,originalSourceImagePath:card.original?.original,characterCardPath:preview,description:card.description,source:"h3-refmod-card",metadata:{refModLibraryName:item.name,refModBackend:card.encode!.gpu,refModViews:card.views.map(v=>({path:v.file,label:v.label})),refModCardId:card.id}})).id;
  }
  if(card.voice)updateCharacterVoiceSelection(card.ownerKey,card.characterId,{referenceAudioPath:card.voice.path,metadata:{refModVoiceId:card.voice.id,refModVoiceSha256:card.voice.sha256}});
  const now=new Date().toISOString();writeH3RefModSidecar({version:1,libraryName:item.name,name:card.name,category:"character",subfolder:item.name.split("/").slice(0,-1).join("/"),sourceType:"otg-created",createdAt:now,updatedAt:now,jobId:card.id,ownerKey:card.ownerKey,characterId:card.characterId,description:card.description,savedPath:item.path||null,cardPreviewPath:preview,...(card.voice?{voice:card.voice,members}:{}),sourceAssets:[...card.views.map(v=>({name:v.label,kind:"image" as const,path:v.file!})),...(card.voice?[{name:card.voice.name,kind:"audio" as const,path:card.voice.path,durationSeconds:card.voice.durationSeconds}]:[])]});
  card.previewPath=preview;card.libraryName=item.name;card.backend=card.encode!.gpu;card.tokenCount=item.tokens;card.state="completed";card.message="Character RefMod saved. Ready to use in H3.";card.error="";
  void entry;
}
export async function advanceCharacterRefCard(owner:string,cardId:string) {
  assertCharacterRefCardsEnabled();
  return withCharacterRefCard(owner,cardId,async()=>{
    const card=await readCharacterRefCard(owner,cardId);if(!["generating","encoding"].includes(card.state))return card;
    try{
      if(!mediaQueueEnabled())throw Error("The shared GPU queue must be enabled; no unqueued work was submitted.");
      if(card.state==="generating"){
        const view=card.views.find(v=>v.state!=="ready");if(view)await ensureViewJob(card,view);
        const done=card.views.filter(v=>v.state==="ready").length;card.message=`Reference views · ${done} of ${card.views.length} ready`;
        if(done===card.views.length){card.state="review";card.message="Four views ready. Review them, then create the RefMod.";}
      }else{
        const encoding=card.encode!;let queue=getMediaQueueJob(encoding.id);
        if(!queue){
          if(!encoding.baseUrl){const backend=await encodeBackend(card.gpu,!!card.voice);encoding.baseUrl=backend.baseUrl;encoding.gpu=backend.gpu;encoding.libraryName=CHARACTER_REF_PREFIX+characterRefOwnerHash(owner)+"/"+card.id+"/"+encoding.id;await save(card);}
          const folder="otg_refcards/"+card.id+"/"+encoding.id;
          for(let i=0;i<card.views.length;i++)await uploadH3InputToBaseUrl({baseUrl:encoding.baseUrl!,sourcePath:card.views[i].file!,mediaType:"image",uploadName:String(i+1).padStart(2,"0"),subfolder:folder});
          const parts=encoding.libraryName!.split("/"),input={folder,name:parts.pop()!,subfolder:parts.join("/"),kind:"character" as const,sourceCount:card.views.length,description:card.name+". "+card.description};
          let built=buildH3RefModVisualPackWorkflow(input);
          if(card.voice){
            assertCharacterRefVoiceEnabled();await assertCharacterRefVoiceIntact(card.voice);
            // Audio stays outside the folder loader's visual input directory.
            const voiceFolder=folder+"-voice",audio=await uploadH3InputToBaseUrl({baseUrl:encoding.baseUrl!,sourcePath:card.voice.path,mediaType:"audio",uploadName:"voice",subfolder:voiceFolder});
            built=buildH3RefModCharacterVoiceWorkflow({...input,audioFilename:voiceFolder+"/"+audio});
          }
          queue=enqueueMediaJob({id:encoding.id,gpu:encoding.gpu!,kind:"comfy",payload:{baseUrl:encoding.baseUrl!,body:{prompt:built.graph,prompt_id:encoding.id,client_id:encoding.id},workerId:"h3-refmods-card-encode",preSubmitCleanup:null}});
        }
        if(["failed","canceled","unknown"].includes(queue.status))throw Error(queue.error||`RefMod encoding ${queue.status}; no duplicate job was submitted.`);
        card.message=queue.status==="queued"?"Queued for "+(encoding.gpu==="rtx3090"?"RTX 3090":"RTX 5060 Ti"):"Encoding all "+encoding.count+" approved images…";
        if(queue.status==="completed"){
          const r=await fetch(encoding.baseUrl+"/history/"+encoding.id,{signal:AbortSignal.timeout(12000)});const history=await r.json();if(!r.ok||!history[encoding.id]?.status?.completed)throw Error("The encoder has not returned a verified completion receipt.");
          await finishCard(card,history[encoding.id]);
        }
      }
    }catch(error){card.state="attention";card.error=(error as Error).message;card.message="Your images and completed results are saved.";}
    return save(card);
  });
}
export function bootstrapCharacterRefCards() {
  if(!characterRefCardsEnabled()||state().timer)return;
  const tick=async()=>{
    if(state().ticking)return;state().ticking=true;
    try{for(const owner of await fs.readdir(root(),{withFileTypes:true}).catch(()=>[]))if(owner.isDirectory())for(const dir of await fs.readdir(path.join(root(),owner.name),{withFileTypes:true}))if(dir.isDirectory()&&uuid.test(dir.name)){
      const card=await (async()=>{
        const file=path.join(root(),owner.name,dir.name,"card.json"),stat=await fs.lstat(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)return null;
        const candidate=JSON.parse(await fs.readFile(file,"utf8"));
        if(typeof candidate.ownerKey!=="string"||safeSegment(candidate.ownerKey)!==owner.name)return null;
        return readCharacterRefCard(candidate.ownerKey,dir.name);
      })().catch(()=>null);
      if(card&&["generating","encoding"].includes(card.state))await advanceCharacterRefCard(card.ownerKey,card.id).catch(()=>{});
    }}finally{state().ticking=false;}
  };
  state().timer=setInterval(()=>{void tick().catch(()=>{});},3000);state().timer!.unref();void tick().catch(()=>{});
}
export function closeCharacterRefCardsForTests(){if(state().timer)clearInterval(state().timer);delete globals.__otgRefCards;}
