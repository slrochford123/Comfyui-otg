import { createHash, randomInt, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { loadCharacter, type CharacterRecord } from "@/lib/characters/store";
import { compileH3CharacterVoices, H3_CHARACTER_VOICE_RECIPES, type H3CastBinding, type H3CharacterVoicePlan, type H3CharacterVoiceRecipe } from "@/lib/h3CharacterVoices";
import type { H3DirectJobInput, H3DirectReference } from "@/lib/h3DirectJobs";
import { assertCharacterRefVoiceIntact, CHARACTER_VOICE_MAX_BYTES, resolveCharacterRefVoice } from "@/lib/h3SpecialModes/characterRefVoice";
import { readH3RefModSidecar } from "@/lib/h3SpecialModes/refModCreation";
import { checkH3SmartReferences, h3RefModSignature, type H3SmartReferenceCapabilities, type H3SmartReferenceMapEntry } from "@/lib/h3SmartReferences";
import { applyH3CharacterVoiceGraph, assertNativeH3AudioGraph } from "@/lib/h3SmartReferencesGraph";
import { inspectH3SmartReferences, ownedH3SmartCapabilities } from "@/lib/h3SmartReferencesServer";
import { readCompletedH3StagedUpload } from "@/lib/h3StagedUploads";
import { studioFileSha256 } from "@/lib/h3StudioMedia";
import { resolveH3StylePreset } from "@/lib/h3StylePresets";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { productionAudioMediaReadable } from "@/lib/productionAudioAccess";
import { inspectH3BackendCompatibility, resolveProductionV2MediaPath } from "@/lib/production/h3Comfy";
import { H3_ORIENTATION_OPTIONS, H3_QUALITY_OPTIONS, type H3Orientation, type H3Quality } from "@/lib/production/h3ProductionRecipes";
import { normalizeH3AdvancedSettings } from "@/lib/production/h3Settings";
import { buildH3Workflow, H3_BACKEND_PRIORITY, type ProductionV2H3BackendId, type ProductionV2H3Mode } from "@/lib/production/h3Workflows";
import { characterToProductionV2Catalog } from "@/lib/production/referenceCatalog";
import { DEFAULT_PRODUCTION_V2_H3_USER_LORAS } from "@/lib/production/h3Loras";

type Selection = { characterId: string; voiceId?: string; visualRefMod?: string; audioRefMod?: string };
type VoiceTarget = H3CharacterVoicePlan["voiceTargets"][number];
type RecipeChoice = { name: string; label: string; backend: ProductionV2H3BackendId };
type CastChoice = { characterId: string; name: string; aliases?: string[]; voiceId?: string; voiceName?: string; visualRefMods: RecipeChoice[]; audioRefMods: RecipeChoice[] };
const RAPHAEL_REFERENCE_CARD = "530d9fc7-b9a5-4865-9360-f8612e32b859";
const run = promisify(execFile);
const ALLOWED_AUDIO_ARGS = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,flac,ogg,mov,matroska,webm,aac"];
const MODES: ProductionV2H3Mode[] = ["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"];

async function availableLanes(owner: string, fresh = false) {
  const checked = await Promise.all(H3_BACKEND_PRIORITY.map(async backend => {
    try { return ownedH3SmartCapabilities(await inspectH3SmartReferences(backend, fresh), owner); }
    catch { return null; }
  }));
  return checked.filter((lane): lane is H3SmartReferenceCapabilities => !!lane?.available);
}

function approvedCardIdentity(character: CharacterRecord) {
  const metadata = character.metadata ?? {};
  const approvedAliases = Array.isArray(metadata.h3CharacterAliases) ? metadata.h3CharacterAliases.filter((name): name is string => typeof name === "string" && !!name.trim() && name.length <= 96) : [];
  const knownCard = (character.id === RAPHAEL_REFERENCE_CARD || metadata.refModCardId === RAPHAEL_REFERENCE_CARD) && /^(?:raphael|rafael)$/i.test(character.name.trim());
  const name = knownCard ? "Raphael" : character.name.trim();
  const aliases = [...new Set([...approvedAliases, ...(knownCard ? ["Rafael"] : [])])].filter(alias => alias.toLocaleLowerCase() !== name.toLocaleLowerCase());
  return { name, aliases, identity: (character.description || "").replace(/\s+/g, " ").trim().slice(0, 480) };
}

function castChoices(owner: string, character: CharacterRecord, lanes: H3SmartReferenceCapabilities[]): CastChoice {
  const visualRefMods: RecipeChoice[] = [], audioRefMods: RecipeChoice[] = [];
  for (const lane of lanes) {
    if (!lane.mixedReferences || !lane.refModAudioStrength) continue;
    for (const mod of lane.refMods.filter(item => item.characterKey === character.id)) {
      const sidecar = readH3RefModSidecar(mod.name);
      if (!sidecar || sidecar.ownerKey !== owner || sidecar.characterId !== character.id) continue;
      const choice = { name: mod.name, label: sidecar.name, backend: lane.backend };
      if (mod.kind === "image" || mod.kind === "video" || mod.members?.some(item => item.kind !== "audio")) visualRefMods.push(choice);
      if (mod.kind === "bundle" && mod.voiceId && mod.members?.some(item => item.kind === "audio") && mod.members.some(item => item.kind !== "audio")) audioRefMods.push(choice);
    }
  }
  const voiceId = character.referenceAudioPath ? `character-sample:${character.id}` : undefined;
  const { name, aliases } = approvedCardIdentity(character);
  return { characterId: character.id, name, aliases, voiceId, voiceName: voiceId ? `${name} · saved voice` : undefined, visualRefMods, audioRefMods };
}

export async function h3CharacterVoiceOptions(owner: string, ids: string[]) {
  if (ids.length > 3 || new Set(ids).size !== ids.length) throw Error("Choose one to three different Character Cards.");
  const lanes = await availableLanes(owner);
  const missingCardIds: string[] = [];
  const cast = ids.flatMap(id => {
    const character = loadCharacter(owner, id);
    if (!character) { missingCardIds.push(id); return []; }
    return [castChoices(owner, character, lanes)];
  });
  const complete = cast.length > 0 && !missingCardIds.length;
  const visualMix = complete && lanes.some(lane => lane.nativeWavRefModMix && cast.every(member => member.visualRefMods.some(ref => ref.backend === lane.backend)));
  const combined = complete && lanes.some(lane => cast.every(member => member.audioRefMods.some(ref => ref.backend === lane.backend)));
  return {
    cast,
    diagnostics: { missingCardIds, workers: lanes.map(lane => ({ backend: lane.backend, native: lane.available, visualRefModWav: !!lane.nativeWavRefModMix, combinedRefMod: lane.mixedReferences && !!lane.refModAudioStrength, singularityV13: !!lane.singularityV13 })) },
    checkpoints: [{ id: "standard", available: lanes.length > 0 }, { id: "singularity-v1.3", available: lanes.some(lane => lane.singularityV13) }],
    recipes: [
      { id: "native", available: lanes.length > 0 && (!ids.length || complete), ...(missingCardIds.length ? { reason: "One or more selected Character Cards are missing from this TEST account." } : {}) },
      { id: "visual-refmod-wav", available: visualMix, ...(!visualMix ? { reason: "Each selected character needs a visual RefMod on the same WAV-capable worker." } : {}) },
      { id: "combined-refmod", available: combined, ...(!combined ? { reason: "Each selected character needs a saved voice bundle on the same worker." } : {}) },
    ],
  };
}

function selectionOf(value: unknown): Selection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Choose existing Character Cards.");
  const data = value as Record<string, unknown>;
  const identifier = (key: string, maximum: number) => {
    const text = data[key];
    if (text == null || text === "") return undefined;
    if (typeof text !== "string" || text.length > maximum || /[\x00-\x1f]/.test(text)) throw Error("A selected character, voice or RefMod ID is invalid.");
    return text;
  };
  const characterId = identifier("characterId", 160);
  if (!characterId) throw Error("Choose an existing Character Card.");
  return { characterId, voiceId: identifier("voiceId", 240), visualRefMod: identifier("visualRefMod", 360), audioRefMod: identifier("audioRefMod", 360) };
}

