import { NextRequest } from "next/server";
import { authorize,body,studio,json,failure } from "@/lib/productionStudio/server";
import { createAction } from "@/lib/productionStudio/createActions";
import { CreateError } from "@/lib/productionStudio/createManifest";
import { readCharacterRefCard,characterRefCardPublic } from "@/lib/h3SpecialModes/characterRefCard";
export const runtime="nodejs"; export const dynamic="force-dynamic";
type C={params:Promise<{id:string}>};
export async function GET(req:NextRequest,c:C){try{const u=await authorize(req),{id}=await c.params,p=studio().get(u.ownerKey,id),item=p.creation?.items.find(i=>i.id===req.nextUrl.searchParams.get("itemId"));if(!item)throw new CreateError("Creation item not found.",404);return json({card:item.refCardId?characterRefCardPublic(await readCharacterRefCard(u.ownerKey,item.refCardId)):null});}catch(e){return failure(e);}}
export async function POST(req:NextRequest,c:C){try{const u=await authorize(req,true),{id}=await c.params;return json(await createAction(studio(),u.ownerKey,id,await body(req)));}catch(e){return failure(e);}}
