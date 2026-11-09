import {type NextRequest} from "next/server";
import {authorize,body,studio,json,failure} from "@/lib/productionStudio/server";
import {sendStoryVideoToProduction} from "@/lib/storyCreator/mediaProduction";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  try{
    const user=await authorize(req,true),input=await body(req);
    return json(await sendStoryVideoToProduction(studio(),user.ownerKey,String(input.projectId||""),String(input.id||"")));
  }catch(error){return failure(error);}
}
