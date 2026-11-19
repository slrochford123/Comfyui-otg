import {ownedNsfwSource,registerNsfwSavedItem,resolveSavedNsfwItem,nsfwSavedGalleryPath} from "@/lib/experiments/nsfwGallery";
import {requireSessionUser} from "@/lib/sessionUser";
import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { NextRequest } from "next/server";
import { getGallerySourcesForRequest, resolveGalleryItemByName, writeMetaForFile } from "@/lib/gallery";
import { studioFileSha256 } from "@/lib/h3StudioMedia";
import type { H3CharacterVoicePlan } from "@/lib/h3CharacterVoices";
import { getH3DirectJob } from "@/lib/h3DirectJobs";
import { getH3RefModsJob } from "@/lib/h3SpecialModes/refModsJobs";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { productionAudioMediaReadable, ProductionAudioAccessError } from "@/lib/productionAudioAccess";
import { productionAudioAnalysisRoot } from "@/lib/productionAudioSourcePaths";
import { RequestError } from "@/lib/requestError";
import { requireStorageHeadroom } from "@/lib/storageAdmission";
import type { MixSource, VoiceInterval } from "@/lib/fixVoicesAudio";
import type { SceneFineTune, SceneMatchReport } from "@/lib/fixVoicesSceneMatch";

export type VoiceCorrectionLane = {
  id: string; label: string; sampleUrl?: string; segments: VoiceInterval[];
  suggestedTargetVoiceId?: string; suggestedTargetVoiceName?: string; suggestedCharacterId?: string;
  needsCharacterConfirmation?: boolean;
};
export type VoiceCorrectionAnalysis = {
  contentMode?: "nsfw";
  sourcePath: string; sourceFileName: string; sourceJobId?: string; durationSeconds: number;
  cast?: Array<{characterId: string; name: string; voiceId?: string; voiceName?: string}>;
  voiceTargets?: H3CharacterVoicePlan["voiceTargets"];
  mixSource: MixSource | null; voices: VoiceCorrectionLane[]; mixReady: boolean; warnings: string[];
};
export type VoiceCorrectionResult = VoiceInterval & {voiceId: string; targetVoiceId: string; engine: string; usedActedTake: boolean;
  levelDb?: number; sceneMatch?: SceneMatchReport; cueIndex?: number; fineTune?: SceneFineTune; fineTuneWarning?: string};
export type VoiceCorrectionSkip = VoiceInterval & {voiceId: string; reason: string};
export type VoiceCorrectionPreview = {
  contentMode?: "nsfw";
  previewPath: string; sourceFileName: string; analysisId: string; sourceJobId?: string;
  renderedSegments: VoiceCorrectionResult[]; skippedSegments: VoiceCorrectionSkip[];
  convertedFiles?: string[];
  sourcePreviewId?: string;
  matchOriginalScene?: boolean;
};

const analysisRoot = process.env.OTG_AUDIO_ANALYSIS_DIR || productionAudioAnalysisRoot();
const previewRoot = path.join(OTG_DATA_ROOT, "production_audio_dub_previews");
const idPattern = /^[a-zA-Z0-9_-]{8,96}$/;

export { requireTestingVoiceTools as assertFixVoicesTest } from "@/lib/testingVoiceToolsAccess";
export function correctionPath(owner: string, id: string, record: "analysis" | "preview") {
  if (!idPattern.test(id)) throw new ProductionAudioAccessError();
  return path.join(record === "analysis" ? analysisRoot : previewRoot, safeSegment(owner), id);
}

export function correctionMediaUrl(file: string) {
  return `/api/file?path=${encodeURIComponent(file)}`;
}

export async function readCorrectionRecord<T>(owner: string, id: string, record: "analysis" | "preview"): Promise<T> {
  try { return JSON.parse(await fs.readFile(path.join(correctionPath(owner, id, record), `fix-voices-${record}.json`), "utf8")); }
  catch { throw new ProductionAudioAccessError("That Fix Voices analysis or preview is unavailable. Load the clip again."); }
}

export async function writeCorrectionRecord(owner: string, id: string, record: "analysis" | "preview", data: VoiceCorrectionAnalysis | VoiceCorrectionPreview) {
  if(data.contentMode==="nsfw")await fs.writeFile(path.join(correctionPath(owner,id,record),".nsfw-media"),"1",{mode:0o600});
  await fs.writeFile(path.join(correctionPath(owner, id, record), `fix-voices-${record}.json`), JSON.stringify(data), {mode: 0o600, flag: "wx"});
}

