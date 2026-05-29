import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { generateIndexTts2VoicePackBatch } from "@/lib/jobs/adapters/indexTts2VoicePackBatchAdapter";
import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";

export type TrainingDatasetManifestClip = {
  clipId: string;
  index: number;
  text: string;
  status: "pending" | "generating" | "ready" | "failed";
  expectedAudioPath: string;
  expectedAudioUrl: string | null;
  sourceSamplePath?: string;
  sourceSampleUrl?: string;
  generatorSamplePath?: string;
  generatorProvider?: "qwen3" | "cosy" | "indextts2";
  retryCount?: number;
  lastError?: string;
  updatedAt?: string;
};

export type TrainingDatasetManifest = {
  schemaVersion: 1;
  ownerKey: string;
  characterId: string;
  jobId: string;
  createdAt: string;
  source: {
    approvedSampleUrl: string;
    approvedSamplePath: string;
    approvedSampleType: "tuned" | "base" | "unknown";
    approvedSourceJobId: string;
    baseSampleUrl: string;
    tunedSampleUrl: string;
    tunedFxPreset: string;
    originalSourcePath: string;
    originalSourceUrl: string;
    canonicalSourcePath: string;
    canonicalSourceUrl: string;
    sourceFormat: string;
    sampleRate: number;
    channels: 1;
  };
  logs: {
    paramsPath: string;
    stdoutPath: string;
    stderrPath: string;
  };
  generationMode: "real" | "mock_copy";
  provider: "qwen3" | "cosy" | "indextts2" | "mock";
  sourceProvider?: "qwen3" | "cosy";
  startedAt: string;
  completedAt: string | null;
  requestedClipCount: number;
  generatedClipCount: number;
  clips: TrainingDatasetManifestClip[];
  status: "manifest_ready" | "voice_pack_ready";
  mock: boolean;
  note: string;
};

export type TrainingDatasetManifestResult = {
  mock: boolean;
  adapter: "dataset_manifest";
  manifestPath: string;
  manifestUrl: string;
  clipCount: number;
  generatedClipCount: number;
  approvedSampleUrl: string;
  sourceSamplePath: string;
  originalSourcePath: string;
  canonicalSourcePath: string;
  canonicalSourceUrl: string;
  sourceFormat: string;
  sampleRate: number;
  channels: 1;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  generationMode: "real" | "mock_copy";
  provider: "qwen3" | "cosy" | "indextts2" | "mock";
  sourceProvider?: "qwen3" | "cosy";
  status: "manifest_ready" | "voice_pack_ready";
};

type ResolvedApprovedSource = {
  originalSourcePath: string;
  originalSourceUrl: string;
  sourceFormat: string;
};

type NormalizedTrainingSource = ResolvedApprovedSource & {
  canonicalSourcePath: string;
  canonicalSourceUrl: string;
  sampleRate: number;
  channels: 1;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
};

const SUPPORTED_SOURCE_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg"]);

const TRAINING_UTTERANCE_SEEDS = [
  "I can hear the wind moving through the room.",
  "This is the moment when everything starts to change.",
  "Please stay close and listen carefully to what I say.",
  "The road ahead is quiet, but I know we are not alone.",
  "I remember the promise, and I intend to keep it.",
  "There is a strange light beyond the old doorway.",
  "We should move quickly before the signal disappears.",
  "I have waited a long time to tell this story.",
  "The answer is hidden in the smallest detail.",
  "Do not mistake patience for weakness.",
  "Every choice has a cost, even the kind ones.",
  "The machine is awake, and it is listening.",
  "I thought the voice was only in my memory.",
  "Bring the map, the key, and one honest question.",
  "If we leave now, we can reach the tower by morning.",
  "That sound means the gate is opening again.",
  "I am calm because I have already seen the danger.",
  "The message was clear, but the meaning was not.",
  "You can trust me for one more step.",
  "Nothing about this place feels accidental.",
];