async function trustedFile(req: NextRequest, locator: string, limit: number, label: string) {
  const file = resolveProductionV2MediaPath(locator);
  if (!file || !await productionAudioMediaReadable(req, file)) throw Error(`${label} is unavailable. Select an owned saved reference.`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > limit) throw Error(`${label} is unavailable or too large.`);
  return file;
}

async function getVoice(req: NextRequest, owner: string, character: CharacterRecord, selection: Selection): Promise<VoiceTarget | null> {
  const defaultId = `character-sample:${character.id}`;
  const rawId = selection.voiceId;
  const selected = rawId && rawId !== defaultId
    ? resolveCharacterRefVoice(owner, rawId.startsWith("library:") ? rawId : `library:${rawId}`)
    : character.referenceAudioPath ? { path: character.referenceAudioPath, name: `${character.name} · saved voice`, sourceId: defaultId } : null;
  if (!selected) return null;
  const file = await trustedFile(req, selected.path, CHARACTER_VOICE_MAX_BYTES, `${character.name}'s saved voice`);
  return { characterId: character.id, modelId: selected.sourceId || defaultId,
    sample: { path: file, name: selected.name, description: "Saved character voice reference" }, sha256: await studioFileSha256(file) };
}

export async function resolveSavedH3CorrectionVoice(req: NextRequest, owner: string, characterId: string) {
  const character = loadCharacter(owner, characterId);
  if (!character) return null;
  const id = character.voiceSettings?.voiceId || character.metadata?.storyVoiceId;
  const voiceId = typeof id === "string" ? id : undefined;
  const voice = await getVoice(req, owner, character, {characterId, voiceId}).catch(() => null);
  return voice || getVoice(req, owner, character, {characterId}).catch(() => null);
}

