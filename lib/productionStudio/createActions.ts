import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { OTG_DATA_ROOT,safeSegment } from "@/lib/paths";
import type { StudioStore } from "./store";
import { CreateError, requireCurrentManifest,changeCreate } from "./createManifest";
import { assertAssetIntact, snapshotFile, probe } from "./media";
import { createCharacter } from "@/lib/characters/store";
import { createCharacterRefCard, readCharacterRefCard, characterRefCardPublic, editCharacterRefCard, uploadCharacterRefAsset, attachCharacterRefVoice, bootstrapCharacterRefCards } from "@/lib/h3SpecialModes/characterRefCard";
import { importCatalogAsset } from "./catalog";

export async function validateCreateAssets(s: StudioStore, owner: string, project: string, operation: Record<string,unknown>) {
  const p = s.get(owner,project), item = p.creation?.items.find(i=>i.id===operation.itemId);
  if(item?.refCardId&&["create.appearance","create.voice","create.delete"].includes(String(operation.type))){const card=await readCharacterRefCard(owner,item.refCardId);if(["generating","encoding"].includes(card.state))throw new CreateError("Wait for this character's active RefMod operation before changing or removing its source identity.",409);}
  const ids = operation.type === "create.save" && item ? [item.assetId,...item.referenceIds,item.voiceId,item.refModId] : [operation.assetId];
  for (const id of new Set(ids.filter(Boolean) as string[])) {
    const entry = await assertAssetIntact(s,owner,project,id);
    if (entry.asset.kind === "refmod") {
      const file = await fs.open(entry.path,"r");
      try {
        const prefix=Buffer.alloc(8); await file.read(prefix,0,8,0); const n=Number(prefix.readBigUInt64LE());
        if (!Number.isSafeInteger(n) || n<2 || n>16*1024*1024 || n+8>=entry.asset.bytes) throw new Error("header");
        const bytes=Buffer.alloc(n); await file.read(bytes,0,n,8); const header=JSON.parse(bytes.toString());
        const tensors=Object.entries(header).filter(([k])=>k!=="__metadata__").map(([,v])=>v as {data_offsets:number[];shape:number[]});
        if (!tensors.length || tensors.some(v=>!Array.isArray(v.shape)||!Array.isArray(v.data_offsets)||v.data_offsets.length!==2||v.data_offsets[0]<0||v.data_offsets[1]<=v.data_offsets[0]||v.data_offsets[1]+n+8>entry.asset.bytes)) throw new Error("tensor");
      } catch { throw new CreateError("The RefMod bundle is incomplete or unreadable. Its thumbnail cannot be used as a replacement."); } finally { await file.close(); }
    } else {
      const info = await probe(entry.path);
      if (entry.asset.kind === "audio" ? !info.streams.some(v=>v.codec_type==="audio") || !(Number(info.format.duration)>0) : !info.streams.some(v=>v.codec_type==="video")) throw new CreateError("This media cannot be decoded. Replace or retry the source before approving it.");
    }
  }
}
export async function createAction(s: StudioStore, owner: string, project: string, b: Record<string,unknown>) {
  const p=s.get(owner,project); if (p.revision!==b.revision) throw new CreateError("Creation changed. Reload the latest saved version before continuing.",409);
  const m=requireCurrentManifest(p), item=m.items.find(i=>i.id===b.itemId);
  if(!item) throw new CreateError("Creation item not found.",404);
  const unchanged=()=>{if(s.get(owner,project).revision!==p.revision)throw new CreateError("This production changed while preparing the asset. Your candidate is kept; reload before selecting it.",409);};
  if(b.action==="save-character") {
    if(item.kind!=="character"||!item.assetId)throw new CreateError("Choose a character appearance first.");
    changeCreate(structuredClone(p),{type:"create.save",itemId:item.id},id=>s.asset(owner,project,id).asset);
    await validateCreateAssets(s,owner,project,{type:"create.save",itemId:item.id}); unchanged();
    const selected=s.asset(owner,project,item.assetId), voice=item.voiceId?s.asset(owner,project,item.voiceId):undefined, bundle=item.refModId?s.asset(owner,project,item.refModId):undefined;
    const character=await snapshotFile(s,owner,project,selected.path,item.name,"character",{...selected.asset.metadata,description:item.prompt,imageIds:item.referenceIds,voiceId:item.voiceId,bundleId:item.refModId,refModName:bundle?.asset.metadata.libraryName,sourceRequirementId:item.id,sourceStoryKey:m.storyKey});
    unchanged();
    let libraryId=item.savedLibraryId;
    if(b.saveToLibrary===true && !libraryId){
      const name=String(b.libraryName||item.name).trim();
      const copyId=randomUUID(),folder=path.join(OTG_DATA_ROOT,"characters",safeSegment(owner),"production-copies",copyId);
      await fs.mkdir(folder,{recursive:true,mode:0o700});
      const copy=async(id:string)=>{const a=await assertAssetIntact(s,owner,project,id),dest=path.join(folder,a.asset.id+path.extname(a.path));try{await fs.copyFile(a.path,dest,constants.COPYFILE_EXCL);await fs.chmod(dest,0o600);}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}return dest;};
      const image=await copy(item.assetId),referencePaths=await Promise.all(item.referenceIds.map(copy)),voicePath=item.voiceId?await copy(item.voiceId):undefined;unchanged();
      // Keep arbitrary reference angles as a group. Never relabel a three-quarter view as a back view.
      try { libraryId=createCharacter(owner,{id:copyId,name,imagePath:image,defaultCharacterImagePath:image,description:item.prompt,voiceStyleDefinition:item.voiceDirection||"",referenceAudioPath:voicePath,introLine:String(voice?.asset.metadata.referenceText||voice?.asset.metadata.refText||""),source:"production-studio",metadata:{productionId:p.id,storyKey:m.storyKey,requirementId:item.id,productionReferencePaths:referencePaths,...(bundle?{refModLibraryName:bundle.asset.metadata.libraryName,refModBackend:bundle.asset.metadata.backend}:{})}}).id; }
      catch(error){throw new CreateError(error instanceof Error?error.message:"Could not save a new library character.",409);}
    }
    s.internalUpdate(owner,project,current=>{if(current.revision!==p.revision)throw new CreateError("Creation changed; retry saving the kept character candidate.",409);const i=requireCurrentManifest(current).items.find(i=>i.id===item.id)!;i.assetId=character.id;i.savedLibraryId=libraryId;i.step="save";});
    const latest=s.get(owner,project);return {project:s.mutate(owner,project,latest.revision,{type:"create.save",itemId:item.id}),asset:character};
  }
  if(item.kind!=="character"||!item.assetId)throw new CreateError("Approve the character appearance before creating a RefMod.");
  let card;
  if(b.action==="prepare-refmod") {
    if(item.refCardId) return {card:characterRefCardPublic(await readCharacterRefCard(owner,item.refCardId))};
    const source=await assertAssetIntact(s,owner,project,item.assetId); unchanged();
    card=await createCharacterRefCard(owner,randomUUID());
    card=await editCharacterRefCard(owner,card.id,{action:"settings",revision:card.revision,name:`${item.name.slice(0,60)} · ${p.id.slice(0,8)}-${card.id.slice(0,4)}`,description:item.prompt.slice(0,2000),mode:"single",gpu:"auto",characterId:""});
    card=await uploadCharacterRefAsset(owner,card.id,randomUUID(),{file:source.path},item.name,"original");
    // Existing reference views can be used directly; no forced re-generation.
    const seen=new Set<string>();
    const views=item.referenceIds.filter(id=>{const a=s.asset(owner,project,id).asset;if(a.kind!=="image"||seen.has(a.sha256))return false;seen.add(a.sha256);return true;});
    if(views.length>=4&&views.length<=8)for(const id of views){const a=await assertAssetIntact(s,owner,project,id);card=await uploadCharacterRefAsset(owner,card.id,randomUUID(),{file:a.path},a.asset.name,"view");}
    if(item.voiceId){const v=await assertAssetIntact(s,owner,project,item.voiceId);card=await attachCharacterRefVoice(owner,card.id,card.revision,{path:v.path,name:v.asset.name,sourceId:v.asset.id});}
    unchanged(); s.internalUpdate(owner,project,current=>{const i=requireCurrentManifest(current).items.find(i=>i.id===item.id)!;i.refCardId=card!.id;});
  } else {
    if(!item.refCardId)throw new CreateError("Prepare the character reference first.");
    card=await readCharacterRefCard(owner,item.refCardId);
    if(b.action==="pin-refmod"){
      if(card.state!=="completed"||!card.libraryName||!card.characterId)throw new CreateError("The complete RefMod bundle is not ready yet.");
      const character=await importCatalogAsset(s,owner,project,"character",card.characterId), bundleId=String(character.metadata.bundleId||"");
      await validateCreateAssets(s,owner,project,{assetId:bundleId}); unchanged();
      return {project:s.mutate(owner,project,p.revision,{type:"create.refmod",itemId:item.id,assetId:bundleId}),card:characterRefCardPublic(card)};
    }
    if(!["generate","encode","regenerate","resume"].includes(String(b.action))||b.approved!==true)throw new CreateError("Explicit approval is required for this RefMod action.");
    card=await editCharacterRefCard(owner,card.id,{action:b.action,revision:b.cardRevision,asset:b.asset}); bootstrapCharacterRefCards();
  }
  return {card:characterRefCardPublic(card),project:s.get(owner,project)};
}