export type TrainingDatasetProgressEvent = {
  generatedClipCount: number;
  requestedClipCount: number;
  clipId?: string;
  message: string;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function approvedSampleType(value: unknown): "tuned" | "base" | "unknown" {
  return value === "tuned" || value === "base" ? value : "unknown";
}

function requestedClipCount(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 200;
  return Math.max(1, Math.min(200, Math.floor(numberValue)));
}

function clipRetryLimit(): number {
  const value = Number(process.env.VOICE_PACK_CLIP_RETRIES);
  if (Number.isFinite(value) && value >= 0 && value <= 10) return Math.floor(value);
  return 2;
}

function voicePackChunkSize(): number {
  const value = Number(process.env.VOICE_PACK_CHUNK_SIZE);
  if (Number.isFinite(value) && value >= 1 && value <= 200) return Math.floor(value);
  return 10;
}

function mockVoicePackAllowed(): boolean {
  return process.env.OTG_ALLOW_MOCK_VOICE_PACK === "1" || (process.env.NODE_ENV === "test" && process.env.OTG_ALLOW_MOCK_VOICE_PACK === "1");
}

function resolveVoicePackProvider(job: QueuedContractJob): "qwen3" | "cosy" {
  const provider = cleanString(job.input.provider || job.input.sourceProvider || job.input.voiceProvider).toLowerCase();
  if (provider === "qwen3" || provider === "cosy") return provider;
  throw new Error("Real voice-pack generation requires provider qwen3 or cosy in the queued job input.");
}

function trainingUtterances(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = TRAINING_UTTERANCE_SEEDS[index % TRAINING_UTTERANCE_SEEDS.length];
    const setNumber = Math.floor(index / TRAINING_UTTERANCE_SEEDS.length) + 1;
    if (setNumber === 1) return seed;
    return `${seed} Take ${setNumber}, with steady delivery and clear articulation.`;
  });
}

function readExistingManifest(manifestPath: string): TrainingDatasetManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TrainingDatasetManifest;
  } catch {
    return null;
  }
}

function writeManifestAtomic(manifestPath: string, manifest: TrainingDatasetManifest): void {
  ensureDir(path.dirname(manifestPath));
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tempPath, manifestPath);
}

function fileReady(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function readyClipCount(clips: TrainingDatasetManifestClip[]): number {
  return clips.filter((clip) => clip.status === "ready" && fileReady(clip.expectedAudioPath)).length;
}

function clipHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateRealPackUniqueness(manifest: TrainingDatasetManifest): void {
  if (manifest.generationMode !== "real") return;
  const hashes = manifest.clips
    .filter((clip) => clip.status === "ready" && fileReady(clip.expectedAudioPath))
    .map((clip) => clipHash(clip.expectedAudioPath));
  if (hashes.length < manifest.requestedClipCount) return;
  if (new Set(hashes).size <= 1) {
    throw new Error("Real voice-pack validation failed: all generated clip WAV files have the same SHA256 hash.");
  }
}

export function trainingDatasetManifestDirectory(ownerKey: string, characterId: string, jobId: string): string {
  return path.join(
    OTG_DATA_ROOT,
    "characters",
    safeSegment(ownerKey),
    "training-datasets",
    safeSegment(characterId),
    safeSegment(jobId),
  );
}

export function trainingDatasetManifestPath(ownerKey: string, characterId: string, jobId: string): string {
  return path.join(trainingDatasetManifestDirectory(ownerKey, characterId, jobId), "manifest.json");
}

export function trainingDatasetManifestUrl(ownerKey: string, characterId: string, jobId: string): string {
  const params = new URLSearchParams({
    owner: safeSegment(ownerKey),
    characterId: safeSegment(characterId),
    jobId: safeSegment(jobId),
  });
  return `/api/characters/training-dataset/manifest?${params.toString()}`;
}

export function trainingDatasetClipUrl(ownerKey: string, characterId: string, jobId: string, clipId: string): string {
  const params = new URLSearchParams({
    owner: safeSegment(ownerKey),
    characterId: safeSegment(characterId),
    jobId: safeSegment(jobId),
    clipId: safeSegment(clipId),
  });
  return `/api/characters/training-dataset/file?${params.toString()}`;
}

export function trainingDatasetCanonicalSourceUrl(ownerKey: string, characterId: string, jobId: string): string {
  const params = new URLSearchParams({
    owner: safeSegment(ownerKey),
    characterId: safeSegment(characterId),
    jobId: safeSegment(jobId),
    file: "source.wav",
  });
  return `/api/characters/training-dataset/file?${params.toString()}`;
}

export function resolveTrainingDatasetManifestPath(ownerKey: string, characterId: string, jobId: string): string {
  const root = path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey), "training-datasets");
  const manifestPath = path.join(root, safeSegment(characterId), safeSegment(jobId), "manifest.json");
  const resolvedRoot = path.resolve(root);
  const resolvedManifestPath = path.resolve(manifestPath);
  if (!resolvedManifestPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Invalid training dataset manifest path.");
  }
  return resolvedManifestPath;
}