async function probeVoiceDuration(voice: VoiceTarget) {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", ...ALLOWED_AUDIO_ARGS, "-select_streams", "a:0", "-show_entries", "format=duration:stream=codec_type", "-of", "json", voice.sample.path], { timeout: 12_000, maxBuffer: 64 * 1024 });
    const probe = JSON.parse(stdout), duration = Number(probe.format?.duration);
    if (probe.streams?.[0]?.codec_type !== "audio" || !Number.isFinite(duration) || duration < 2) throw Error();
    return duration;
  } catch { throw Error(`${voice.sample.name} needs at least two seconds of readable speech. Choose a different saved sample.`); }
}

/** Keep a common reference window only when the selected recordings exceed the native H3 budget. */
export function nativeH3VoiceWindows(durations: number[]) {
  if (durations.length > 3 || durations.some(seconds => !Number.isFinite(seconds) || seconds < 2)) throw Error("Use up to three voice recordings of at least two seconds each.");
  const clamped = durations.map(seconds => Math.min(15, Math.floor(seconds * 1000) / 1000));
  if (clamped.reduce((total, seconds) => total + seconds, 0) <= 15) return clamped;
  // Use the longest common upper bound that fits, without shortening an already shorter reference.
  let low = 2000, high = 15000;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const sum = clamped.reduce((total, seconds) => total + Math.min(candidate, Math.round(seconds * 1000)), 0);
    if (sum > 15000) high = candidate - 1;
    else low = candidate;
  }
  return clamped.map(seconds => Math.min(seconds, low / 1000));
}

