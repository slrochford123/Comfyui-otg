import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";
import { H3_BACKEND_PROFILES, type ProductionV2H3BackendId } from "@/lib/production/h3Workflows";
import { readCompletedH3StagedUpload } from "@/lib/h3StagedUploads";
import { OTG_DATA_ROOT, safeJoin, safeSegment, ensureDir } from "@/lib/paths";
import { appendH3SmartMediaMap, checkH3SmartReferences, normalizeH3SmartReferenceSelection, type H3SmartReferenceAsset, type H3SmartReferenceCapabilities, type H3SmartReferenceInput } from "@/lib/h3SmartReferences";
const cache = new Map<string, { at: number; value: H3SmartReferenceCapabilities }>();
export async function inspectH3SmartReferences(backend: ProductionV2H3BackendId, fresh = false): Promise<H3SmartReferenceCapabilities> {
  const old = cache.get(backend); if (!fresh && old && Date.now() - old.at < 15_000) return old.value;
  const base = H3_BACKEND_PROFILES[backend].baseUrl;
  const read = async (route: string) => { const r = await fetch(base + route, {cache: "no-store", signal: AbortSignal.timeout(10_000)}); if (!r.ok) throw Error("The selected H3 GPU is unavailable."); return r.json(); };
  const [info, library] = await Promise.all([read("/object_info"), read("/refmods/library")]);
  const max = (key: string, fallback: number) => Number(info.MiniMaxH3ReferenceToVideo?.input?.optional?.[key]?.[1]?.max) || fallback;
  const combined = !!info.PK_MiniMaxH3Combined;
  const loader = info.MiniMaxH3RefModsLoader?.input?.required || {};
  const value: H3SmartReferenceCapabilities = {
    backend, available: !!info.MiniMaxH3ReferenceToVideo,
    firstFrame: !!info.MiniMaxH3AddGuide,
    mixedReferences: combined && !!info.MiniMaxH3RefModTextEncode,
    reason: combined ? "" : "Mixed RefMods and ordinary images need the combined H3 encoder, which is not installed on this GPU. Use the RTX 3090 or keep one reference type. No model is substituted.",
    maxImages: Math.min(9, max("ref_images", 9)), maxVideos: Math.min(3, max("ref_videos", 3)), maxAudios: Math.min(3, max("ref_audios", 3)),
    maxTotalReferenceMedia: 12, maxRefModSlots: Object.keys(loader).filter(key => /^mod_\d+$/.test(key)).length,
    combinedLimitBasis: "Application guard derived from the expanded native reference blocks and official H3 media envelope. The installed combined node has no separate fixed combined-count limit; this is not a measured mixed-capacity or memory guarantee.",
    firstFrameConsumesReferenceAllowance: false,
    referenceTokenBudget: null,
    tokenBudgetExplanation: "Installed RefMod loaders use 0 (no fixed token budget). Slot counts are not a memory guarantee. RefMod members and copies share the conservative H3 media envelope; generation quality and practical memory capacity need owner testing.",
    refMods: Array.isArray(library) ? library.map((entry: {name: string; kind: string; tokens?: number}) => ({name: entry.name, kind: entry.kind, tokens: Number.isFinite(entry.tokens) ? entry.tokens : null})) : [],
  };
  cache.set(backend, {at: Date.now(), value}); return value;
}
export async function makeH3SmartReferenceInput(value: unknown, backend: ProductionV2H3BackendId, images: H3SmartReferenceAsset[], firstFrame: H3SmartReferenceAsset | null, videos = 0, audios = 0, media?: {videos: Array<{name: string; description?: string; includeAudio?: boolean}>; audios: Array<{name: string; description?: string}>}): Promise<H3SmartReferenceInput | undefined> {
  const selection = normalizeH3SmartReferenceSelection(value); if (!selection) return undefined;
  const cap = await inspectH3SmartReferences(backend, true);
  const checked = checkH3SmartReferences(cap, selection, images, videos, audios, !!firstFrame);
  return {...selection, images, firstFrame: selection.useFirstFrame ? firstFrame : null, referenceMap: appendH3SmartMediaMap(checked.referenceMap, media?.videos || Array.from({length: videos}, (_, i) => ({name: `Video ${i + 1}`})), media?.audios || Array.from({length: audios}, (_, i) => ({name: `Audio ${i + 1}`})))};
}
/** Only completed, owned staged uploads may become server-side smart inputs. */
export async function saveH3SmartReferenceImage(ownerKey: string, value: unknown): Promise<H3SmartReferenceAsset> {
  const upload = await readCompletedH3StagedUpload(ownerKey, value, "image");
  const dir = safeJoin(OTG_DATA_ROOT, "h3-smart-references", safeSegment(ownerKey), crypto.randomUUID()); ensureDir(dir);
  const file = safeJoin(dir, "image.png");
  await sharp(await fs.readFile(upload.path), {animated: false, failOn: "error", limitInputPixels: false}).rotate().png().toFile(file);
  return {path: file, name: upload.name, description: ""};
}