export function resolveTrainingDatasetClipPath(ownerKey: string, characterId: string, jobId: string, clipId: string): string {
  const safeClipId = safeSegment(clipId);
  if (!/^clip_\d{3}$/.test(safeClipId)) {
    throw new Error("Invalid training dataset clip id.");
  }

  const root = path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey), "training-datasets");
  const clipPath = path.join(root, safeSegment(characterId), safeSegment(jobId), "clips", `${safeClipId}.wav`);
  const resolvedRoot = path.resolve(root);
  const resolvedClipPath = path.resolve(clipPath);
  if (!resolvedClipPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Invalid training dataset clip path.");
  }
  return resolvedClipPath;
}

export function resolveTrainingDatasetCanonicalSourcePath(ownerKey: string, characterId: string, jobId: string): string {
  const root = path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey), "training-datasets");
  const sourcePath = path.join(root, safeSegment(characterId), safeSegment(jobId), "source", "source.wav");
  const resolvedRoot = path.resolve(root);
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!resolvedSourcePath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Invalid training dataset source path.");
  }
  return resolvedSourcePath;
}

function voiceSamplePathFromUrl(urlValue: string): string {
  const parsed = new URL(urlValue, "http://localhost");
  if (parsed.pathname !== "/api/characters/voice-sample/file") return "";

  const owner = cleanString(parsed.searchParams.get("owner"));
  const characterId = cleanString(parsed.searchParams.get("characterId"));
  const jobId = cleanString(parsed.searchParams.get("jobId"));
  const fileName = cleanString(parsed.searchParams.get("file")) || "sample.wav";
  if (!owner || !characterId || !jobId) return "";
  if (!/^(sample|fx)\.wav$/.test(fileName) && !/^sample\.(mp3|m4a|flac|ogg)$/.test(fileName)) return "";

  const voiceSamplesRoot = path.join(OTG_DATA_ROOT, "characters", safeSegment(owner), "voice-samples");
  const sourcePath = path.join(voiceSamplesRoot, safeSegment(characterId), safeSegment(jobId), fileName);
  const resolvedRoot = path.resolve(voiceSamplesRoot);
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!resolvedSourcePath.startsWith(resolvedRoot + path.sep)) return "";
  return resolvedSourcePath;
}

function resolveApprovedSourceSample(ownerKey: string, characterId: string, input: Record<string, unknown>): ResolvedApprovedSource {
  const approvedSampleUrl = cleanString(input.approvedSampleUrl);
  const candidatePaths = [
    cleanString(input.approvedSamplePath),
    cleanString(input.tunedSamplePath),
    cleanString(input.baseSamplePath),
    cleanString(input.inputPath),
    voiceSamplePathFromUrl(approvedSampleUrl),
    voiceSamplePathFromUrl(cleanString(input.tunedSampleUrl)),
    voiceSamplePathFromUrl(cleanString(input.baseSampleUrl)),
  ].filter(Boolean);

  const characterVoiceRoot = path.resolve(OTG_DATA_ROOT, "characters", safeSegment(ownerKey));
  for (const candidatePath of candidatePaths) {
    const resolvedPath = path.resolve(candidatePath);
    if (!resolvedPath.startsWith(characterVoiceRoot + path.sep)) continue;
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) continue;
    const sourceFormat = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(sourceFormat)) {
      throw new Error(`Unsupported training source audio format: ${sourceFormat || "(none)"}. Supported formats: .wav, .mp3, .m4a, .flac, .ogg.`);
    }
    return { originalSourcePath: resolvedPath, originalSourceUrl: approvedSampleUrl, sourceFormat };
  }

  throw new Error(
    `Approved training source sample not found for character ${characterId}. Provide approvedSamplePath or a local voice-sample file URL.`,
  );
}

