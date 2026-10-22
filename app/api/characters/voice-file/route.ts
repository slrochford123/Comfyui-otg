import {NextRequest} from "next/server";
import {GET as ownerMediaFile} from "@/app/api/file/route";
import {requireSessionUser} from "@/lib/sessionUser";
import {SessionInvalidError} from "@/lib/ownerKey";

export const runtime="nodejs";
export const dynamic="force-dynamic";

// Legacy URL compatibility must retain the same owner and realpath checks as
// every other saved Character asset. Never serve an arbitrary data-root file.
export async function GET(request:Request) {
 try{await requireSessionUser(request);}catch{return Response.json({ok:false,error:"Unauthorized"},{status:401});}
 const source=new URL(request.url);
 const target=new URL("/api/file",source.origin);
 target.searchParams.set("path",source.searchParams.get("path")||"");
 if(source.searchParams.get("download"))target.searchParams.set("download","1");
 return ownerMediaFile(new NextRequest(target,{headers:request.headers}));
}
