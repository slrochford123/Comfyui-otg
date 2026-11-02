import { NextResponse } from "next/server";
import { boundedJson } from "@/lib/experiments/http";
import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { setNsfwAccess } from "@/lib/experiments/nsfwAccess";
import { validId } from "@/lib/experiments/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=nsfwRoute(async(request,actor)=>{const data=await boundedJson(request);validId(data.userId);return NextResponse.json({ok:true,access:setNsfwAccess(actor,data.userId,data.enabled,data.version)});},true,true);
