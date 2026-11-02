import { NextResponse } from "next/server";
import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { boundedJson } from "@/lib/experiments/http";
import { getNsfwAccess, requestNsfwAccess } from "@/lib/experiments/nsfwAccess";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=nsfwRoute(async(_request,owner)=>NextResponse.json({ok:true,access:getNsfwAccess(owner)}),false);
export const POST=nsfwRoute(async(request,owner)=>{const data=await boundedJson(request);return NextResponse.json({ok:true,access:requestNsfwAccess(owner,data.acknowledged)});},false);
