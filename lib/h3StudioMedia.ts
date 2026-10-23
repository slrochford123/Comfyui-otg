import { studioTemplateDuration } from "@/lib/h3StudioPlan";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { assertH3StudioTest } from "@/lib/h3StudioRegistry";
import type { H3StudioPlan } from "@/lib/h3StudioPlan";
import type { H3WorkflowBuildInput } from "@/lib/production/h3Workflows";
import { buildH3StudioLockedReferences, composeH3StudioFinalPrompt } from "@/lib/h3Studio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const H3_STUDIO_MEDIA_TTL = 2 * 60 * 60_000;
export const H3_STUDIO_MEDIA_MAX_BYTES = 128 * 1024 ** 2;
export type StudioMediaRole = "first" | "last" | "reference";
export type StudioMediaAsset = {
  id: string; kind: "image" | "video" | "audio"; role: StudioMediaRole; name: string; filename: string;
  sha256: string; version: number; bytes: number; contentType: string; session: string; expiresAt: number;
  description: string; includeAudio: boolean; clipStartSeconds: number;
  metadata: { width?: number; height?: number; durationSeconds?: number; fps?: number; hasAudio?: boolean };
};
export type BoundStudioMedia = { asset: StudioMediaAsset; path: string };
export type StudioMediaSet = { fingerprint: string; mediaIds: string[]; items: BoundStudioMedia[] };
const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
export const studioPrivateOwnerRoot = (owner: string) => path.join(OTG_DATA_ROOT, "h3-studio", hash(owner));
const cleanupRoots = new Set<string>();
async function pruneMediaRoot(root: string) {
  for (const entry of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const record = await fsp.readFile(path.join(dir, "asset.json"), "utf8").catch(() => fsp.readFile(path.join(dir, "reservation.json"), "utf8").catch(() => ""));
    try { const asset = JSON.parse(record); if (Number.isFinite(asset.expiresAt) && asset.expiresAt <= Date.now()) await fsp.rm(dir, { recursive: true, force: true }); } catch { /* Never remove unknown records. */ }
  }
}
function startStudioMediaCleanup() {
  const root = path.join(OTG_DATA_ROOT, "h3-studio");
  if (cleanupRoots.has(root)) return; cleanupRoots.add(root);
  const timer = setInterval(() => { void (async () => {
    for (const owner of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) if (owner.isDirectory() && /^[a-f0-9]{64}$/.test(owner.name)) await pruneMediaRoot(path.join(root, owner.name, "media"));
  })().catch(() => {}); }, 60_000); timer.unref();
}
async function reserveStudioMedia(owner: string, id: string, bytes: number) {
  const ownerRoot = studioPrivateOwnerRoot(owner), root = path.join(ownerRoot, "media");
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const lock = path.join(ownerRoot, "media-quota.lock"); const deadline = Date.now() + 3000;
  let handle;
  while (!handle) {
    try { handle = await fsp.open(lock, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw new Error("Reference storage is busy. Retry registration."); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  try {
    await pruneMediaRoot(root); let stored = 0, count = 0;
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name) || entry.name === id) continue;
      const dir = path.join(root, entry.name);
      const text = await fsp.readFile(path.join(dir, "asset.json"), "utf8").catch(() => fsp.readFile(path.join(dir, "reservation.json"), "utf8").catch(() => ""));
      try { const record = JSON.parse(text); if (Number.isSafeInteger(record.bytes) && record.bytes > 0) { stored += record.bytes; count++; } } catch { /* Unknown files confer no upload authority. */ }
    }
    const configured = Number(process.env.OTG_H3_STUDIO_MEDIA_MAX_OWNER_BYTES);
    const limit = Number.isSafeInteger(configured) && configured >= 1024 ? Math.min(configured, 2 * 1024 ** 3) : 1024 ** 3;
    if (stored + bytes > limit || count >= 32) throw new Error("Temporary reference storage is full. Remove unused references or wait for expiration.");
    const directory = mediaDirectory(owner, id); await fsp.mkdir(directory, { mode: 0o700 });
    await fsp.writeFile(path.join(directory, "reservation.json"), JSON.stringify({ bytes, expiresAt: Date.now() + 5 * 60_000 }), { mode: 0o600 });
  } finally { await handle.close(); await fsp.rm(lock, { force: true }); }
}
function mediaDirectory(owner: string, id: string) {
  assertH3StudioTest();
  if (!UUID.test(id)) throw new Error("Choose the reference again.");
  return path.join(studioPrivateOwnerRoot(owner), "media", id);
}
export async function studioFileSha256(file: string) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
function options(value: Partial<StudioMediaAsset>, kind: StudioMediaAsset["kind"]) {
  const role = value.role ?? "reference";
  if (!["first", "last", "reference"].includes(role) || (kind !== "image" && role !== "reference")) throw new Error("Choose a valid reference role.");
  if (typeof (value.description ?? "") !== "string" || String(value.description || "").length > 1000) throw new Error("Keep reference descriptions below 1000 characters.");
  const clipStartSeconds = value.clipStartSeconds ?? 0;
  if (typeof clipStartSeconds !== "number" || !Number.isFinite(clipStartSeconds) || clipStartSeconds < 0 || clipStartSeconds > 1200) throw new Error("Choose a valid source start time.");
  if (value.includeAudio !== undefined && typeof value.includeAudio !== "boolean") throw new Error("Choose whether to include reference audio.");
  return { role, description: String(value.description || "").trim(), includeAudio: kind === "video" && value.includeAudio === true, clipStartSeconds };
}
async function probe(file: string, kind: StudioMediaAsset["kind"]): Promise<StudioMediaAsset["metadata"]> {
  if (kind === "image") {
    const info = await sharp(file, { limitInputPixels: 40_000_000 }).metadata();
    if (!["jpeg", "png", "webp"].includes(info.format || "") || !info.width || !info.height || (info.pages || 1) !== 1) throw new Error("Choose a readable static PNG, JPEG or WebP image.");
    return { width: info.width, height: info.height };
  }
  const result = await runCmd(resolveFfprobePath(), ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,wav,mp3,ogg,flac", "-show_streams", "-show_format", "-of", "json", file], { timeoutMs: 20_000 });
  if (result.code !== 0) throw new Error("Choose readable local video or audio media.");
  const info = JSON.parse(result.stdout); const streams = Array.isArray(info.streams) ? info.streams : [];
  const video = streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const audio = streams.some((s: { codec_type: string }) => s.codec_type === "audio");
  const durationSeconds = Number(info.format?.duration ?? video?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 1200 || (kind === "video" && (!video?.width || !video?.height)) || (kind === "audio" && (!audio || video))) throw new Error("Choose media with a valid duration, no longer than 20 minutes.");
  const rate = String(video?.avg_frame_rate || "0/1").split("/").map(Number);
  return { durationSeconds, hasAudio: audio, ...(video ? { width: Number(video.width), height: Number(video.height), fps: rate[1] ? rate[0] / rate[1] : 0 } : {}) };
}
export async function registerStudioMedia(owner: string, session: string, file: File, config: Partial<StudioMediaAsset> = {}, signal?: AbortSignal) {
  assertH3StudioTest(); signal?.throwIfAborted();
  const ext = path.extname(file.name).toLowerCase();
  const kind = /\.(png|jpe?g|webp)$/.test(ext) ? "image" : /\.(mp4|mov|mkv|webm|m4v)$/.test(ext) ? "video" : /\.(wav|mp3|ogg|flac|m4a)$/.test(ext) ? "audio" : null;
  if (!kind || !file.size || file.size > H3_STUDIO_MEDIA_MAX_BYTES || (kind === "image" && file.size > 20 * 1024 ** 2)) throw new Error("Choose a supported image (up to 20 MB), video or audio file (up to 128 MB).");
  const fields = options(config, kind); const id = crypto.randomUUID(); const directory = mediaDirectory(owner, id);
  startStudioMediaCleanup(); await reserveStudioMedia(owner, id, file.size);
  try {
    const filename = `source${ext}`; const target = path.join(directory, filename);
    await fsp.writeFile(target, Buffer.from(await file.arrayBuffer()), { mode: 0o600 }); signal?.throwIfAborted();
    const metadata = await probe(target, kind);
    const contentType = kind === "image" ? ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg" : kind === "video" ? ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : ext === ".mkv" ? "video/x-matroska" : "video/mp4" : ext === ".wav" ? "audio/wav" : ext === ".ogg" ? "audio/ogg" : ext === ".flac" ? "audio/flac" : ext === ".m4a" ? "audio/mp4" : "audio/mpeg";
    const asset: StudioMediaAsset = { id, kind, filename, name: path.basename(file.name).slice(0, 180), sha256: await studioFileSha256(target), version: 1, bytes: file.size, contentType, session, expiresAt: Date.now() + H3_STUDIO_MEDIA_TTL, metadata, ...fields };
    signal?.throwIfAborted(); await fsp.writeFile(path.join(directory, "asset.json"), JSON.stringify(asset), { mode: 0o600 });
    await fsp.rm(path.join(directory, "reservation.json"), { force: true });
    return asset;
  } catch (error) { await fsp.rm(directory, { recursive: true, force: true }); throw error; }
}
export function publicStudioMedia(asset: StudioMediaAsset) {
  const { session: _session, filename: _filename, ...safe } = asset;
  return { ...safe, url: `/api/h3/studio/media?id=${asset.id}` };
}
export async function readStudioMedia(owner: string, session: string, id: string, verifyContent = false): Promise<BoundStudioMedia> {
  const directory = mediaDirectory(owner, id);
  const asset = JSON.parse(await fsp.readFile(path.join(directory, "asset.json"), "utf8")) as StudioMediaAsset;
  if (asset.id !== id || asset.session !== session || asset.expiresAt <= Date.now() || !/^source\.(png|jpe?g|webp|mp4|mov|mkv|webm|m4v|wav|mp3|ogg|flac|m4a)$/.test(asset.filename) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Reference expired or changed. Choose it again.");
  const file = path.join(directory, asset.filename); const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.bytes || (verifyContent && await studioFileSha256(file) !== asset.sha256)) throw new Error("Reference content changed. Prepare a new plan.");
  return { asset, path: file };
}
export async function updateStudioMedia(owner: string, session: string, id: string, patch: Partial<StudioMediaAsset>) {
  if (Object.keys(patch).some(k => !["role", "description", "includeAudio", "clipStartSeconds"].includes(k))) throw new Error("Unsupported reference setting.");
  const current = await readStudioMedia(owner, session, id, true);
  const lock = path.join(mediaDirectory(owner, id), "edit.lock"); const handle = await fsp.open(lock, "wx", 0o600);
  try {
    const latest = await readStudioMedia(owner, session, id);
    const asset = { ...latest.asset, ...options({ ...latest.asset, ...patch }, current.asset.kind), version: latest.asset.version + 1 };
    await fsp.writeFile(path.join(mediaDirectory(owner, id), "asset.json.next"), JSON.stringify(asset), { mode: 0o600 });
    await fsp.rename(path.join(mediaDirectory(owner, id), "asset.json.next"), path.join(mediaDirectory(owner, id), "asset.json")); return asset;
  } finally { await handle.close(); await fsp.rm(lock, { force: true }); }
}
export async function removeStudioMedia(owner: string, session: string, id: string) {
  const directory = mediaDirectory(owner, id);
  const asset = JSON.parse(await fsp.readFile(path.join(directory, "asset.json"), "utf8")) as StudioMediaAsset;
  if (asset.id !== id || asset.session !== session) throw new Error("Reference unavailable.");
  await fsp.rm(directory, { recursive: true, force: true });
}
export async function resolveStudioMedia(owner: string, session: string, value: unknown, verifyContent = false): Promise<StudioMediaSet> {
  if (!Array.isArray(value) || value.length > 17 || value.some(id => typeof id !== "string" || !UUID.test(id)) || new Set(value).size !== value.length) throw new Error("Choose valid, distinct references.");
  const items = await Promise.all(value.map(id => readStudioMedia(owner, session, id, verifyContent)));
  const identity = items.map(({ asset: a }) => ({ id: a.id, sha256: a.sha256, version: a.version, role: a.role, kind: a.kind, description: a.description, includeAudio: a.includeAudio, clipStartSeconds: a.clipStartSeconds, metadata: a.metadata }));
  return { fingerprint: hash(JSON.stringify(identity)), mediaIds: [...value], items };
}
export function validateStudioMediaPlan(plan: H3StudioPlan, media: StudioMediaSet) {
  const first = media.items.filter(i => i.asset.role === "first"), last = media.items.filter(i => i.asset.role === "last");
  const refs = media.items.filter(i => i.asset.role === "reference");
  const videos = refs.filter(i => i.asset.kind === "video"), audios = refs.filter(i => i.asset.kind === "audio"), images = refs.filter(i => i.asset.kind === "image");
  if (images.length > 9 || videos.length > 3 || audios.length > 3 || first.length > 1 || last.length > 1) throw new Error("Reduce references to the supported workflow limits.");
  if (plan.workflowId === "native-t2v" && media.items.length) throw new Error("Text to Video does not consume reference media.");
  if (plan.workflowId === "native-i2v" && (first.length !== 1 || refs.length)) throw new Error("First / Last Frame needs one first image and an optional last image.");
  if (["native-r2v", "reference-edit"].includes(plan.workflowId) && (first.length || last.length || !refs.length)) throw new Error("Choose reference media, not first/last guide images, for this workflow.");
  if (plan.workflowId === "reference-edit" && (videos.length !== 1 || audios.length)) throw new Error("Reference-guided editing needs exactly one video, with optional image references.");
  for (const { asset } of videos) if (asset.clipStartSeconds + plan.durationSeconds > Number(asset.metadata.durationSeconds) + .05) throw new Error("Choose a complete source window matching the requested duration.");
  if (plan.audio === "original" && !videos[0]?.asset.metadata.hasAudio) throw new Error("The selected source video has no original audio.");
}
export function studioBoundCompilerInput(plan: H3StudioPlan, media: StudioMediaSet): H3WorkflowBuildInput {
  const refs = media.items.filter(i => i.asset.role === "reference");
  const mode = plan.workflowId === "native-t2v" ? "h3-text-to-video" : plan.workflowId === "native-i2v" ? "h3-image-to-video" : "h3-reference-to-video";
  const locked = buildH3StudioLockedReferences({ mode,
    firstImageName: media.items.find(i => i.asset.role === "first")?.asset.name,
    lastImageName: media.items.find(i => i.asset.role === "last")?.asset.name,
    references: refs.map(({ asset: a }) => ({ id: a.id, kind: a.kind, name: a.name, description: a.description, includeAudio: a.includeAudio })) });
  return { backend: "rtx3090", mode, h3Quality: plan.quality === "0.2" ? "sh" : plan.quality === "0.6" ? "lq" : "hq", durationSeconds: studioTemplateDuration(plan.durationSeconds), orientation: plan.orientation, finalPrompt: composeH3StudioFinalPrompt(locked, plan.prompt), seed: plan.seed, outputPrefix: "h3-studio/review",
    startImageFilename: media.items.find(i => i.asset.role === "first")?.asset.id,
    lastImageFilename: media.items.find(i => i.asset.role === "last")?.asset.id,
    references: refs.filter(i => i.asset.kind === "image").map(({ asset: a }, index) => ({ id: a.id, name: a.name, description: a.description, uploadedFilename: a.id, sourceKind: "production-upload" as const, sourceId: a.id, workflowImage: a.id, generationSourceType: "production-upload" as const, pictureSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, subjectSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })),
    videoReferences: refs.filter(i => i.asset.kind === "video").map(({ asset: a }) => ({ uploadedFilename: a.id, includeAudio: a.includeAudio })),
    voices: refs.filter(i => i.asset.kind === "audio").map(({ asset: a }, index) => ({ characterId: a.id, snapshotName: a.name, audioSlot: (index + 1) as 1 | 2 | 3, subjectSlot: (index + 1) as 1 | 2 | 3, speakerId: (index + 1) as 1 | 2 | 3, sourcePath: a.id, uploadedFilename: a.id })) };
}
/** Sampling is local/CPU and performed only after explicit external-media consent. */
export async function studioPlannerReferences(media: StudioMediaSet, consent: boolean) {
  const metadata = media.items.map(({ asset: a }) => ({ id: a.id, sha256: a.sha256, version: a.version, role: a.role, kind: a.kind, description: a.description, includeAudio: a.includeAudio, clipStartSeconds: a.clipStartSeconds, metadata: a.metadata }));
  if (!consent) return { metadata, images: [] as string[], contentSent: false };
  const images: string[] = [];
  for (const item of media.items.filter(i => i.asset.kind !== "audio").slice(0, 3)) {
    let bytes: Buffer;
    if (item.asset.kind === "image") bytes = await sharp(item.path, { limitInputPixels: 40_000_000 }).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    else {
      const output = path.join(path.dirname(item.path), `frame-${crypto.randomUUID()}.jpg`);
      try {
        const ff = await runCmd(resolveFfmpegPath(), ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-ss", String(item.asset.clipStartSeconds), "-i", item.path, "-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease", "-y", output], { timeoutMs: 20_000 });
        if (ff.code !== 0) throw new Error("The consented reference frame could not be prepared.");
        bytes = await fsp.readFile(output);
      } finally { await fsp.rm(output, { force: true }); }
    }
    images.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
  }
  return { metadata, images, contentSent: images.length > 0 };
}
