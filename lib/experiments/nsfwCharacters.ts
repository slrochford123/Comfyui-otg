import type {NextRequest} from "next/server";
import {requireSessionUser} from "@/lib/sessionUser";
import {loadCharacter} from "@/lib/characters/store";
import {h3CardImages} from "@/lib/h3CardReferences";
import {productionAudioMediaReadable} from "@/lib/productionAudioAccess";
import {studioFileSha256} from "@/lib/h3StudioMedia";
import {getAsset,getSession} from "./store";
import {RequestError} from "@/lib/requestError";
import {h3DeckVoicePlan} from "@/lib/h3CardReferencesServer";
import {exportLabJob} from "./generation";
import {withNsfwWorkspace} from "./availability";
import type {H3SmartReferenceInput} from "@/lib/h3SmartReferences";
/** Bind the raw approved image, before the worker's nondestructive resizing. */
export async function validateNsfwCharacters(request:NextRequest,owner:string,sessionId:string) {
 const user=await requireSessionUser(request),session=getSession(owner,sessionId);
 for(const [id,ref] of Object.entries(session.settings.referenceCharacters||{})){
  if(!session.settings.selectedSources?.includes(id))continue;
  const asset=getAsset(owner,id);const card=loadCharacter(user.ownerKey,ref.characterId),image=card&&h3CardImages(card).find(i=>i.id===ref.imageId);
  if(asset.asset.session!==sessionId||!asset.asset.mime.startsWith("image/")||!card||card.updatedAt!==ref.version||!image||!await productionAudioMediaReadable(request,image.path)||await studioFileSha256(image.path)!==asset.asset.sha256)throw new RequestError("A Character Card image changed. Reopen Choose Character before generation.",409);
 }
}
export async function nsfwCorrectionCast(request:NextRequest,jobId:string) {
 const user=await requireSessionUser(request);const receipt=withNsfwWorkspace(()=>exportLabJob(user.accountId||"",jobId));
 const settings=receipt.request.settings,characters=settings.referenceCharacters||{};
 if(![5,10].includes(settings.seconds))return undefined;
 let index=0;
 const referenceMap=receipt.request.sources.filter((s:{kind:string})=>s.kind==="image").map((s:{assetId:string})=>{const ref=characters[s.assetId],card=ref&&loadCharacter(user.ownerKey,ref.characterId);return {tag:`<Picture ${++index}>`,kind:"image",source:"image",name:card?.name||`Picture ${index}`,description:card?.description||"",...(card?{characterKey:card.id,characterName:card.name}:{})};});
 return h3DeckVoicePlan(request,user.ownerKey,{useFirstFrame:false,refMods:[],firstFrame:null,images:[],referenceMap} as H3SmartReferenceInput,settings.prompt,settings.seconds as 5|10);
}