export async function resolveCorrectionSource(request: NextRequest, owner: string, body: Record<string, unknown>) {
  if(body.nsfwSavedId){const user=await requireSessionUser(request);const {requireNsfwAccess}=await import("@/lib/experiments/nsfwAccess");requireNsfwAccess(user.accountId||"");const saved=resolveSavedNsfwItem(user.accountId||"",String(body.nsfwSavedId));return {file:saved.file,name:saved.name,savedPreviewId:saved.previewId,contentMode:"nsfw" as const};}
  if(body.nsfwAssetId){const asset=await ownedNsfwSource(request,String(body.nsfwAssetId));
    if(!asset.mime.startsWith("video/"))throw new ProductionAudioAccessError();
    return {file:asset.file,name:asset.name,sourceJobId:"nsfw-"+asset.jobId,contentMode:"nsfw" as const};
  }
  const sourceJobId = String(body.sourceJobId || "");
  if (sourceJobId) {
    if (!/^h3-(?:refmods-|direct-)[a-f0-9-]{36}$/.test(sourceJobId)) throw new ProductionAudioAccessError();
    const job = sourceJobId.startsWith("h3-refmods-") ? await getH3RefModsJob(owner, sourceJobId) : await getH3DirectJob(owner, sourceJobId);
    if (!job || job.ownerKey !== owner || job.status !== "completed" || !job.outputPath || !await productionAudioMediaReadable(request, job.outputPath)) throw new ProductionAudioAccessError("The completed H3 video is unavailable.");
    return { file: job.outputPath, sourceJobId, name: path.basename(job.outputPath) };
  }
  let url: URL;
  try { url = new URL(String(body.sourceUrl || "/api/gallery/file"), request.nextUrl.origin); }
  catch { throw new ProductionAudioAccessError(); }
  if (url.origin !== request.nextUrl.origin || !["/api/file", "/api/gallery/file"].includes(url.pathname)) throw new ProductionAudioAccessError();
  if (url.pathname === "/api/file") {
    const file = String(url.searchParams.get("path") || "");
    if (!path.isAbsolute(file) || !await productionAudioMediaReadable(request, file)) throw new ProductionAudioAccessError();
    return { file, name: path.basename(file) };
  }
  const name = String(body.sourceFileName || url.searchParams.get("name") || "");
  const scope = String(body.sourceScope || url.searchParams.get("scope") || "");
  const {sources} = await getGallerySourcesForRequest(request);
  const item = resolveGalleryItemByName({sources, name, scopeHint: scope || null});
  if (item?.kind !== "video" || !await productionAudioMediaReadable(request, item.path)) throw new ProductionAudioAccessError("The selected Gallery video is unavailable.");
  const jobId = item.meta?.submitPayload?.jobId;
  const galleryJobId = typeof jobId === "string" && /^h3-direct-[a-f0-9-]{36}$/.test(jobId) ? jobId : undefined;
  const savedPreview = item.meta?.voiceDub?.previewId;
  const savedPreviewId = item.scope === "user" && item.meta?.ownerKey === owner && item.meta?.sourceType === "fix-voices"
    && typeof savedPreview === "string" && idPattern.test(savedPreview) ? savedPreview : undefined;
  return {file: item.path, name: path.basename(item.path), sourceJobId: galleryJobId, savedPreviewId};
}

export async function reopenCorrectionPreview(request: NextRequest, owner: string, previewId: string, savedGalleryFile: string) {
  const preview = await readCorrectionRecord<VoiceCorrectionPreview>(owner, previewId, "preview");
  const base = preview.sourcePreviewId
    ? await readCorrectionRecord<VoiceCorrectionPreview>(owner, preview.sourcePreviewId, "preview") : preview;
  const analysis = await readCorrectionRecord<VoiceCorrectionAnalysis>(owner, preview.analysisId, "analysis");
  if (base.analysisId !== preview.analysisId || !base.convertedFiles?.length || !analysis.mixReady
      || !await productionAudioMediaReadable(request, base.previewPath)
      || !await productionAudioMediaReadable(request, preview.previewPath)
      || !await productionAudioMediaReadable(request, analysis.sourcePath)) {
    throw new RequestError("The saved preview is available in Gallery, but its original editing media is unavailable.", 422);
  }
  if (await studioFileSha256(savedGalleryFile) !== await studioFileSha256(preview.previewPath)) {
    throw new RequestError("This Gallery video has changed since the voice edit was saved.", 422);
  }
  return {
    ok: true, analysisId: preview.analysisId, sourceJobId: analysis.sourceJobId,
    sourceVideoUrl: correctionMediaUrl(analysis.sourcePath), sourceFileName: analysis.sourceFileName,
    durationSeconds: analysis.durationSeconds,
    voices: analysis.voices.map(({samplePath: _samplePath, ...voice}: VoiceCorrectionLane & {samplePath?: string}) => voice),
    cast: analysis.cast,
    mixReady: analysis.mixReady, warnings: analysis.warnings,
    restoredPreview: {
      previewId, previewVideoUrl: correctionMediaUrl(preview.previewPath), unadjustedVideoUrl: correctionMediaUrl(base.previewPath),
      matchOriginalScene: preview.matchOriginalScene === true, renderedSegments: preview.renderedSegments, skippedSegments: preview.skippedSegments,
    },
  };
}