export async function prepareH3CharacterVoices(req: NextRequest, owner: string, body: Record<string, unknown>) {
  const mode = body.mode as ProductionV2H3Mode;
  const durationSeconds = body.durationSeconds;
  if (!MODES.includes(mode)) throw Error("Choose Text, Image, or Reference-to-Video.");
  if (durationSeconds !== 5 && durationSeconds !== 10) throw Error("Choose 5 or 10 seconds.");
  const sourcePrompt = typeof body.prompt === "string" ? body.prompt.replace(/\r\n/g, "\n").trim() : "";
  if (!sourcePrompt || sourcePrompt.length > 4000) throw Error("Enter a prompt of up to 4,000 characters.");
  const refMode = mode === "h3-reference-to-video";
  const dialogueOnly = !refMode || body.dialogueOnly === true || body.recipe === "visual-refmod" || body.experimentalAudioReferences !== true;
  const checkpointMode = body.checkpointMode ?? "standard";
  if (checkpointMode !== "standard" && (checkpointMode !== "singularity-v1.3" || !refMode)) throw Error("The Singularity v1.3 comparison requires Reference-to-Video.");
  const rawRecipe = body.recipe === "auto" || !body.recipe ? "native" : body.recipe;
  if (!H3_CHARACTER_VOICE_RECIPES.includes(rawRecipe as H3CharacterVoiceRecipe)) throw Error("Choose a supported cast reference method.");
  let recipe: H3CharacterVoiceRecipe = !refMode || dialogueOnly && rawRecipe !== "visual-refmod" ? "native" : rawRecipe as H3CharacterVoiceRecipe;
  const orientation = (body.orientation ?? "landscape") as H3Orientation;
  const quality = (body.quality ?? "lq") as H3Quality;
  if (!H3_ORIENTATION_OPTIONS.includes(orientation) || !H3_QUALITY_OPTIONS.includes(quality)) throw Error("Choose a supported H3 orientation and quality.");
  const style = typeof body.stylePresetId === "string" && body.stylePresetId !== "none" ? resolveH3StylePreset(body.stylePresetId) : undefined;
  if (body.stylePresetId && body.stylePresetId !== "none" && !style) throw Error("Choose an available visual style.");
  if (!Array.isArray(body.cast) || body.cast.length < 1 || body.cast.length > 3) throw Error("Choose one to three Character Cards.");
  const selections = body.cast.map(selectionOf);
  if (new Set(selections.map(item => item.characterId)).size !== selections.length) throw Error("Select each cast member only once.");
  const characters = selections.map(selection => {
    const character = loadCharacter(owner, selection.characterId);
    if (!character) throw Error("A selected Character Card is unavailable for this account.");
    return character;
  });
  const readFrame = async (value: unknown): Promise<H3DirectReference | null> => {
    if (value == null) return null;
    const staged = await readCompletedH3StagedUpload(owner, value, "image");
    return { path: staged.path, name: staged.name, description: "Timeline guide" };
  };
  if (mode === "h3-text-to-video" && (body.firstImage || body.lastImage)) throw Error("Use Image or Reference-to-Video for an opening image.");
  if (mode !== "h3-image-to-video" && body.lastImage) throw Error("An ending image requires Image-to-Video.");
  const [firstImage, lastImage, lanes] = await Promise.all([readFrame(body.firstImage), readFrame(body.lastImage), availableLanes(owner)]);
  if (mode === "h3-image-to-video" && !firstImage) throw Error("Choose an opening image for Image-to-Video.");
  const voices = (await Promise.all(characters.map((character, index) => (dialogueOnly ? resolveSavedH3CorrectionVoice(req, owner, character.id) : getVoice(req, owner, character, selections[index]))))).filter((voice): voice is VoiceTarget => !!voice);
  const cast: H3CastBinding[] = characters.map((character, index) => {
    const voice = voices.find(item => item.characterId === character.id);
    return { characterId: character.id, ...approvedCardIdentity(character), subject: `<Subject ${index + 1}>`, visual: [], audio: [], ...(voice ? { voiceId: voice.modelId, voiceName: voice.sample.name } : {}) };
  });
  const choices = characters.map(character => castChoices(owner, character, lanes));
  const modNamesForLane = (lane: H3SmartReferenceCapabilities) => choices.map((choice, index) => {
    const visualMix = recipe === "visual-refmod-wav" || recipe === "visual-refmod";
    const explicit = visualMix ? selections[index].visualRefMod : selections[index].audioRefMod;
    if (recipe === "visual-refmod-wav" && !lane.nativeWavRefModMix) return undefined;
    return (visualMix ? choice.visualRefMods : choice.audioRefMods).find(mod => mod.backend === lane.backend && (!explicit || mod.name === explicit))?.name;
  });
  const desired = body.targetBackend;
  if (desired && !["auto", "rtx3090", "rtx5060ti"].includes(String(desired))) throw Error("Choose a supported H3 GPU.");
  const compatibleLanes = lanes.filter(candidate => (!desired || desired === "auto" || candidate.backend === desired)
    && (checkpointMode === "standard" || candidate.singularityV13)
    && (!firstImage || !refMode || candidate.firstFrame));
  const verifiedVisualLane = (candidate: H3SmartReferenceCapabilities) =>
    recipe !== "visual-refmod" || candidate.refModVisualSelection === true;
  let lane = compatibleLanes.find(candidate => recipe === "native"
    || verifiedVisualLane(candidate) && modNamesForLane(candidate).every(Boolean));
  const fallbackToPictures = !lane && recipe === "visual-refmod";
  if (fallbackToPictures) {
    recipe = "native";
    lane = compatibleLanes[0];
  }
  if (!lane) throw Error(recipe === "native" ? "No compatible H3 worker is available for this request." : "The cast does not have all required RefMods on one compatible worker. Choose Native or select compatible RefMods.");
  const references: H3SmartReferenceMapEntry[] = [];
  const images: H3DirectReference[] = [], audios: H3DirectReference[] = [];
  let refMods: H3CharacterVoicePlan["refMods"] = [];
  if (refMode && recipe === "native") {
    const files = await Promise.all(characters.map(async character => {
      const catalog = characterToProductionV2Catalog(character);
      const locator = catalog.characterCard?.workflowImage || catalog.defaultImage?.workflowImage;
      return trustedFile(req, locator || "", 128 * 1024 * 1024, `${character.name}'s Character Card image`);
    }));
    files.forEach((file, index) => {
      const entry = cast[index], tag = `<Picture ${index + 1}>`;
      images.push({ path: file, name: entry.name, description: "Character Card identity" });
      entry.visual.push(tag);
      references.push({ tag, name: entry.name, kind: "image", source: "image", description: "Character Card identity", characterKey: entry.characterId, characterName: entry.name });
    });
  }
  const wavVoices = refMode && recipe !== "combined-refmod" && !dialogueOnly ? voices : [];
  const voiceDurations = await Promise.all(wavVoices.map(probeVoiceDuration));
  const nativeVoiceSeconds = nativeH3VoiceWindows(voiceDurations);
  if (wavVoices.length) {
    wavVoices.forEach((voice, index) => {
      const entry = cast.find(member => member.characterId === voice.characterId)!;
      const tag = `<Audio ${index + 1}>`;
      audios.push(voice.sample);
      entry.audio.push(tag);
      references.push({ tag, kind: "audio", source: "media", name: voice.sample.name, description: "Saved character voice", characterKey: entry.characterId, characterName: entry.name, voiceId: voice.modelId });
    });
  }
  if (recipe !== "native") {
    const names = modNamesForLane(lane) as string[];
    refMods = names.map((name, index) => {
      const candidate = lane.refMods.find(item => item.name === name)!;
      return { id: cast[index].characterId, name, category: "character", sourceKind: candidate.kind as H3CharacterVoicePlan["refMods"][number]["sourceKind"],
        strength: 1, copies: 1, components: recipe === "combined-refmod" ? "All" : "Visual", visualStrength: 1,
        audioStrength: recipe === "combined-refmod" ? 1 : 0, description: "Saved character identity", characterId: cast[index].characterId };
    });
    if (recipe === "combined-refmod") await Promise.all(refMods.map(async slot => {
      const saved = readH3RefModSidecar(slot.name), voice = voices.find(item => item.characterId === slot.characterId);
      if (!saved?.voice || !voice || voice.sha256 !== saved.voice.sha256) throw Error(`The selected RefMod has a different saved voice version for ${saved?.name || "this character"}. Use Native or visual RefMod plus WAV for the current voice.`);
      await assertCharacterRefVoiceIntact(saved.voice);
    }));
    const checked = checkH3SmartReferences(lane, { useFirstFrame: false, refMods }, [], 0, 0, false);
    if (checked.counts.audio + audios.length > lane.maxAudios || checked.referenceMap.length + audios.length > lane.maxTotalReferenceMedia) throw Error("The selected cast exceeds this H3 workflow's reference limits.");
    for (const ref of checked.referenceMap) {
      const entry = cast.find(member => member.characterId === ref.characterKey);
      if (!entry) throw Error("A selected RefMod does not resolve to its Character Card.");
      (ref.kind === "audio" ? entry.audio : entry.visual).push(ref.tag);
      references.push({ ...ref, characterName: entry.name, ...(ref.kind === "audio" ? { voiceId: entry.voiceId } : {}) });
    }
    if (cast.some(member => !member.visual.length)) throw Error("A selected RefMod has no verified visual component.");
  }
  const compiled = compileH3CharacterVoices({ prompt: sourcePrompt, cast, references, mode, durationSeconds, firstImage: !!firstImage, lastImage: !!lastImage, style: style ?? undefined, dialogueOnly });
  const hashes = await Promise.all([firstImage, lastImage, ...images].filter((file): file is H3DirectReference => !!file).map(async file => [file.path, await studioFileSha256(file.path)] as const));
  const inputHashes = Object.fromEntries([...hashes, ...wavVoices.map(voice => [voice.sample.path, voice.sha256])]);
  const refModSignatures = Object.fromEntries(refMods.map(slot => [slot.name, h3RefModSignature(lane.refMods.find(candidate => candidate.name === slot.name)!)]));
  const plan: H3CharacterVoicePlan = { recipe, ...(dialogueOnly || recipe === "visual-refmod" ? { nativeAudio: true as const } : {}), bindings: compiled.bindings, events: compiled.events, sharedIdentityPrompt: compiled.sharedIdentityPrompt, nativeVoiceSeconds, references, refMods, refModSignatures, inputHashes, voiceTargets: voices };
  if (body.seed !== undefined && (typeof body.seed !== "number" || !Number.isSafeInteger(body.seed) || body.seed < 0)) throw Error("Use a non-negative integer H3 seed.");
  const seed = body.seed as number | undefined;
  const input: H3DirectJobInput = { characterVoices: plan, targetBackend: lane.backend, mode, quality, orientation, durationSeconds, prompt: compiled.prompt,
    promptFormat: "minimax-official-v1", preserveExactPrompt: true, h3Settings: normalizeH3AdvancedSettings({ renderMode: "native", checkpointMode }, images.length), seed: seed ?? 0,
    optionalLoras: [], firstImage, lastImage, images, audios, videos: [] };
  const compatibility = await inspectH3BackendCompatibility(lane.backend, { userLoraFilenames: [], mode, h3Settings: input.h3Settings, referenceCount: images.length });
  if (!compatibility.compatible) throw Error("The selected worker does not have the required H3 workflow, model or encoders.");
  const graph = validateH3CharacterVoiceAssembly(input, lane.backend);
  const fingerprint = createHash("sha256").update(JSON.stringify({ owner, dialogueOnly, backend: lane.backend, mode, checkpointMode, quality, orientation, durationSeconds, seed, prompt: compiled.prompt, plan, roles: [firstImage?.path, lastImage?.path, ...images.map(file => file.path), ...audios.map(file => file.path)] })).digest("hex");
  const clippedVoiceSamples = wavVoices.flatMap((voice, index) => voiceDurations[index] - nativeVoiceSeconds[index] >= 0.01
    ? [{ characterId: voice.characterId, fromSeconds: voiceDurations[index], referenceSeconds: nativeVoiceSeconds[index] }] : []);
  const warning = fallbackToPictures ? "This worker could not verify the visual RefMods. Using the approved Character Card pictures."
    : !refMode || dialogueOnly ? null
    : clippedVoiceSamples.length ? "H3 uses the opening portion of longer saved samples to fit its 15-second reference limit. Review the reference lengths below." : null;
  return { input, seed, preview: { ...compiled, recipe, checkpointMode, backend: lane.backend, fingerprint, warning, graph, clippedVoiceSamples } };
}

