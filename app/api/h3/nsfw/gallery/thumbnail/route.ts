import { nsfwRoute } from "@/lib/experiments/nsfwHttp";
import { nsfwThumbnail } from "@/lib/experiments/nsfwThumbnail";
export const runtime="nodejs";export const dynamic="force-dynamic";
export const GET=nsfwRoute((r,owner)=>nsfwThumbnail(r,owner));export const HEAD=GET;
