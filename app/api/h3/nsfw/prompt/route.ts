import {NextResponse} from "next/server";
import {nsfwRoute} from "@/lib/experiments/nsfwHttp";
import {boundedJson} from "@/lib/experiments/http";
import {startNsfwDirector,readNsfwDirector,listNsfwDirectorPlans} from "@/lib/experiments/nsfwDirector";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=nsfwRoute(async(request,owner)=>NextResponse.json(await startNsfwDirector(owner,await boundedJson(request)),{status:202}));
export const GET=nsfwRoute(async(request,owner)=>NextResponse.json(request.nextUrl.searchParams.has("sessionId")?listNsfwDirectorPlans(owner,request.nextUrl.searchParams.get("sessionId")||""):readNsfwDirector(owner,request.nextUrl.searchParams.get("id")||"")));