export function buildH3CharacterVoiceSubmission(input: H3DirectJobInput, backend: ProductionV2H3BackendId, filenames: {
  first: string; last: string; images: string[]; audios: string[]; outputPrefix: string;
}) {
  const plan = input.characterVoices!;
  if (!plan || filenames.images.length !== input.images.length || filenames.audios.length !== input.audios.length || input.videos.length || input.optionalLoras.length) throw Error("The Character Voices request no longer matches its reference graph.");
  const built = buildH3Workflow({ mode: input.mode, backend, h3Quality: input.quality, durationSeconds: input.durationSeconds, orientation: input.orientation,
    finalPrompt: input.prompt, preserveExactPrompt: true, seed: input.seed, outputPrefix: filenames.outputPrefix, h3Settings: input.h3Settings,
    startImageFilename: filenames.first, lastImageFilename: filenames.last, smartReferenceMap: plan.references, userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    references: input.images.map((image, index) => ({ id: `cast-${index}`, sourceId: `cast-${index}`, sourceKind: "production-upload", generationSourceType: "production-upload", name: image.name, workflowImage: image.path, uploadedFilename: filenames.images[index], pictureSlot: (index + 1) as 1 | 2 | 3, subjectSlot: (index + 1) as 1 | 2 | 3 })),
    voices: input.audios.map((voice, index) => ({ characterId: `cast-voice-${index}`, snapshotName: voice.name, sourcePath: voice.path, uploadedFilename: filenames.audios[index], audioSlot: (index + 1) as 1 | 2 | 3, subjectSlot: (index + 1) as 1 | 2 | 3, speakerId: (index + 1) as 1 | 2 | 3 })),
  });
  applyH3CharacterVoiceGraph(built.graph, plan, input.mode, filenames.audios, filenames.images);
  if (plan.nativeAudio) assertNativeH3AudioGraph(built.graph);
  return built;
}