function resolveDatasetFfmpegPath(): string {
  return cleanString(
    process.env.APPLIO_DATASET_FFMPEG ||
    process.env.VOICE_FX_FFMPEG ||
    process.env.FFMPEG_PATH ||
    process.env.OTG_FFMPEG_PATH ||
    "ffmpeg",
  );
}

function resolveApplioSampleRate(): number {
  const value = Number(process.env.APPLIO_SAMPLE_RATE);
  if (Number.isFinite(value) && value >= 8000 && value <= 192000) return Math.floor(value);
  return 40000;
}

function requireFfmpeg(ffmpeg: string): void {
  if (!ffmpeg) throw new Error("ffmpeg is required for training source normalization.");
  if (!path.isAbsolute(ffmpeg)) return;
  if (!fs.existsSync(ffmpeg) || !fs.statSync(ffmpeg).isFile()) {
    throw new Error(`Training dataset ffmpeg not found: ${ffmpeg}`);
  }
}

function normalizeApprovedSourceSample(
  ownerKey: string,
  characterId: string,
  jobId: string,
  source: ResolvedApprovedSource,
): NormalizedTrainingSource {
  const outputDir = trainingDatasetManifestDirectory(ownerKey, characterId, jobId);
  const logsDir = path.join(outputDir, "logs");
  const canonicalSourcePath = resolveTrainingDatasetCanonicalSourcePath(ownerKey, characterId, jobId);
  const canonicalSourceUrl = trainingDatasetCanonicalSourceUrl(ownerKey, characterId, jobId);
  const paramsPath = path.join(logsDir, "training_dataset_source_params.json");
  const stdoutPath = path.join(logsDir, "training_dataset_source_stdout.log");
  const stderrPath = path.join(logsDir, "training_dataset_source_stderr.log");
  const ffmpeg = resolveDatasetFfmpegPath();
  const sampleRate = resolveApplioSampleRate();
  const args = [
    "-y",
    "-i",
    source.originalSourcePath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    canonicalSourcePath,
  ];

  requireFfmpeg(ffmpeg);
  ensureDir(path.dirname(canonicalSourcePath));
  ensureDir(logsDir);
  fs.writeFileSync(
    paramsPath,
    JSON.stringify(
      {
        engine: "ffmpeg",
        adapter: "training_dataset_source_normalizer",
        ffmpeg,
        args,
        originalSourcePath: source.originalSourcePath,
        originalSourceUrl: source.originalSourceUrl,
        canonicalSourcePath,
        canonicalSourceUrl,
        sourceFormat: source.sourceFormat,
        sampleRate,
        channels: 1,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const testMode = process.env.NODE_ENV === "test" ? cleanString(process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE) : "";
  if (testMode === "copy") {
    fs.copyFileSync(source.originalSourcePath, canonicalSourcePath);
    fs.writeFileSync(stdoutPath, JSON.stringify({ ok: true, testMode: true }) + "\n", "utf8");
    fs.writeFileSync(stderrPath, "", "utf8");
  } else {
    const result = spawnSync(ffmpeg, args, {
      encoding: "utf8",
      timeout: Math.max(30_000, Number(process.env.APPLIO_DATASET_TIMEOUT_MS || 5 * 60 * 1000)),
      windowsHide: true,
    });
    fs.writeFileSync(stdoutPath, result.stdout || "", "utf8");
    fs.writeFileSync(stderrPath, result.stderr || result.error?.message || "", "utf8");
    if (result.error) {
      throw new Error(`Training source normalization failed: ${result.error.message}. stderr: ${stderrPath}`);
    }
    if (result.status !== 0) {
      throw new Error(`Training source normalization ffmpeg failed with exit code ${result.status}. stderr: ${stderrPath}`);
    }
  }

  const stat = fs.existsSync(canonicalSourcePath) ? fs.statSync(canonicalSourcePath) : null;
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Training source normalization finished without writing canonical WAV: ${canonicalSourcePath}. stderr: ${stderrPath}`);
  }

  return {
    ...source,
    canonicalSourcePath,
    canonicalSourceUrl,
    sampleRate,
    channels: 1,
    paramsPath,
    stdoutPath,
    stderrPath,
  };
}

function copySourceToClip(sourcePath: string, clipPath: string): void {
  ensureDir(path.dirname(clipPath));
  const tempPath = `${clipPath}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(sourcePath, tempPath);
  fs.renameSync(tempPath, clipPath);
}

function normalizeGeneratedClip(sourcePath: string, clipPath: string, outputDir: string, clipId: string, sampleRate: number): void {
  const logsDir = path.join(outputDir, "logs");
  const stdoutPath = path.join(logsDir, `${clipId}_normalize_stdout.log`);
  const stderrPath = path.join(logsDir, `${clipId}_normalize_stderr.log`);
  const ffmpeg = resolveDatasetFfmpegPath();
  const args = [
    "-y",
    "-i",
    sourcePath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    clipPath,
  ];

  requireFfmpeg(ffmpeg);
  ensureDir(path.dirname(clipPath));
  ensureDir(logsDir);

  const testMode = process.env.NODE_ENV === "test" ? cleanString(process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE) : "";
  if (testMode === "copy") {
    fs.copyFileSync(sourcePath, clipPath);
    fs.appendFileSync(clipPath, Buffer.from(`\nOTG_TEST_CLIP_${clipId}\n`, "utf8"));
    fs.writeFileSync(stdoutPath, JSON.stringify({ ok: true, testMode: true }) + "\n", "utf8");
    fs.writeFileSync(stderrPath, "", "utf8");
    return;
  }

  const result = spawnSync(ffmpeg, args, {
    encoding: "utf8",
    timeout: Math.max(30_000, Number(process.env.APPLIO_DATASET_TIMEOUT_MS || 5 * 60 * 1000)),
    windowsHide: true,
  });
  fs.writeFileSync(stdoutPath, result.stdout || "", "utf8");
  fs.writeFileSync(stderrPath, result.stderr || result.error?.message || "", "utf8");
  if (result.error) {
    throw new Error(`Training clip normalization failed for ${clipId}: ${result.error.message}. stderr: ${stderrPath}`);
  }
  if (result.status !== 0) {
    throw new Error(`Training clip normalization failed for ${clipId} with exit code ${result.status}. stderr: ${stderrPath}`);
  }
}

async function processIndexTts2BatchChunk(args: {
  ownerKey: string;
  job: QueuedContractJob;
  sourceProvider: "qwen3" | "cosy";
  clips: TrainingDatasetManifestClip[];
  outputDir: string;
  canonicalSourcePath: string;
  sampleRate: number;
  maxRetries: number;
  chunkSize: number;
  manifestPath: string;
  buildManifest: (status: "manifest_ready" | "voice_pack_ready", completedAt: string | null) => TrainingDatasetManifest;
  onProgress?: (event: TrainingDatasetProgressEvent) => void;
}): Promise<number> {
  const candidates = args.clips
    .filter((clip) => !(clip.status === "ready" && fileReady(clip.expectedAudioPath)))
    .filter((clip) => (clip.retryCount || 0) <= args.maxRetries)
    .slice(0, args.chunkSize);
  if (candidates.length === 0) return 0;

  const rawOutputDir = path.join(args.outputDir, "generated", "indextts2-batch", args.job.jobId);
  const rawClipPaths = new Map<string, string>();
  for (const clip of candidates) {
    const rawClipPath = path.join(rawOutputDir, clip.clipId, "sample.wav");
    rawClipPaths.set(clip.clipId, rawClipPath);
    clip.status = "generating";
    clip.updatedAt = new Date().toISOString();
  }
  writeManifestAtomic(args.manifestPath, args.buildManifest("manifest_ready", null));

  args.onProgress?.({
    generatedClipCount: readyClipCount(args.clips),
    requestedClipCount: args.clips.length,
    clipId: candidates[0]?.clipId,
    message: `Generating IndexTTS2 same-speaker clone batch of ${candidates.length} clips from the approved ${args.sourceProvider} reference voice.`,
  });

  let batchError = "";
  let batchResults = new Map<string, { ok: boolean; outputWav: string; error?: string }>();
  try {
    const result = await generateIndexTts2VoicePackBatch({
      ownerKey: args.ownerKey,
      job: args.job,
      outputDir: args.outputDir,
      referenceWav: args.canonicalSourcePath,
      clips: candidates.map((clip) => ({
        clipId: clip.clipId,
        text: clip.text,
        outputWav: rawClipPaths.get(clip.clipId) || path.join(rawOutputDir, clip.clipId, "sample.wav"),
      })),
    });
    batchResults = new Map(result.results.map((clipResult) => [clipResult.clipId, {
      ok: clipResult.ok,
      outputWav: clipResult.outputWav,
      error: clipResult.error,
    }]));
    if (result.exitCode !== 0) {
      batchError = `IndexTTS2 batch bridge exited with code ${result.exitCode}. stdout: ${result.stdoutPath}; stderr: ${result.stderrPath}`;
    }
  } catch (error) {
    batchError = error instanceof Error ? error.message : "IndexTTS2 batch bridge failed.";
  }

  let processed = 0;
  let terminalError = "";
  for (const clip of candidates) {
    const fallbackRawPath = rawClipPaths.get(clip.clipId) || "";
    const clipResult = batchResults.get(clip.clipId);
    const rawPath = clipResult?.outputWav || fallbackRawPath;
    try {
      if (!clipResult?.ok && !fileReady(rawPath)) {
        throw new Error(clipResult?.error || batchError || "IndexTTS2 batch bridge did not produce this clip.");
      }
      if (!fileReady(rawPath)) {
        throw new Error(`IndexTTS2 batch output missing for ${clip.clipId}: ${rawPath}`);
      }
      normalizeGeneratedClip(rawPath, clip.expectedAudioPath, args.outputDir, clip.clipId, args.sampleRate);
      if (!fileReady(clip.expectedAudioPath)) {
        throw new Error(`Training dataset clip ${clip.clipId} was not written: ${clip.expectedAudioPath}`);
      }
      clip.status = "ready";
      clip.lastError = undefined;
      clip.generatorSamplePath = rawPath;
      clip.generatorProvider = "indextts2";
      clip.updatedAt = new Date().toISOString();
      processed += 1;
      writeManifestAtomic(args.manifestPath, args.buildManifest("manifest_ready", null));
      args.onProgress?.({
        generatedClipCount: readyClipCount(args.clips),
        requestedClipCount: args.clips.length,
        clipId: clip.clipId,
        message: `Voice-pack clip ${clip.index + 1} of ${args.clips.length} ready.`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Clip generation failed.";
      clip.status = "failed";
      clip.retryCount = (clip.retryCount || 0) + 1;
      clip.lastError = errorMessage;
      clip.updatedAt = new Date().toISOString();
      writeManifestAtomic(args.manifestPath, args.buildManifest("manifest_ready", null));
      if (clip.retryCount > args.maxRetries) {
        terminalError = `Training dataset clip ${clip.clipId} failed after ${clip.retryCount} attempts with provider indextts2 using ${args.sourceProvider} reference. ${errorMessage}`;
      }
    }
  }

  if (terminalError) throw new Error(terminalError);
  return processed;
}

export async function createTrainingDatasetManifest(
  ownerKey: string,
  job: QueuedContractJob,
  options: { onProgress?: (event: TrainingDatasetProgressEvent) => void } = {},
): Promise<TrainingDatasetManifestResult> {
  if (job.jobType !== "character_voice_pipeline" || job.action !== "generate_training_dataset") {
    throw new Error("Training dataset manifest can only be created for generate_training_dataset jobs.");
  }

  const characterId = cleanString(job.characterId);
  if (!characterId) throw new Error("Missing characterId for training dataset manifest.");

  const approvedSampleUrl = cleanString(job.input.approvedSampleUrl);
  if (!approvedSampleUrl) throw new Error("Missing approvedSampleUrl for training dataset manifest.");

  const clipCount = requestedClipCount(job.input.requestedClipCount);
  const approvedSource = normalizeApprovedSourceSample(
    ownerKey,
    characterId,
    job.jobId,
    resolveApprovedSourceSample(ownerKey, characterId, job.input),
  );
  const manifestPath = trainingDatasetManifestPath(ownerKey, characterId, job.jobId);
  const outputDir = path.dirname(manifestPath);
  const existingManifest = readExistingManifest(manifestPath);
  const startedAt = existingManifest?.startedAt || new Date().toISOString();
  const generationMode: "real" | "mock_copy" = mockVoicePackAllowed() ? "mock_copy" : "real";
  const sourceProvider = generationMode === "mock_copy" ? undefined : resolveVoicePackProvider(job);
  const provider: "qwen3" | "cosy" | "indextts2" | "mock" = generationMode === "mock_copy" ? "mock" : "indextts2";
  const utterances = trainingUtterances(clipCount);
  const existingClipsById = new Map((existingManifest?.clips || []).map((clip) => [clip.clipId, clip]));
  const clips: TrainingDatasetManifestClip[] = Array.from({ length: clipCount }, (_, index) => {
    const clipNumber = index + 1;
    const clipId = `clip_${String(clipNumber).padStart(3, "0")}`;
    const expectedAudioPath = resolveTrainingDatasetClipPath(ownerKey, characterId, job.jobId, clipId);
    const existingClip = existingClipsById.get(clipId);
    const status = existingClip?.status === "ready" && fileReady(expectedAudioPath)
      ? "ready"
      : existingClip?.status === "failed"
        ? "failed"
        : "pending";
    return {
      ...existingClip,
      clipId,
      index,
      text: existingClip?.text || utterances[index],
      status,
      expectedAudioPath,
      expectedAudioUrl: trainingDatasetClipUrl(ownerKey, characterId, job.jobId, clipId),
      sourceSamplePath: approvedSource.canonicalSourcePath,
      sourceSampleUrl: approvedSource.canonicalSourceUrl,
      retryCount: existingClip?.retryCount || 0,
      lastError: status === "ready" ? undefined : existingClip?.lastError,
    };
  });

  const buildManifest = (status: "manifest_ready" | "voice_pack_ready", completedAt: string | null): TrainingDatasetManifest => ({
    schemaVersion: 1,
    ownerKey,
    characterId,
    jobId: job.jobId,
    createdAt: existingManifest?.createdAt || startedAt,
    source: {
      approvedSampleUrl,
      approvedSamplePath: approvedSource.canonicalSourcePath,
      approvedSampleType: approvedSampleType(job.input.approvedSampleType),
      approvedSourceJobId: cleanString(job.input.approvedSourceJobId),
      baseSampleUrl: cleanString(job.input.baseSampleUrl),
      tunedSampleUrl: cleanString(job.input.tunedSampleUrl),
      tunedFxPreset: cleanString(job.input.tunedFxPreset),
      originalSourcePath: approvedSource.originalSourcePath,
      originalSourceUrl: approvedSource.originalSourceUrl,
      canonicalSourcePath: approvedSource.canonicalSourcePath,
      canonicalSourceUrl: approvedSource.canonicalSourceUrl,
      sourceFormat: approvedSource.sourceFormat,
      sampleRate: approvedSource.sampleRate,
      channels: approvedSource.channels,
    },
    logs: {
      paramsPath: approvedSource.paramsPath,
      stdoutPath: approvedSource.stdoutPath,
      stderrPath: approvedSource.stderrPath,
    },
    generationMode,
    provider,
    sourceProvider,
    startedAt,
    completedAt,
    requestedClipCount: clipCount,
    generatedClipCount: readyClipCount(clips),
    clips,
    status,
    mock: generationMode !== "real",
    note: generationMode === "real"
      ? "Real voice-pack utterance generation has run through IndexTTS2 using the approved reference voice for every clip. Real Applio training has not run."
      : "No real TTS clip generation or Applio training has run. This explicit dev fallback copies the approved source WAV into deterministic clip files.",
  });

  writeManifestAtomic(manifestPath, buildManifest("manifest_ready", null));

  let processedThisRun = 0;
  const maxRetries = clipRetryLimit();
  const chunkSize = voicePackChunkSize();

  if (generationMode === "real" && sourceProvider) {
    processedThisRun = await processIndexTts2BatchChunk({
      ownerKey,
      job,
      sourceProvider,
      clips,
      outputDir,
      canonicalSourcePath: approvedSource.canonicalSourcePath,
      sampleRate: approvedSource.sampleRate,
      maxRetries,
      chunkSize,
      manifestPath,
      buildManifest,
      onProgress: options.onProgress,
    });
  } else {
    for (let index = 0; index < clipCount; index += 1) {
      if (processedThisRun >= chunkSize) break;
      const clip = clips[index];
      const clipNumber = index + 1;
      const clipId = clip.clipId;
      const clipPath = clip.expectedAudioPath;
      if (clip.status === "ready" && fileReady(clipPath)) continue;
      if ((clip.retryCount || 0) > maxRetries) {
        throw new Error(`Training dataset clip ${clipId} exceeded retry limit ${maxRetries}. Last error: ${clip.lastError || "unknown"}`);
      }

      clip.status = "generating";
      clip.updatedAt = new Date().toISOString();
      writeManifestAtomic(manifestPath, buildManifest("manifest_ready", null));
      options.onProgress?.({
        generatedClipCount: readyClipCount(clips),
        requestedClipCount: clipCount,
        clipId,
        message: generationMode === "real"
          ? `Generating real voice-pack clip ${clipNumber} of ${clipCount}.`
          : `Creating mock voice-pack clip ${clipNumber} of ${clipCount}.`,
      });
      const generatorSamplePath = "";
      try {
        if (generationMode === "mock_copy") {
          copySourceToClip(approvedSource.canonicalSourcePath, clipPath);
        } else {
          throw new Error("Real voice-pack generation must use IndexTTS2 batch clone mode.");
        }
        const stat = fs.existsSync(clipPath) ? fs.statSync(clipPath) : null;
        if (!stat?.isFile() || stat.size <= 0) {
          throw new Error(`Training dataset clip ${clipId} was not written: ${clipPath}`);
        }
        clip.status = "ready";
        clip.lastError = undefined;
        clip.generatorSamplePath = generatorSamplePath || clip.generatorSamplePath;
        clip.generatorProvider = provider === "indextts2" ? "indextts2" : undefined;
        clip.updatedAt = new Date().toISOString();
        processedThisRun += 1;
        writeManifestAtomic(manifestPath, buildManifest("manifest_ready", null));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Clip generation failed.";
        clip.status = "failed";
        clip.retryCount = (clip.retryCount || 0) + 1;
        clip.lastError = errorMessage;
        clip.updatedAt = new Date().toISOString();
        writeManifestAtomic(manifestPath, buildManifest("manifest_ready", null));
        if (clip.retryCount > maxRetries) {
          throw new Error(`Training dataset clip ${clipId} failed after ${clip.retryCount} attempts with provider ${provider}. ${errorMessage}`);
        }
        break;
      }
      options.onProgress?.({
        generatedClipCount: readyClipCount(clips),
        requestedClipCount: clipCount,
        clipId,
        message: `Voice-pack clip ${clipNumber} of ${clipCount} ready.`,
      });
    }
  }

  const generatedClipCount = readyClipCount(clips);
  const isComplete = generatedClipCount === clipCount && clips.every((clip) => clip.status === "ready" && fileReady(clip.expectedAudioPath));
  if (isComplete) {
    const completeManifest = buildManifest("voice_pack_ready", new Date().toISOString());
    validateRealPackUniqueness(completeManifest);
    writeManifestAtomic(manifestPath, completeManifest);
  } else {
    writeManifestAtomic(manifestPath, buildManifest("manifest_ready", null));
  }

  return {
    mock: generationMode !== "real",
    adapter: "dataset_manifest",
    manifestPath,
    manifestUrl: trainingDatasetManifestUrl(ownerKey, characterId, job.jobId),
    clipCount,
    generatedClipCount,
    approvedSampleUrl,
    sourceSamplePath: approvedSource.canonicalSourcePath,
    originalSourcePath: approvedSource.originalSourcePath,
    canonicalSourcePath: approvedSource.canonicalSourcePath,
    canonicalSourceUrl: approvedSource.canonicalSourceUrl,
    sourceFormat: approvedSource.sourceFormat,
    sampleRate: approvedSource.sampleRate,
    channels: approvedSource.channels,
    paramsPath: approvedSource.paramsPath,
    stdoutPath: approvedSource.stdoutPath,
    stderrPath: approvedSource.stderrPath,
    generationMode,
    provider,
    sourceProvider,
    status: isComplete ? "voice_pack_ready" : "manifest_ready",
  };
}
