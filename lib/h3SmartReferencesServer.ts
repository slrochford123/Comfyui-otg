import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";
import {assertOwnedCharacterRefMods, canUseCharacterRefMod} from "@/lib/h3SpecialModes/characterRefCardAccess";
import {CHARACTER_REF_PREFIX} from "@/lib/h3SpecialModes/characterRefCardContract";
import {readH3RefModSidecar} from "@/lib/h3SpecialModes/refModCreation";
import {assertCharacterRefVoiceEnabled, assertCharacterRefVoiceIntact} from "@/lib/h3SpecialModes/characterRefVoice";
import {preferMediaGpu} from "@/lib/workers/mediaGpuQueue";
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
export async function makeH3SmartReferenceInput(value: unknown, backend: ProductionV2H3BackendId, images: H3SmartReferenceAsset[], firstFrame: H3SmartReferenceAsset | null, videos = 0, audios = 0, media?: {videos: Array<{name: string; description?: string; includeAudio?: boolean}>; audios: Array<{name: string; description?: string}>}, ownerKey = ""): Promise<H3SmartReferenceInput | undefined> {
  const selection = normalizeH3SmartReferenceSelection(value); if (!selection) return undefined;
  assertOwnedCharacterRefMods(ownerKey,selection.refMods);
  const cap = ownedH3SmartCapabilities(await inspectH3SmartReferences(backend, true),ownerKey);
  for(const slot of selection.refMods){
    const sidecar=readH3RefModSidecar(slot.name);
    if(sidecar?.ownerKey===ownerKey&&sidecar.voice&&slot.strength>0&&slot.components!=="Visual"&&slot.audioStrength>0){assertCharacterRefVoiceEnabled();await assertCharacterRefVoiceIntact(sidecar.voice);}
  }
  const checked = checkH3SmartReferences(cap, selection, images, videos, audios, !!firstFrame);
  return {...selection, images, firstFrame: selection.useFirstFrame ? firstFrame : null, referenceMap: appendH3SmartMediaMap(checked.referenceMap, media?.videos || Array.from({length: videos}, (_, i) => ({name: `Video ${i + 1}`})), media?.audios || Array.from({length: audios}, (_, i) => ({name: `Audio ${i + 1}`})))};
}
export function ownedH3SmartCapabilities(cap:H3SmartReferenceCapabilities,owner:string){return {...cap,refMods:cap.refMods.filter(item=>canUseCharacterRefMod(owner,item.name)).map(item=>{
  const saved=readH3RefModSidecar(item.name);
  if(saved?.ownerKey!==owner||!saved.characterId)return item;
  const binding={characterKey:saved.characterId,characterName:saved.name};
  if(item.kind!=="bundle")return {...item,...binding};
  if(!saved.voice||!saved.members?.length||saved.members.reduce((sum,m)=>sum+m.tokens,0)!==item.tokens)return item;
  return {...item,...binding,members:saved.members.map(m=>({kind:m.kind,tokens:m.tokens})),voiceId:saved.voice.id};
})};}
/** AUTO must select a GPU that actually owns every selected saved RefMod. */
export async function characterRefSelectionBackend(value:unknown,target:ProductionV2H3BackendId|undefined,owner:string){
  const selection=normalizeH3SmartReferenceSelection(value);
  if(!selection)return target;
  assertOwnedCharacterRefMods(owner,selection.refMods);
  if(target||!selection.refMods.some(s=>s.name.replaceAll("\\","/").startsWith(CHARACTER_REF_PREFIX)))return target;
  const compatible=await Promise.all((["rtx3090","rtx5060ti"] as const).map(async gpu=>{
    try{const cap=await inspectH3SmartReferences(gpu,true);return selection.refMods.every(s=>cap.refMods.some(m=>m.name===s.name))?gpu:null;}catch{return null;}
  }));
  const chosen=await preferMediaGpu(compatible.filter((gpu):gpu is ProductionV2H3BackendId=>!!gpu));
  if(!chosen)throw Error("The selected character RefMod is unavailable on either GPU. Its saved images are kept.");
  return chosen;
}
/** Only completed, owned staged uploads may become server-side smart inputs. */
export async function saveH3SmartReferenceImage(ownerKey: string, value: unknown): Promise<H3SmartReferenceAsset> {
  const upload = await readCompletedH3StagedUpload(ownerKey, value, "image");
  const dir = safeJoin(OTG_DATA_ROOT, "h3-smart-references", safeSegment(ownerKey), crypto.randomUUID()); ensureDir(dir);
  const file = safeJoin(dir, "image.png");
  await sharp(await fs.readFile(upload.path), {animated: false, failOn: "error", limitInputPixels: false}).rotate().png().toFile(file);
  return {path: file, name: upload.name, description: ""};
}