export async function saveCorrectionPreview(request: NextRequest, owner: string, previewId: string) {
  const preview = await readCorrectionRecord<VoiceCorrectionPreview>(owner, previewId, "preview");
  if (!await productionAudioMediaReadable(request, preview.previewPath)) throw new ProductionAudioAccessError();
  const analysis=await readCorrectionRecord<VoiceCorrectionAnalysis>(owner,preview.analysisId,"analysis");
  if(analysis.contentMode==="nsfw"){
    const user=await requireSessionUser(request);const {requireNsfwAccess}=await import("@/lib/experiments/nsfwAccess");requireNsfwAccess(user.accountId||"");
    const file=nsfwSavedGalleryPath(user.accountId||"",previewId),name=`voices-fixed-${previewId}.mp4`;
    requireStorageHeadroom(path.dirname(file),(await fs.stat(preview.previewPath)).size);
    const temporary=file+"."+crypto.randomUUID()+".part";
    try{await fs.copyFile(preview.previewPath,temporary,constants.COPYFILE_EXCL);try{await fs.link(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}}finally{await fs.unlink(temporary).catch(()=>undefined);}
    if(await studioFileSha256(file)!==await studioFileSha256(preview.previewPath))throw new RequestError("Saved take differs from this preview. The existing file was retained.",409);
    const id=registerNsfwSavedItem(user.accountId||"",`voice:${previewId}`,{file,previewId,name,kind:"video",url:"",thumbnailUrl:"",created:Date.now()/1000,owner:user.accountId,gpu:"Saved conversion",device:user.deviceId,favorite:false,source:"Saved voice conversion"});
    return {ok:true,url:`/api/h3/nsfw/gallery/file?id=${id}&saved=1`};
  }
  const {sources} = await getGallerySourcesForRequest(request);
  const target = sources.find(source => source.ownerKey === owner && source.scope === "user");
  if (!target) throw new RequestError("Your Gallery is unavailable.", 404);
  const name = `voices-fixed-${previewId}${path.extname(preview.previewPath)}`;
  const file = path.join(target.dir, name);
  await fs.mkdir(target.dir, {recursive: true});
  requireStorageHeadroom(target.dir, (await fs.stat(preview.previewPath)).size);
  const temporary = `${file}.${crypto.randomUUID()}.part`;
  try {
    await fs.copyFile(preview.previewPath, temporary, constants.COPYFILE_EXCL);
    try { await fs.link(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    writeMetaForFile(file, {sourceType: "fix-voices", ownerKey: owner, workflowTitle: "Fix Voices", voiceDub: { previewId, sourceVideo: preview.sourceFileName, parentJobId: preview.sourceJobId, renderedSegments: preview.renderedSegments, skippedSegments: preview.skippedSegments, matchOriginalScene: preview.matchOriginalScene }, createdAt: Date.now()}, target);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
  return {ok: true, url: `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${target.scope}`};
}

export async function correctionCastPlan(owner: string, jobId?: string, request?:NextRequest) {
  if(request&&jobId?.startsWith("nsfw-")){const {nsfwCorrectionCast}=await import("@/lib/experiments/nsfwCharacters");return nsfwCorrectionCast(request,jobId.slice(5));}
  if (!jobId?.startsWith("h3-direct-")) return undefined;
  const job = await getH3DirectJob(owner, jobId);
  return job?.ownerKey === owner && job.status === "completed" ? (job.input.characterVoices || job.input.correctionCast) : undefined;
}

export async function verifiedCorrectionVoice(request: NextRequest, target: H3CharacterVoicePlan["voiceTargets"][number]) {
  try {
    const stat = await fs.lstat(target.sample.path);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 64 * 1024 * 1024) return null;
    if (!await productionAudioMediaReadable(request, target.sample.path) || await studioFileSha256(target.sample.path) !== target.sha256) return null;
    return target;
  } catch { return null; }
}
