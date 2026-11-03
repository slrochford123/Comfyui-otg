import fs from "node:fs/promises";
import {NextRequest, NextResponse} from "next/server";
import {withOwner, RequestError} from "@/lib/routeSecurity";
import {limitedBytes, limitedJson} from "@/lib/limitedRequestBody";
import {MAX_LAB_IMAGE_BYTES} from "@/lib/experiments/imageTypes";
import {loadCharacter} from "@/lib/characters/store";
import {readCompletedH3StagedUpload} from "@/lib/h3StagedUploads";
import {readH3RefModSidecar} from "@/lib/h3SpecialModes/refModCreation";
import {CHARACTER_REF_PREFIX} from "@/lib/h3SpecialModes/characterRefCardContract";
import {characterRefOwnerHash} from "@/lib/h3SpecialModes/characterRefCardAccess";
import {GET as ownedFile} from "@/app/api/file/route";
import {assertCharacterRefCardsEnabled, bootstrapCharacterRefCards, createCharacterRefCard, latestCharacterRefCard, readCharacterRefCard, characterRefCardPublic, uploadCharacterRefAsset, editCharacterRefCard} from "@/lib/h3SpecialModes/characterRefCard";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(card:Parameters<typeof characterRefCardPublic>[0]|null)=>NextResponse.json({ok:true,card:card?characterRefCardPublic(card):null});
export const GET=withOwner(async(req,owner)=>{
  assertCharacterRefCardsEnabled(); bootstrapCharacterRefCards();
  const cardId=req.nextUrl.searchParams.get("id");
  const card=cardId?await readCharacterRefCard(owner.ownerKey,cardId):await latestCharacterRefCard(owner.ownerKey,req.nextUrl.searchParams.get("characterId")||undefined);
  const asset=req.nextUrl.searchParams.get("asset"),preview=req.nextUrl.searchParams.has("preview");
  if(asset||preview){
    const version=req.nextUrl.searchParams.get("preview");
    const saved=preview&&card&&/^[a-f0-9-]{36}$/.test(version||"")?readH3RefModSidecar(CHARACTER_REF_PREFIX+characterRefOwnerHash(owner.ownerKey)+"/"+card.id+"/"+version):null;
    const file=preview?(saved?.ownerKey===owner.ownerKey?saved.cardPreviewPath:version==="1"?card?.previewPath:null):card?.original?.id===asset?card.original.file:card?.views.find(a=>a.id===asset)?.file;
    if(!file)throw new RequestError("Image not found for this card.",404);
    const stat=await fs.lstat(file).catch(()=>null);
    if(!stat?.isFile()||stat.isSymbolicLink())throw new RequestError("Image not found.",404);
    return new Response(new Uint8Array(await fs.readFile(file)),{headers:{"Content-Type":"image/png","Content-Length":String(stat.size)}});
  }
  return reply(card);
});
export const POST=withOwner(async(req,owner)=>{
  assertCharacterRefCardsEnabled();
  const body=await limitedJson(req,16*1024),id=String(body.id||"");
  let card;
  if(body.action==="create")card=await createCharacterRefCard(owner.ownerKey,id);
  else if(body.action==="upload-staged"){
    if(body.role!=="original"&&body.role!=="view")throw new RequestError("Choose an image role.",400);
    const source=await readCompletedH3StagedUpload(owner.ownerKey,body.upload,"image");
    card=await uploadCharacterRefAsset(owner.ownerKey,id,String(body.assetId||""),{file:source.path},source.name,body.role,body.replace?String(body.replace):undefined);
  }else if(body.action==="import-character"){
    const character=loadCharacter(owner.ownerKey,String(body.characterId||""));
    if(!character)throw new RequestError("Character not found for this account.",404);
    const source=character.defaultCharacterSourceImagePath||character.originalSourceImagePath||character.defaultCharacterImagePath||character.fullBodyImagePath||character.imagePath;
    const response=await ownedFile(new NextRequest(new URL(`/api/file?path=${encodeURIComponent(source)}`,req.url),{headers:req.headers}));
    if(!response.ok)throw new RequestError("The character image is not accessible to this account.",403);
    const bytes=await limitedBytes(new Request(req.url,{method:"POST",body:response.body,duplex:"half"} as RequestInit),MAX_LAB_IMAGE_BYTES);
    card=await uploadCharacterRefAsset(owner.ownerKey,id,String(body.assetId||""),bytes,character.name,"original");
  }else card=await editCharacterRefCard(owner.ownerKey,id,body);
  bootstrapCharacterRefCards();return reply(card);
});
export const PUT=withOwner(async(req,owner)=>{
  assertCharacterRefCardsEnabled();
  const p=req.nextUrl.searchParams,role=p.get("role");
  if(role!=="original"&&role!=="view")throw new RequestError("Choose an image role.",400);
  const bytes=await limitedBytes(req,MAX_LAB_IMAGE_BYTES);
  const card=await uploadCharacterRefAsset(owner.ownerKey,p.get("id")||"",p.get("asset")||"",bytes,p.get("label")||"Reference",role,p.get("replace")||undefined);
  return reply(card);
});
