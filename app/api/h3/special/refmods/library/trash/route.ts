import {NextResponse} from "next/server";
import {withOwner,RequestError} from "@/lib/routeSecurity";
import {limitedJson} from "@/lib/limitedRequestBody";
import {deletedRefMods,refModIsDeleted,trashRefMod,restoreRefMod,canonicalRefName} from "@/lib/h3SpecialModes/refModTrash";
import {GET as library} from "../route";
import {characterRefCardsEnabled} from "@/lib/h3SpecialModes/characterRefCardAvailability";
export const runtime="nodejs",dynamic="force-dynamic";
function enabled(){if(!characterRefCardsEnabled())throw new RequestError("Not found.",404);}
export const GET=withOwner(async(_req,owner)=>{enabled();return NextResponse.json({ok:true,entries:deletedRefMods(owner.ownerKey)});});
export const DELETE=withOwner(async(req,owner)=>{
  enabled();const body=await limitedJson(req,2048),name=canonicalRefName(String(body.name||""));
  if(!refModIsDeleted(owner.ownerKey,name)){
    // The authenticated library is authoritative; private foreign names never resolve.
    const response=await library(req),data=await response.json();
    if(!response.ok)throw new RequestError("Could not verify your library. Nothing was removed.",409);
    const entry=data.entries?.find((e:{name:string})=>e.name===name);
    if(!entry)throw new RequestError("RefMod not found in your library.",404);
    trashRefMod(owner.ownerKey,name,entry.displayName||name);
  }
  return NextResponse.json({ok:true,message:"Removed from your library. Original images, voices and shared files are retained; you can restore it."});
});
export const POST=withOwner(async(req,owner)=>{
  enabled();const body=await limitedJson(req,2048),name=canonicalRefName(String(body.name||""));
  if(!refModIsDeleted(owner.ownerKey,name))throw new RequestError("Deleted RefMod not found for this account.",404);
  restoreRefMod(owner.ownerKey,name);return NextResponse.json({ok:true});
});
