import {requireSessionUser} from "@/lib/sessionUser";
import {ownedNsfwSource,resolveNsfwAsset} from "@/lib/experiments/nsfwGallery";
import {withNsfwWorkspace} from "@/lib/experiments/availability";
import {exportLabJob} from "@/lib/experiments/generation";
import type { NextRequest } from "next/server";
import path from "node:path";
import { getH3DirectJob } from "@/lib/h3DirectJobs";
import { getGallerySourcesForRequest, listGalleryItemsFromSources } from "@/lib/gallery";
import { readPromptRequestMeta } from "@/lib/promptRequestMeta";
import { productionAudioMediaReadable } from "@/lib/productionAudioAccess";
import { RequestError } from "@/lib/requestError";

export type ExtractionPlayerSource = { engine: "h3" | "ltx" | "h3-nsfw"; jobId: string; fileName?: string };

export async function extractionPlayerSource(request: NextRequest, locator: ExtractionPlayerSource) {
  const {owner,sources} = await getGallerySourcesForRequest(request);
  const unavailable = () => new RequestError("Choose a completed Text-to-Video result owned by this account.", 404);
  if (!/^[a-z0-9-]{12,65}$/i.test(locator.jobId || "")) throw unavailable();
  if (locator.engine === "h3-nsfw") {
    const user=await requireSessionUser(request);
    const receipt=withNsfwWorkspace(()=>exportLabJob(user.accountId||"",locator.jobId));
    const asset=await ownedNsfwSource(request,String(receipt.status.output||""));
    if(asset.request.settings?.mode!=="text"||!asset.mime.startsWith("video/"))throw unavailable();
    return {path:asset.file,name:asset.name,owner:owner.ownerKey};
  }
  if (locator.engine === "h3") {
    const job = await getH3DirectJob(owner.ownerKey,locator.jobId);
    if (!job || job.status !== "completed" || job.input.mode !== "h3-text-to-video" || job.input.videoEdit ||
      !job.outputPath || !await productionAudioMediaReadable(request,job.outputPath)) throw unavailable();
    return {path:job.outputPath,name:job.galleryFileName || path.basename(job.outputPath),owner:owner.ownerKey};
  }
  if (locator.engine !== "ltx" || typeof locator.fileName !== "string" || !locator.fileName.length) throw unavailable();
  const meta = readPromptRequestMeta(owner.ownerKey,locator.jobId);
  if (meta?.workflowId !== "presets/LTX 2.5 Text To Video") throw unavailable();
  const result = listGalleryItemsFromSources(sources,{filter:"videos",search:locator.fileName,per:40}).items
    .find(item => item.meta.sourcePromptId === locator.jobId &&
      (item.name === locator.fileName || path.basename(item.path) === locator.fileName));
  if (!result || !await productionAudioMediaReadable(request,result.path)) throw unavailable();
  return {path:result.path,name:result.name,owner:owner.ownerKey};
}
