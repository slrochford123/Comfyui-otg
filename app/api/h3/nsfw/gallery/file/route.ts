import {nsfwRoute} from "@/lib/experiments/nsfwHttp";
import {resolveSavedNsfwItem} from "@/lib/experiments/nsfwGallery";
import {mediaFileResponse} from "@/lib/mediaResponse";
export const runtime="nodejs";export const dynamic="force-dynamic";
export const GET=nsfwRoute(async(r,owner)=>{const item=resolveSavedNsfwItem(owner,r.nextUrl.searchParams.get("id")||"");return mediaFileResponse(r,item.file,{method:r.method==="HEAD"?"HEAD":"GET",contentType:item.mime,fileName:item.name,download:r.nextUrl.searchParams.get("download")==="1",cacheControl:"private, no-store"});});export const HEAD=GET;
