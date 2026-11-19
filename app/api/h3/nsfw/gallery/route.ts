import { NextResponse } from "next/server";
import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { boundedJson } from "@/lib/experiments/http";
import { listNsfwGallery,updateNsfwGallery } from "@/lib/experiments/nsfwGallery";
export const runtime="nodejs";export const dynamic="force-dynamic";
export const GET=nsfwRoute(async(r,owner)=>NextResponse.json(listNsfwGallery(owner,{search:(r.nextUrl.searchParams.get("search")||"").slice(0,200),media:r.nextUrl.searchParams.get("media")||"all",sort:r.nextUrl.searchParams.get("sort")||"newest",page:Number(r.nextUrl.searchParams.get("page")),per:Number(r.nextUrl.searchParams.get("per")),favorites:r.nextUrl.searchParams.get("favorite")==="1"})));
export const POST=nsfwRoute(async(r,owner)=>{const b=await boundedJson(r);return NextResponse.json(updateNsfwGallery(owner,String(b.id),String(b.action),b.value));});