/** Matches the upload basename from the shared production adapter. Unexpected worker names fail the approved graph check. */
export function h3DirectQualificationFilenames(jobId: string, input: H3DirectJobInput) {
  const upload = (reference: H3DirectReference | null, suffix: string) => reference ? `${safeSegment(`${jobId}_${suffix}`)}${path.extname(reference.path).toLowerCase()}` : "";
  return { first: upload(input.firstImage, "first"), last: upload(input.lastImage, "last"), outputPrefix: `otg_h3_direct/${safeSegment(jobId)}`,
    images: input.images.map((reference, index) => upload(reference, `picture_${index + 1}`)),
    audios: input.audios.map((reference, index) => upload(reference, `audio_${index + 1}`)) };
}

export function validateH3CharacterVoiceAssembly(input: H3DirectJobInput, backend: ProductionV2H3BackendId) {
  const plan = input.characterVoices!;
  const built = buildH3CharacterVoiceSubmission(input, backend, { first: input.firstImage ? "opening.png" : "", last: input.lastImage ? "ending.png" : "",
    outputPrefix: "otg_h3_cast_validation", images: input.images.map((_, index) => `picture-${index + 1}.png`), audios: input.audios.map((_, index) => `voice-${index + 1}.wav`) });
  return { encoder: built.graph["39"].class_type, referenceInputs: Object.keys(built.graph["39"].inputs).filter(key => /^ref_|^first_frame$|^last_frame$|^references$|^mods$/.test(key)),
    checkpoint: Object.values(built.graph).find(node => node.class_type === "UNETLoader")?.inputs.unet_name,
    openingGuide: Object.values(built.graph).some(node => node.class_type === "MiniMaxH3AddGuide" && node.inputs.frame_idx === 0),
    wavBundleInputs: Object.keys(built.graph.character_voice_wavs?.inputs ?? {}), audioVae: Array.isArray(built.graph["39"].inputs.audio_vae),
    referenceMap: plan.references };
}

