import {NextRequest,NextResponse} from "next/server";
import {requireSessionUser} from "@/lib/sessionUser";
import {SessionInvalidError} from "@/lib/ownerKey";
import {getStoryMedia} from "@/lib/storyCreator/mediaStore";
import {requireStoryMediaTest,storyMediaFile} from "@/lib/storyCreator/mediaExecution";
import {mediaFileResponse} from "@/lib/mediaResponse";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function serve(request:NextRequest,method:"GET"|"HEAD") {
  try {
    const {ownerKey}=await requireSessionUser(request);requireStoryMediaTest();
    const record=getStoryMedia(ownerKey,request.nextUrl.searchParams.get("projectId")||"",request.nextUrl.searchParams.get("id")||"");
    return mediaFileResponse(request,storyMediaFile(record),{method,download:request.nextUrl.searchParams.get("download")==="1",cacheControl:"private, no-store"});
  }catch(error){return NextResponse.json({ok:false,error:"Media unavailable for this account."},{status:error instanceof SessionInvalidError?401:404,headers:{"Cache-Control":"no-store"}});}
}
export const GET=(request:NextRequest)=>serve(request,"GET");
export const HEAD=(request:NextRequest)=>serve(request,"HEAD");
