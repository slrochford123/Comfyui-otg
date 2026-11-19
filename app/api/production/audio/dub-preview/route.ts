import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { runtimePath } from "@/lib/runtime/configPaths";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

import { GET as listVoiceModels } from "@/app/api/voice/models/route";
import { POST as convertVoicePerformance } from "@/app/api/voice/dub/route";
import { loadCharacter } from "@/lib/characters/store";
import { assertSameOrigin, RequestError } from "@/lib/routeSecurity";
import { alignActedTake, compareObservedSpeech, extractCorrectionLine, extractCorrectionSoundtrack, muxCorrectionVideo, openCorrectionMixer, prepareActedTake, transcribeCorrectionLines } from "@/lib/fixVoicesAudio";
import { MAX_VOICE_LEVEL_DB, MIN_VOICE_LEVEL_DB, speakerIntervalsOverlap } from "@/lib/fixVoicesDsp";
import { MAX_SCENE_FINE_TUNE, type SceneFineTune } from "@/lib/fixVoicesSceneMatch";
import { assertFixVoicesTest, correctionCastPlan, correctionMediaUrl, correctionPath, readCorrectionRecord, saveCorrectionPreview, verifiedCorrectionVoice, writeCorrectionRecord, type VoiceCorrectionAnalysis, type VoiceCorrectionPreview, type VoiceCorrectionResult, type VoiceCorrectionSkip } from "@/lib/fixVoicesSession";
import { SessionInvalidError } from "@/lib/ownerKey";
import {
  productionAudioAnalysisRoot,
  productionAudioGalleryRoots,
  productionAudioProductionsRoot,
} from "@/lib/productionAudioSourcePaths";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { productionAudioOwner, productionAudioMediaReadable, ProductionAudioAccessError } from "@/lib/productionAudioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const GALLERY_PROFILE = process.env.OTG_GALLERY_PROFILE || "test_profile";
const CONFIGURED_GALLERY_DIR = process.env.OTG_GALLERY_DIR || "";
const COMFY_INPUT_DIR = process.env.OTG_COMFY_INPUT_DIR || runtimePath("comfyui", "input");
const COMFY_OUTPUT_DIR = process.env.OTG_COMFY_OUTPUT_DIR || runtimePath("comfyui", "output");
const FFMPEG_BIN = process.env.OTG_FFMPEG_BIN || process.env.FFMPEG_PATH || "ffmpeg";

function safeName(value: unknown, fallback = "clip") {
  const raw = String(value || fallback).trim();
  const base = path.basename(raw).replace(/[<>:"|?*\x00-\x1F]+/g, "_").trim();
  return base || fallback;
}

function fileNameFromUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "http://local");
    return safeName(
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("file") ||
      path.basename(parsed.pathname),
      "",
    );
  } catch {
    return safeName(raw, "");
  }
}

function isLikelyVideoName(value: unknown) {
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(String(value || "").trim());
}