export async function pinH3CharacterVoiceInputs(owner: string, input: H3DirectJobInput, seed?: number) {
  const dir = path.join(OTG_DATA_ROOT, "h3-direct", safeSegment(owner), "uploads", randomUUID());
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const plan = input.characterVoices!;
    const voiceWindows = plan.nativeVoiceSeconds ?? [];
    if (voiceWindows.length !== input.audios.length || nativeH3VoiceWindows(voiceWindows).some((seconds, index) => seconds !== voiceWindows[index])) throw Error("The reviewed cast audio durations changed. Preview the current character voices again.");
    const files: Record<string, string> = {};
    const save = async (source: H3DirectReference, name: string, voiceDuration?: number) => {
      if (await studioFileSha256(source.path) !== plan.inputHashes[source.path]) throw Error("A reviewed cast reference changed. Preview the current character voices again.");
      const audio = voiceDuration !== undefined;
      const output = path.join(dir, `${name}.${audio ? "wav" : "png"}`);
      if (audio) {
        await run("ffmpeg", ["-v", "error", "-nostdin", "-n", ...ALLOWED_AUDIO_ARGS, "-i", source.path, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "32000", "-t", String(voiceDuration), "-c:a", "pcm_s16le", output], { timeout: 30_000, maxBuffer: 128 * 1024 });
        const actual = await probeVoiceDuration({ characterId: "", modelId: "", sample: { ...source, path: output }, sha256: "" });
        if (actual > voiceDuration + 0.0001) throw Error("A prepared voice exceeds its reviewed H3 reference duration.");
      } else {
        await sharp(source.path, { limitInputPixels: 64_000_000 }).rotate().png().toFile(output);
      }
      if (await studioFileSha256(source.path) !== plan.inputHashes[source.path]) throw Error("A reviewed cast reference changed during preparation. Preview it again.");
      files[output] = await studioFileSha256(output);
      return { ...source, path: output };
    };
    const [firstImage, lastImage, images, audios] = await Promise.all([
      input.firstImage ? save(input.firstImage, "opening") : null,
      input.lastImage ? save(input.lastImage, "ending") : null,
      Promise.all(input.images.map((image, index) => save(image, `picture-${index + 1}`))),
      Promise.all(input.audios.map((voice, index) => save(voice, `voice-${index + 1}`, voiceWindows[index]))),
    ]);
    const ready = { ...input, characterVoices: { ...plan, inputHashes: files }, seed: seed ?? randomInt(0, 2 ** 47), firstImage, lastImage, images, audios };
    validateH3CharacterVoiceAssembly(ready, ready.targetBackend!);
    return ready;
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
