import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { resolveNsfwAsset,resolveSavedNsfwItem } from "@/lib/experiments/nsfwGallery";
import { mediaFileResponse } from "@/lib/mediaResponse";
export const runtime="nodejs";export const dynamic="force-dynamic";
export const GET=nsfwRoute(async(r,owner)=>{const a=r.nextUrl.searchParams.get("saved")==="1"?resolveSavedNsfwItem(owner,r.nextUrl.searchParams.get("id")||"",true):resolveNsfwAsset(owner,r.nextUrl.searchParams.get("id")||"",true);return mediaFileResponse(r,a.file,{method:r.method==="HEAD"?"HEAD":"GET",contentType:a.mime,download:r.nextUrl.searchParams.get("download")==="1",fileName:a.name,cacheControl:"private, no-store"});},true,true);
export const HEAD=GET;