async function ownerKeyFromRequest(request: NextRequest) {
  return productionAudioOwner(request);
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findRecursive(root: string, wantedFileName: string): Promise<string> {
  try {
    const rows = await fs.readdir(root, { withFileTypes: true });
    for (const row of rows) {
      const full = path.join(root, row.name);
      if (row.isFile() && row.name.toLowerCase() === wantedFileName.toLowerCase()) return full;
      if (row.isDirectory()) {
        const found = await findRecursive(full, wantedFileName);
        if (found) return found;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function apiFilePathFromUrl(value: string) {
  try {
    const parsed = new URL(value, "http://local");
    if (parsed.pathname !== "/api/file") return "";
    const rawPath = String(parsed.searchParams.get("path") || "").trim();
    return rawPath ? path.resolve(rawPath) : "";
  } catch {
    return "";
  }
}

async function findSourceVideo(body: any, request: NextRequest, workDir: string) {
  const sourcePath = String(body.sourcePath || body.path || "").trim();
  const sourceUrl = String(body.sourceUrl || "").trim();
  const sourceUrlName = fileNameFromUrl(sourceUrl);
  const requestedNameRaw = String(body.sourceFileName || body.fileName || sourceUrlName || "").trim();
  const requestedNames = Array.from(new Set([
    requestedNameRaw,
    safeName(requestedNameRaw, ""),
    requestedNameRaw.replace(/^\d+_/, ""),
    safeName(requestedNameRaw.replace(/^\d+_/, ""), ""),
    sourceUrlName,
    safeName(sourceUrlName, ""),
  ].map((item) => String(item || "").trim()).filter(Boolean)));

  const ownerKey = await ownerKeyFromRequest(request);
  const galleryRoots = productionAudioGalleryRoots(ownerKey, {
    configuredGalleryDir: CONFIGURED_GALLERY_DIR,
    galleryProfile: GALLERY_PROFILE,
  });

  const apiFilePath = apiFilePathFromUrl(sourceUrl);
  const candidates: string[] = [];
  if (sourcePath && path.isAbsolute(sourcePath)) candidates.push(sourcePath);
  if (apiFilePath) candidates.push(apiFilePath);

  for (const name of requestedNames) {
    for (const galleryRoot of galleryRoots) {
      candidates.push(path.join(galleryRoot, name));
    }
    candidates.push(path.join(COMFY_OUTPUT_DIR, name));
    candidates.push(path.join(COMFY_INPUT_DIR, name));
  }

  for (const candidate of candidates) {
    if (await exists(candidate) && await productionAudioMediaReadable(request, candidate)) {
      if (!isLikelyVideoName(requestedNameRaw) || isLikelyVideoName(candidate)) return candidate;
    }
  }

  const productionRoot = path.join(productionAudioProductionsRoot(), safeSegment(ownerKey));
  for (const name of requestedNames) {
    const found = await findRecursive(productionRoot, name);
    if (found && await productionAudioMediaReadable(request, found) && (!isLikelyVideoName(requestedNameRaw) || isLikelyVideoName(found))) return found;
  }

  throw new ProductionAudioAccessError();
}

async function muxDubbedAudio(sourceVideoPath: string, dubbedAudioPath: string, outputPath: string) {
  const {stdout}=await execFileAsync(process.env.OTG_FFPROBE_BIN||"ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",sourceVideoPath],{timeout:30000});
  const duration=Number(stdout.trim());
  if(!Number.isFinite(duration)||duration<=0)throw Error("Cannot verify source video duration; original retained.");
  await execFileAsync(
    FFMPEG_BIN,
    ["-y", "-i", sourceVideoPath, "-i", dubbedAudioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-af",`apad,atrim=0:${duration}`,"-t",String(duration), outputPath],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 20, windowsHide: true },
  );
}

// OTG_AUDIO_STUDIO_SEGMENT_FIRST_DUB_V36BPW5
type AudioStudioVoiceSegmentV36BPW5 = {
  start: number;
  end: number;
  blockedReason?: string;
};

type AudioStudioVoiceMappingV36BPW5 = {
  voiceId: string;
  characterId: string;
  voiceModelId: string;
  voicePath: string;
  modelPath: string;
  indexPath: string;
  samplePath: string;
  voiceName: string;
  engine: string;
  dubMode: string;
  emotion: string;
  replacementText: string;
  segments: AudioStudioVoiceSegmentV36BPW5[];
};

type AudioStudioRenderedSegmentV36BPW5 = {
  mapping: AudioStudioVoiceMappingV36BPW5;
  segment: AudioStudioVoiceSegmentV36BPW5;
  audioPath: string;
};

function normalizeSecondsV36BPW5(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.round(next * 1000) / 1000) : 0;
}

function normalizeSegmentsV36BPW5(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((segment: any) => {
      const start = normalizeSecondsV36BPW5(segment?.start ?? segment?.startSeconds ?? segment?.from ?? segment?.begin);
      const end = normalizeSecondsV36BPW5(segment?.end ?? segment?.endSeconds ?? segment?.to ?? segment?.stop);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean) as AudioStudioVoiceSegmentV36BPW5[];
}

function segmentsForDetectedVoiceV36BPW5(body: any, voiceId: string) {
  const voices = Array.isArray(body?.audioClipAnalysis?.voices) ? body.audioClipAnalysis.voices : [];
  const found = voices.find((voice: any, index: number) => (
    String(voice?.id || voice?.voiceId || voice?.speakerId || `speaker_${index + 1}`).trim() === voiceId
  ));
  return normalizeSegmentsV36BPW5(found?.segments);
}

async function analyzedDialogueStem(request: NextRequest, owner: string, body: any, source: string) {
  const id = String(body?.audioClipAnalysis?.runId || "");
  if (!/^audio(?:-[a-f0-9-]{36}|_[0-9]+_[a-f0-9]+)$/.test(id)) throw new RequestError("Analyze the original clip to isolate its speech before converting voices.", 422);
  const root = process.env.OTG_AUDIO_ANALYSIS_DIR || productionAudioAnalysisRoot();
  const work = path.join(root, safeSegment(owner), id);
  const analysis = await fs.readFile(path.join(work, "analysis.json"), "utf8").then(value => JSON.parse(value)).catch(() => null);
  const stem = String(analysis?.separation?.dialogueStemPath || "");
  if (!analysis?.sourcePath || analysis.separation?.tool !== "demucs" || !await exists(stem) || !await productionAudioMediaReadable(request, stem)) {
    throw new RequestError("The analysis did not produce an isolated dialogue track. Run Analyze Clip again with speech separation available.", 422);
  }
  if (await fs.realpath(source) !== await fs.realpath(analysis.sourcePath)) throw new RequestError("This audio analysis belongs to another clip. Analyze the selected video again.", 422);
  return {stem, voices: analysis.voices || []};
}

function normalizeVoiceMappingsV36BPW5(body: any) {
  const rawMappings = Array.isArray(body?.voiceMappings) ? body.voiceMappings : [];
  const normalized = rawMappings
    .map((mapping: any, index: number) => {
      const voiceId = String(mapping?.voiceId || mapping?.mappedVoiceId || mapping?.speakerId || `speaker_${index + 1}`).trim();
      const voicePath = String(mapping?.voicePath || mapping?.voice_path || "").trim();
      const modelPath = String(mapping?.modelPath || mapping?.trainedModelPath || "").trim();
      const indexPath = String(mapping?.indexPath || mapping?.trainedIndexPath || "").trim();
      if (!voiceId || (!voicePath && (!modelPath || !indexPath))) return null;
      const explicitSegments = normalizeSegmentsV36BPW5(mapping?.segments);
      return {
        voiceId,
        characterId: String(mapping?.characterId || "").trim(),
        voiceModelId: String(mapping?.voiceModelId || mapping?.targetVoiceId || "").trim(),
        voicePath,
        modelPath,
        indexPath,
        samplePath: String(mapping?.samplePath || mapping?.approvedSamplePath || mapping?.voiceSamplePath || "").trim(),
        voiceName: String(mapping?.voiceName || mapping?.targetVoiceName || "").trim(),
        engine: String(mapping?.engine || (modelPath && indexPath ? "applio" : "auto")).trim(),
        dubMode: String(mapping?.dubMode || mapping?.dub_mode || body?.dubMode || body?.dub_mode || "preserve_performance").trim(),
        emotion: String(mapping?.emotion || body?.emotion || "preserve").trim(),
        replacementText: String(mapping?.replacementText || mapping?.replacement_text || body?.replacementText || body?.replacement_text || "").trim(),
        segments: explicitSegments.length ? explicitSegments : segmentsForDetectedVoiceV36BPW5(body, voiceId),
      };
    })
    .filter(Boolean) as AudioStudioVoiceMappingV36BPW5[];

  if (normalized.length) return normalized;

  const fallbackVoicePath = String(body?.voicePath || body?.voice_path || "").trim();
  if (!fallbackVoicePath) return [];

  return [{
    voiceId: String(body?.mappedVoiceId || "speaker_1"),
    characterId: String(body?.characterId || ""),
    voiceModelId: String(body?.voiceModelId || ""),
    voicePath: fallbackVoicePath,
    modelPath: String(body?.modelPath || body?.trainedModelPath || "").trim(),
    indexPath: String(body?.indexPath || body?.trainedIndexPath || "").trim(),
    samplePath: String(body?.samplePath || body?.approvedSamplePath || "").trim(),
    voiceName: "",
    engine: String(body?.engine || "auto").trim(),
    dubMode: String(body?.dubMode || body?.dub_mode || "preserve_performance").trim(),
    emotion: String(body?.emotion || "preserve").trim(),
    replacementText: String(body?.replacementText || body?.replacement_text || "").trim(),
    segments: [],
  }];
}

async function runMappedVoiceDubForSegmentV36BPW5(
  request: NextRequest,
  segmentPath: string,
  mapping: AudioStudioVoiceMappingV36BPW5,
  title: string,
  strict = false,
) {
  const segmentBytes = await fs.readFile(segmentPath);
  const form = new FormData();
  form.append("performance_audio", new Blob([new Uint8Array(segmentBytes)], { type: "audio/wav" }), path.basename(segmentPath));
  form.append("voice_path", mapping.voicePath || mapping.samplePath || mapping.modelPath);
  form.append("model_path", mapping.modelPath);
  form.append("index_path", mapping.indexPath);
  form.append("voice_sample_path", mapping.samplePath);
  form.append("engine", mapping.engine || (mapping.modelPath && mapping.indexPath ? "applio" : "auto"));
  form.append("title", title);
  form.append("dub_mode", mapping.dubMode || "preserve_performance");
  form.append("emotion", mapping.emotion || "preserve");
  form.append("replacement_text", mapping.replacementText || "");
  form.append("character_id", mapping.characterId || "");
  form.append("voice_model_id", mapping.voiceModelId || "");

  if (strict) form.append("preserve_h3_performance", "1");
  const dubResponse = strict
    ? await convertVoicePerformance(new NextRequest(new URL("/api/voice/dub", request.url), {method: "POST", body: form, headers: {cookie: request.headers.get("cookie") || ""}}))
    : await fetch(new URL("/api/voice/dub", request.nextUrl.origin), {
      method: "POST", body: form, headers: {cookie: request.headers.get("cookie") || ""}, cache: "no-store",
    });

  const dubJson = await dubResponse.json().catch(() => null);
  if (!dubResponse.ok || !dubJson?.ok) {
    if (strict) throw new RequestError(dubResponse.status === 409 ? "The voice conversion GPU is busy. Try again shortly." : `${mapping.voiceName} could not be converted with ${mapping.engine}. The original was preserved.`, dubResponse.status === 409 ? 409 : 422);
    throw new Error(dubJson?.error || `Voice dub failed (${dubResponse.status}).`);
  }
  if (strict && (dubJson.engine !== mapping.engine || dubJson.sourceSpeechMode !== "source-performance")) throw new RequestError("The converter returned an unexpected engine or speech source. The original was preserved.", 422);

  const dubbedAudioPath = String(dubJson.audioPath || "").trim();
  if (!dubbedAudioPath || !fssync.existsSync(dubbedAudioPath)) {
    throw new Error("Voice dub completed but did not return a readable dubbed audio file.");
  }

  return { audioPath: dubbedAudioPath, dub: dubJson };
}

async function renderSegmentFirstDubV36BPW5(
  request: NextRequest,
  owner: string,
  sourceVideoPath: string,
  voiceMappings: AudioStudioVoiceMappingV36BPW5[],
  workDir: string,
  body: any,
) {
  const {stem, voices} = await analyzedDialogueStem(request, owner, body, sourceVideoPath);
  const soundtrack = await extractCorrectionSoundtrack(sourceVideoPath, workDir, false);
  const mixer = await openCorrectionMixer({...soundtrack, speech: stem});
  const renderedSegments: AudioStudioRenderedSegmentV36BPW5[] = [];
  const baseTitle = safeName(body.title || "audio_studio_dub", "audio_studio_dub");
  const skippedSegments: Array<AudioStudioVoiceSegmentV36BPW5 & {voiceId: string; reason: string}> = [];
  const allTurns = (voices as {id: string; segments: AudioStudioVoiceSegmentV36BPW5[]}[]).flatMap(voice => voice.segments.map(segment => ({...segment, voiceId: voice.id})));
  for (const [mappingIndex, mapping] of voiceMappings.entries()) {
    const segments = mapping.segments.length ? mapping.segments : allTurns.filter(turn => turn.voiceId === mapping.voiceId);
    if (!segments.length) throw new RequestError(`Detected ${mapping.voiceId} has no diarized speech intervals. Re-analyze the clip.`, 422);
    for (const [segmentIndex, segment] of segments.entries()) {
      const overlaps = allTurns.some(turn => turn.voiceId !== mapping.voiceId && speakerIntervalsOverlap(segment, turn));
      const blocked = overlaps ? "Speech overlaps a different speaker." : mixer.rejectInterval(segment);
      if (blocked) {
        skippedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, reason: blocked});
        continue;
      }
      const segmentPath = safeJoin(workDir, `speaker-${mappingIndex + 1}-${segmentIndex + 1}.wav`);
      await extractCorrectionLine(stem, segment, segmentPath);
      const dubbed = await runMappedVoiceDubForSegmentV36BPW5(request, segmentPath, mapping, `${baseTitle}_${safeSegment(mapping.voiceId)}_${segmentIndex + 1}`);
      const reason = await mixer.apply({...segment, audioPath: dubbed.audioPath});
      if (reason) {
        skippedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, reason});
        continue;
      }
      renderedSegments.push({mapping, segment, audioPath: dubbed.audioPath});
    }
  }
  if (!renderedSegments.length) throw new RequestError(skippedSegments[0]?.reason || "No isolated dialogue was converted. The original is available.", 422);
  const dubbedAudioPath = safeJoin(workDir, "corrected-soundtrack.wav");
  await mixer.write(dubbedAudioPath);
  return {dubbedAudioPath, renderedSegments, skippedSegments, mixPlan: {sourceBedKind: "original_audio_with_selected_dialogue_replaced", sourceBedKeepsOriginalDialogue: true}};
}

type CorrectionTarget = {id: string; name: string; engine: string; path: string; samplePath?: string; modelPath?: string; indexPath?: string; characterId?: string};
type CorrectionTake = {file: File; voiceId: string; segmentIndex: number};

async function remixFixVoices(request: NextRequest, owner: string, body: Record<string, unknown>) {
  if (body.matchOriginalScene !== undefined && typeof body.matchOriginalScene !== "boolean") {
    throw new RequestError("Match Original Scene must be on or off.", 400);
  }
  const matchOriginalScene = body.matchOriginalScene === true;
  const currentId = String(body.previewId || "");
  const current = await readCorrectionRecord<VoiceCorrectionPreview>(owner, currentId, "preview");
  const sourceId = current.sourcePreviewId || currentId;
  const source = sourceId === currentId ? current : await readCorrectionRecord<VoiceCorrectionPreview>(owner, sourceId, "preview");
  const files = source.convertedFiles;
  if (!files?.length || files.length !== source.renderedSegments.length) {
    throw new RequestError("The converted speech for this preview is unavailable. Convert the original clip again to adjust the levels.", 422);
  }
  const allowed = new Set(source.renderedSegments.map(segment => segment.voiceId));
  const levels = new Map<string, number>();
  if (!Array.isArray(body.speakerLevels) || body.speakerLevels.length > allowed.size) {
    throw new RequestError("Choose one level per converted speaker.", 400);
  }
  for (const entry of body.speakerLevels) {
    const voiceId = entry?.voiceId;
    const levelDb = entry?.levelDb;
    if (typeof voiceId !== "string" || !allowed.has(voiceId) || levels.has(voiceId)
        || typeof levelDb !== "number" || !Number.isInteger(levelDb) || levelDb < MIN_VOICE_LEVEL_DB || levelDb > MAX_VOICE_LEVEL_DB) {
      throw new RequestError("Choose a level between −18 and +6 dB for each converted speaker.", 400);
    }
    levels.set(voiceId, levelDb);
  }
  const fineTune = new Map<number, SceneFineTune>();
  const adjustments = body.cueAdjustments ?? [];
  if (!Array.isArray(adjustments) || adjustments.length > source.renderedSegments.length || (!matchOriginalScene && adjustments.length)) {
    throw new RequestError("Select Match Original Scene to fine-tune converted lines.", 400);
  }
  for (const entry of adjustments) {
    const index = entry?.cueIndex;
    const distance = entry?.distance;
    const reflections = entry?.reflections;
    if (!Number.isInteger(index) || index < 0 || index >= source.renderedSegments.length || fineTune.has(index)
        || ![distance, reflections].every(value => Number.isInteger(value) && Math.abs(value) <= MAX_SCENE_FINE_TUNE)) {
      throw new RequestError("Choose valid Fine-Tune settings for each converted line.", 400);
    }
    fineTune.set(index, {distance, reflections});
  }
  const analysis = await readCorrectionRecord<VoiceCorrectionAnalysis>(owner, source.analysisId, "analysis");
  if (!analysis.mixReady || !analysis.mixSource || !await productionAudioMediaReadable(request, analysis.sourcePath)) {
    throw new RequestError("The original audio for this preview is unavailable.", 422);
  }
  const originalWorkDir = correctionPath(owner, sourceId, "preview");
  const mixer = await openCorrectionMixer(analysis.mixSource);
  const renderedSegments: VoiceCorrectionResult[] = [];
  const skippedSegments = [...source.skippedSegments];
  for (const [index, original] of source.renderedSegments.entries()) {
    const segment = {...original, cueIndex: index, levelDb: levels.get(original.voiceId) ?? 0, fineTune: fineTune.get(index)};
    if (request.signal.aborted) throw new RequestError("Voice level adjustment was cancelled.", 409);
    const file = files[index];
    if (!/^converted-[a-f0-9-]{36}\.wav$/.test(file)) throw new ProductionAudioAccessError();
    const audioPath = path.join(originalWorkDir, file);
    if (!(await fs.lstat(audioPath).catch(() => null))?.isFile()) {
      throw new RequestError("A converted line for this preview is unavailable.", 422);
    }
    const unsafe = mixer.rejectInterval(segment);
    const edit = {...segment, audioPath};
    let reason = unsafe;
    if (!reason && matchOriginalScene) {
      const attempt = await mixer.applySceneMatched(edit);
      segment.sceneMatch = attempt.sceneMatch;
      segment.fineTuneWarning = attempt.fineTuneWarning;
      reason = attempt.reason;
    } else if (!reason) {
      reason = await mixer.apply(edit);
    }
    if (reason.includes("clip the")) throw new RequestError("That voice level would distort the soundtrack. Try a lower level.", 422);
    if (reason) skippedSegments.push({start: segment.start, end: segment.end, voiceId: segment.voiceId, reason});
    else renderedSegments.push(segment);
  }
  if (!renderedSegments.length) throw new RequestError("No converted lines can be adjusted safely. The original audio is available.", 422);
  const previewId = `audio-dub-${randomUUID()}`;
  const workDir = correctionPath(owner, previewId, "preview");
  await fs.mkdir(workDir, {recursive: true, mode: 0o700});
  let completed = false;
  try {
    const mixed = path.join(workDir, "corrected-soundtrack.wav");
    const previewPath = path.join(workDir, analysis.sourcePath.endsWith(".webm") ? "corrected.webm" : "corrected.mp4");
    await mixer.write(mixed);
    await muxCorrectionVideo(analysis.sourcePath, mixed, previewPath);
    await writeCorrectionRecord(owner, previewId, "preview", {
      previewPath, contentMode:source.contentMode, sourceFileName: source.sourceFileName, analysisId: source.analysisId, sourceJobId: source.sourceJobId,
      sourcePreviewId: sourceId, matchOriginalScene, renderedSegments, skippedSegments,
    });
    completed = true;
    return NextResponse.json({ok: true, previewId, previewVideoUrl: correctionMediaUrl(previewPath), unadjustedVideoUrl: correctionMediaUrl(source.previewPath),
      renderedSegments, matchOriginalScene, skippedSegments, warnings: analysis.warnings}, {headers: {"Cache-Control": "private, no-store"}});
  } finally {
    if (!completed) await fs.rm(workDir, {force: true, recursive: true}).catch(() => undefined);
  }
}

async function renderFixVoices(request: NextRequest, owner: string, body: Record<string, unknown>, take: CorrectionTake | null) {
  await assertFixVoicesTest(request);
  if (body.action === "save") return NextResponse.json(await saveCorrectionPreview(request, owner, String(body.previewId || "")), {headers: {"Cache-Control": "private, no-store"}});
  if (body.action === "remix") return remixFixVoices(request, owner, body);
  const analysisId = String(body.analysisId || "");
  const analysis = await readCorrectionRecord<VoiceCorrectionAnalysis>(owner, analysisId, "analysis");
  if (!analysis.mixReady || !analysis.mixSource) throw new RequestError("A reliable isolated speech track is required. Load the original or try a clearer clip.", 422);
  if (!await productionAudioMediaReadable(request, analysis.sourcePath)) throw new ProductionAudioAccessError();
  const assignments = Array.isArray(body.voiceMappings) ? body.voiceMappings : [];
  if (!assignments.length || assignments.length > 24) throw new RequestError("Select a replacement voice for at least one detected speaker.", 400);
  const {items} = await (await listVoiceModels(request)).json() as {items?: CorrectionTarget[]};
  const cast = analysis.voiceTargets ? undefined : await correctionCastPlan(owner, analysis.sourceJobId);
  const mappings: AudioStudioVoiceMappingV36BPW5[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const voiceId = String(assignment?.voiceId || "");
    const lane = analysis.voices.find(voice => voice.id === voiceId);
    if (!lane || seen.has(voiceId)) throw new RequestError("Choose each detected speaker once.", 400);
    seen.add(voiceId);
    const targetVoiceId = String(assignment?.targetVoiceId || "");
    let target = items?.find(voice => voice.id === targetVoiceId);
    const confirmedCharacter = String(assignment?.characterId || "");
    if (lane.needsCharacterConfirmation && !analysis.cast?.some(member => member.characterId === confirmedCharacter)) {
      throw new RequestError("Listen to this cue and confirm who spoke before converting.", 422);
    }
    const characterId = lane.needsCharacterConfirmation ? confirmedCharacter : lane.suggestedCharacterId;
    const match = (analysis.voiceTargets || cast?.voiceTargets || []).find(voice => voice.modelId === targetVoiceId
      && (!characterId || voice.characterId === characterId));
    if (match) {
      const pinned = await verifiedCorrectionVoice(request, match);
      if (!pinned) throw new RequestError("The saved voice used for this clip is unavailable or changed. Choose another saved voice.", 422);
      target = {id: pinned.modelId, name: pinned.sample.name, characterId: pinned.characterId, path: pinned.sample.path, samplePath: pinned.sample.path, engine: "reference"};
    }
    if (!target && targetVoiceId.startsWith("character-sample:")) {
      const character = loadCharacter(owner, targetVoiceId.slice("character-sample:".length));
      if (character?.referenceAudioPath) target = {id: targetVoiceId, name: character.name, path: character.referenceAudioPath, samplePath: character.referenceAudioPath, engine: "reference", characterId: character.id};
    }
    if (!target?.path || !await productionAudioMediaReadable(request, target.path)) throw new RequestError("Choose a saved voice available to this account.", 422);
    mappings.push({ voiceId, voiceModelId: target.id, characterId: target.characterId || "", voicePath: target.path, samplePath: target.samplePath || "",
      voiceName: target.name, modelPath: target.modelPath || "", indexPath: target.indexPath || "", engine: target.engine === "character" ? "applio" : "seed-vc",
      dubMode: "preserve_performance", emotion: "preserve", replacementText: "", segments: lane.segments });
  }
  if (take && (!seen.has(take.voiceId) || !Number.isInteger(take.segmentIndex) || !mappings.find(mapping => mapping.voiceId === take.voiceId)?.segments[take.segmentIndex])) {
    throw new RequestError("Choose which line the recorded take replaces.", 400);
  }
  const runId = `audio-dub-${randomUUID()}`;
  const workDir = correctionPath(owner, runId, "preview");
  await fs.mkdir(workDir, {recursive: true, mode: 0o700});
  let completed = false;
  try {
    const mixer = await openCorrectionMixer(analysis.mixSource);
    let actedTake = "";
    if (take) {
      const uploadedTake = path.join(workDir, "recording.audio");
      await fs.writeFile(uploadedTake, Buffer.from(await take.file.arrayBuffer()), {mode: 0o600, flag: "wx"});
      actedTake = await prepareActedTake(uploadedTake, workDir).catch(error => {
        if (error instanceof RequestError) throw error;
        throw new RequestError("The recorded take could not be read. Record it again or choose a playable audio file.", 422);
      });
    }
    const skippedSegments: VoiceCorrectionSkip[] = [];
    const renderedSegments: VoiceCorrectionResult[] = [];
    const convertedFiles: string[] = [];
    const warnings = new Set(analysis.warnings);
    let busy = false;
    for (const mapping of mappings) for (const [index, segment] of mapping.segments.entries()) {
      if (request.signal.aborted) throw new RequestError("Voice conversion was cancelled.", 409);
      const useTake = take?.voiceId === mapping.voiceId && take.segmentIndex === index;
      const blocked = mapping.segments[index].blockedReason || mixer.rejectInterval(segment);
      if (blocked) {
        skippedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, reason: blocked});
        continue;
      }
      try {
        const segmentPath = safeJoin(workDir, `${safeSegment(mapping.voiceId)}-${index}.wav`);
        await extractCorrectionLine(analysis.mixSource.speech, segment, segmentPath);
        const performance = useTake ? await alignActedTake(segmentPath, actedTake, path.join(workDir, "aligned-take.wav"), request.signal) : segmentPath;
        const converted = await runMappedVoiceDubForSegmentV36BPW5(request, performance, mapping, `fix-${mapping.voiceId}-${index}`, true);
        if (request.signal.aborted) throw new RequestError("Voice conversion was cancelled.", 409);
        const [from, to] = await transcribeCorrectionLines([performance, converted.audioPath], request.signal).catch(() => {
          throw new RequestError("Speech verification failed. This line kept its original audio.", 422);
        });
        const check = compareObservedSpeech(from, to);
        const speechIssue = check.reason || check.warning;
        if (speechIssue) {
          skippedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, reason: speechIssue});
          continue;
        }
        const convertedFile = `converted-${randomUUID()}.wav`;
        const audioPath = path.join(workDir, convertedFile);
        await fs.copyFile(converted.audioPath, audioPath);
        const reason = await mixer.apply({...segment, audioPath, take: useTake});
        if (reason) {
          await fs.unlink(audioPath).catch(() => undefined);
          skippedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, reason});
          continue;
        }
        renderedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, targetVoiceId: mapping.voiceModelId, engine: mapping.engine, usedActedTake: useTake, cueIndex: renderedSegments.length});
        convertedFiles.push(convertedFile);
      } catch (error) {
        if (request.signal.aborted) throw new RequestError("Voice conversion was cancelled.", 409);
        const reason = error instanceof RequestError ? error.message : "This line could not be converted safely. It kept its original audio.";
        busy ||= error instanceof RequestError && error.status === 409;
        skippedSegments.push({start: segment.start, end: segment.end, voiceId: mapping.voiceId, reason});
      }
    }
    if (!renderedSegments.length) throw new RequestError(skippedSegments[0]?.reason || "No selected dialogue could be corrected. The original is available.", busy ? 409 : 422);
    if (request.signal.aborted) throw new RequestError("Voice conversion was cancelled.", 409);
    const mixed = path.join(workDir, "corrected-soundtrack.wav");
    await mixer.write(mixed);
    const previewPath = path.join(workDir, analysis.sourcePath.endsWith(".webm") ? "corrected.webm" : "corrected.mp4");
    await muxCorrectionVideo(analysis.sourcePath, mixed, previewPath);
    await writeCorrectionRecord(owner, runId, "preview", {previewPath, contentMode:analysis.contentMode, sourceFileName: analysis.sourceFileName, analysisId, sourceJobId: analysis.sourceJobId, renderedSegments, skippedSegments, convertedFiles});
    completed = true;
    return NextResponse.json({ok: true, previewId: runId, previewVideoUrl: correctionMediaUrl(previewPath), sourceVideoUrl: correctionMediaUrl(analysis.sourcePath), renderedSegments, skippedSegments, warnings: [...warnings]}, {headers: {"Cache-Control": "private, no-store"}});
  } finally {
    if (!completed) await fs.rm(workDir, {force: true, recursive: true}).catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ownerKey = await ownerKeyFromRequest(request);
    assertSameOrigin(request);
    let take: CorrectionTake | null = null;
    let body;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      await assertFixVoicesTest(request);
      if (Number(request.headers.get("content-length")) > 13 * 1024 * 1024) throw new RequestError("Upload a take under 12 MB.", 413);
      const form = await request.formData();
      body = JSON.parse(String(form.get("payload") || "{}"));
      const file = form.get("take");
      if (!file || typeof file === "string" || !file.size || file.size > 12 * 1024 * 1024) throw new RequestError("Record or upload a nonempty take under 12 MB.", 400);
      take = {file, voiceId: String(form.get("takeVoiceId") || ""), segmentIndex: Number(form.get("takeSegmentIndex") ?? -1)};
    } else {
      body = await request.json();
    }
    if (body?.fixVoices === true) return await renderFixVoices(request, ownerKey, body, take);
    if (take) throw new RequestError("Recorded takes are available in Fix Voices.", 400);
    const voiceMappings = normalizeVoiceMappingsV36BPW5(body);
    if (!voiceMappings.length) {
      return NextResponse.json({ ok: false, error: "Map at least one detected voice lane to a usable character voice model before starting dub." }, { status: 400 });
    }

    const runId = `audio-dub-${Date.now()}`;
    const workDir = path.join(OTG_DATA_ROOT, "production_audio_dub_previews", safeSegment(ownerKey || "local"), runId);
    await fs.mkdir(workDir, { recursive: true });

    const sourceVideoPath = await findSourceVideo(body, request, workDir);
    const { dubbedAudioPath, renderedSegments, skippedSegments, mixPlan } = await renderSegmentFirstDubV36BPW5(
      request,
      ownerKey,
      sourceVideoPath,
      voiceMappings,
      workDir,
      body,
    );

    const previewPath = safeJoin(workDir, `${safeName(body.title || "dubbed-preview", "dubbed-preview")}.mp4`);
    await muxDubbedAudio(sourceVideoPath, dubbedAudioPath, previewPath);

    return NextResponse.json({
      ok: true,
      runId,
      workflow: {
        uploadVideo: true,
        extractAudio: true,
        separateDialogueAndBackground: body?.audioClipAnalysis?.separation?.tool || "not_provided",
        detectSpeakers: body?.audioClipAnalysis?.diarization?.tool || "not_provided",
        convertSelectedOnly: true,
        preserveOriginalTiming: true,
        mixBackgroundAndDubbedDialogue: true,
        outputVideo: true,
      },
      mixPlan,
      sourceVideoPath,
      dubbedAudioPath,
      previewVideoPath: previewPath,
      previewVideoUrl: `/api/file?path=${encodeURIComponent(previewPath)}&v=${Date.now()}`,
      voiceMappings: voiceMappings.map((mapping) => ({
        voiceId: mapping.voiceId,
        characterId: mapping.characterId,
        voiceModelId: mapping.voiceModelId,
        voicePath: mapping.voicePath,
        modelPath: mapping.modelPath,
        indexPath: mapping.indexPath,
        engine: mapping.engine,
        dubMode: mapping.dubMode,
        emotion: mapping.emotion,
        segmentCount: mapping.segments.length,
      })),
      skippedSegments,
      renderedSegments: renderedSegments.map((rendered) => ({
        voiceId: rendered.mapping.voiceId,
        characterId: rendered.mapping.characterId,
        start: rendered.segment.start,
        end: rendered.segment.end,
        audioPath: rendered.audioPath,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof RequestError) return NextResponse.json({ok:false,error:error.message},{status:error.status});
    if (error instanceof ProductionAudioAccessError) return NextResponse.json({ok:false,error:error.message},{status:404});
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Audio Studio dub preview failed." }, { status: 500 });
  }
}
