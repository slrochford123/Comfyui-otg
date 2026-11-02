import { labRoute } from "@/lib/experiments/http";
import { assetPost, assetServe } from "@/lib/experiments/assetHandlers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=labRoute((request,owner)=>assetPost(request,owner));
export const GET=labRoute((request,owner)=>assetServe(request,owner));
export const HEAD=GET;
