import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { experimentGet, experimentPost } from "@/lib/experiments/apiHandlers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=nsfwRoute((request,owner)=>experimentGet(request,owner,true));
export const POST=nsfwRoute((request,owner)=>experimentPost(request,owner,true));
