import {NextRequest,NextResponse} from "next/server";
import {requireSessionUser,SessionInvalidError} from "@/lib/sessionUser";
import {limitedJson} from "@/lib/limitedRequestBody";
import {cookieName} from "@/lib/auth/cookies";
import {verifySession} from "@/lib/auth/jwt";
import {beginGooglePhotos,beginGooglePicking,configureGooglePhotos,disconnectGooglePhotos,downloadGoogleMedia,googlePhotosConfiguration,googlePhotosStatus,googlePickingStatus,PhotosError} from "@/lib/googlePhotos";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
function failure(error:unknown){return NextResponse.json({error:error instanceof PhotosError?error.message:error instanceof SessionInvalidError?"Sign in to your app account first.":"Google Photos is unavailable. Try again."},{status:error instanceof PhotosError?error.status:error instanceof SessionInvalidError?401:502,headers});}
async function owner(req:NextRequest){try{const user=await requireSessionUser(req);if(!user.username||user.scope!=="user")throw Error();const payload=await verifySession(req.cookies.get(cookieName())?.value||"");if(!payload.sub)throw Error();return payload.sub;}catch{throw new PhotosError("Sign in to your app account first.",401);}}
export async function GET(req:NextRequest){try{
  const key=await owner(req),session=req.nextUrl.searchParams.get("session");
  if(session){const file=await downloadGoogleMedia(key,session,req.nextUrl.searchParams.get("item")||"");return new NextResponse(new Uint8Array(file.bytes),{headers:{...headers,"Content-Type":file.mime,"X-Content-Type-Options":"nosniff","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`}});}
  return NextResponse.json(await googlePhotosStatus(key,req.nextUrl.searchParams.get("attempt")||undefined),{headers});
}catch(error){return failure(error);}}
export async function POST(req:NextRequest){try{
  const key=await owner(req),origin=req.headers.get("origin");
  let same=false;try{const url=new URL(origin||"");same=["https:","http:"].includes(url.protocol)&&(url.host===req.headers.get("host")||url.origin===req.nextUrl.origin);}catch{}
  if(req.headers.get("sec-fetch-site")==="cross-site" || !same)throw new PhotosError("Open Google Photos from this app.",403);
  if(!req.headers.get("content-type")?.startsWith("application/json"))throw new PhotosError("A JSON request is required.",415);
  const body=await limitedJson(req,16*1024);
  if(body.action==="configure"){
    if(!(await requireSessionUser(req)).admin)throw new PhotosError("Administrator access required.",403);
    return NextResponse.json(await configureGooglePhotos(body.client,String(body.redirectUri||"")),{headers});
  }
  if(body.action==="connect")return NextResponse.json(await beginGooglePhotos(key),{headers});
  if(body.action==="disconnect")return NextResponse.json({connected:false,...await disconnectGooglePhotos(key)},{headers});
  if(body.action==="pick")return NextResponse.json(await beginGooglePicking(key,Number(body.maximum),String(body.accept||"image/*,video/*")),{headers});
  if(body.action==="poll")return NextResponse.json(await googlePickingStatus(key,String(body.session||"")),{headers});
  throw new PhotosError("Unknown Google Photos action.");
}catch(error){return failure(error);}}
