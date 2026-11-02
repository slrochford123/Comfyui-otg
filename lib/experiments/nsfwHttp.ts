import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { RequestError } from "@/lib/requestError";
import { privateHeaders } from "./http";
import { requireTestLab } from "./store";
import { getNsfwAccess, requireNsfwAccess } from "./nsfwAccess";

export function nsfwRoute(handler:(request:NextRequest,owner:string)=>Promise<Response>, accessRequired=true) {
  return async(request:NextRequest)=>{
    try {
      requireTestLab();const token=(await cookies()).get(cookieName())?.value;
      let id:string;
      try {if(!token)throw Error();id=String((await verifySession(token)).sub||"");} catch {throw new RequestError("Sign in required.",401);}
      if(accessRequired)requireNsfwAccess(id);else getNsfwAccess(id);
      if(!["GET","HEAD"].includes(request.method)){
        let same=false;try {const origin=new URL(request.headers.get("origin")||"");same=["http:","https:"].includes(origin.protocol)&&origin.host===request.headers.get("host");}catch{}
        if(!same||request.headers.get("sec-fetch-site")==="cross-site")throw new RequestError("Same-origin request required.",403);
      }
      const response=await handler(request,id);for(const [key,value] of Object.entries(privateHeaders))response.headers.set(key,value);return response;
    } catch(error) {return NextResponse.json({ok:false,error:error instanceof RequestError?error.message:"H3 NSFW request failed."},{status:error instanceof RequestError?error.status:500,headers:privateHeaders});}
  };
}
