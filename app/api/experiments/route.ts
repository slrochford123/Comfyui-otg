import { labRoute } from "@/lib/experiments/http";
import { experimentGet, experimentPost } from "@/lib/experiments/apiHandlers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=labRoute((request,owner)=>experimentGet(request,owner));
export const POST=labRoute((request,owner)=>experimentPost(request,owner));
