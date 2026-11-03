import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { assetPost, assetServe, assetRemoveSaved } from "@/lib/experiments/assetHandlers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=nsfwRoute((request,owner)=>assetPost(request,owner,true));
export const GET=nsfwRoute((request,owner)=>assetServe(request,owner,true));
export const HEAD=GET;
export const DELETE=nsfwRoute(assetRemoveSaved);
