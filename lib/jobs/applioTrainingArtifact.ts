import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import {
  APPLIO_TRAINING_QUALITY_PRESETS,
  DEFAULT_APPLIO_TRAINING_QUALITY_PRESET,
  isApplioTrainingQualityPreset,
  type ApplioTrainingQualityPresetKey,
} from "@/lib/characterVoiceAudioStudio";
import {
  resolveTrainingDatasetManifestPath,
  trainingDatasetManifestUrl,
  type TrainingDatasetManifest,
} from "@/lib/jobs/trainingDatasetManifest";

export type ApplioTrainingArtifact = {
  schemaVersion: 1;
  ownerKey: string;
  characterId: string;
  jobId: string;
  createdAt: string;
  status: "training_artifact_ready" | "trained";
  mock: boolean;
  adapter: "applio_training_artifact" | "applio_real_training";
  dataset: {
    manifestPath: string;
    manifestUrl: string;
    sourceDatasetJobId: string;
    clipCount: number;
    approvedSampleUrl: string;
    preparedDatasetPath?: string;
    generationMode?: string;
    provider?: string;
  };
  model: {
    modelName: string;
    expectedModelPath: string;
    expectedIndexPath: string;
    expectedConfigPath: string;
    modelPath?: string;
    indexPath?: string;
    sourceModelPath?: string;
    sourceIndexPath?: string;
    status: "not_trained" | "trained";
  };
  logs?: {
    logsDir: string;
    stdoutPath: string;
    stderrPath: string;
    commandPath: string;
  };
  trainingQualityPreset?: ApplioTrainingQualityPresetKey | string;
  epochs?: number;
  saveEveryEpoch?: number;
  estimatedDurationLabel?: string;
  trainingStartedAt?: string;
  trainingCompletedAt?: string;
  trainingFailedAt?: string;
  failedStage?: string;
  totalTrainingMs?: number;
  totalTrainingLabel?: string;
  note: string;
};

export type ApplioTrainingArtifactResult = {
  mock: boolean;
  adapter: "applio_training_artifact" | "applio_real_training";
  artifactPath: string;
  artifactUrl: string;
  status: "training_artifact_ready" | "trained";
  manifestPath: string;
  clipCount: number;
  modelName: string;
  expectedModelPath: string;
  expectedIndexPath: string;
  modelPath?: string;
  indexPath?: string;
  sourceModelPath?: string;
  sourceIndexPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  commandPath?: string;
  preparedDatasetPath?: string;
  trainingQualityPreset?: ApplioTrainingQualityPresetKey | string;
  epochs?: number;
  saveEveryEpoch?: number;
  estimatedDurationLabel?: string;
  currentStage?: ApplioTrainingStage;
  stageStartedAt?: string;
  elapsedTrainingMs?: number;
  elapsedTrainingLabel?: string;
  currentStageElapsedMs?: number;
  currentStageElapsedLabel?: string;
  currentEpoch?: number;
  totalEpochs?: number;
  epochProgressPercent?: number;
  estimatedCompletionAt?: string;
  trainingStartedAt?: string;
  trainingCompletedAt?: string;
  trainingFailedAt?: string;
  failedStage?: string;
  totalTrainingMs?: number;
  totalTrainingLabel?: string;
};

export type ApplioTrainingStage = "queued" | "preprocess" | "extract" | "train" | "index" | "artifact_copy" | "completed" | "failed";

export type ApplioTrainingProgressSnapshot = {
  mock: false;
  adapter: "applio_real_training";
  status: "running" | "trained" | "failed";
  currentStage: ApplioTrainingStage;
  stageStartedAt: string;
  elapsedTrainingMs: number;
  elapsedTrainingLabel: string;
  currentStageElapsedMs: number;
  currentStageElapsedLabel: string;
  trainingQualityPreset: ApplioTrainingQualityPresetKey | string;
  epochs: number;
  saveEveryEpoch: number;
  estimatedDurationLabel: string;
  trainingStartedAt: string;
  trainingCompletedAt?: string;
  trainingFailedAt?: string;
  failedStage?: string;
  totalTrainingMs?: number;
  totalTrainingLabel?: string;
  currentEpoch?: number;
  totalEpochs?: number;
  epochProgressPercent?: number;
  estimatedCompletionAt?: string;
  message: string;
};

export type ApplioTrainingProgressCallback = (snapshot: ApplioTrainingProgressSnapshot) => void | Promise<void>;

type ManifestResolution = {
  manifest: TrainingDatasetManifest;
  manifestPath: string;
  manifestUrl: string;
  sourceDatasetJobId: string;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function realApplioTrainingEnabled(): boolean {
  return process.env.OTG_ENABLE_REAL_APPLIO_TRAINING === "1";
}

function positiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function positiveIntegerInput(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return numberValue;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function boolFlag(name: string, fallback = false): boolean {
  const value = cleanString(process.env[name]).toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function requireExistingPath(envName: string, label: string): string {
  const value = cleanString(process.env[envName]);
  if (!value) throw new Error(`${envName} is required for real Applio training (${label}).`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${envName} does not exist for real Applio training: ${resolved}`);
  return resolved;
}

function ensureRealVoicePack(dataset: ManifestResolution): void {
  const manifest = dataset.manifest;
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];
  const readyClips = clips.filter((clip) => clip.status === "ready");
  const generatedClipCount = Number(manifest.generatedClipCount || 0);
  if (manifest.generationMode !== "real" || manifest.mock !== false) {
    throw new Error(`Real Applio training requires a real voice pack. Rejecting mock/copy pack: ${dataset.manifestPath}`);
  }
  if (manifest.status !== "voice_pack_ready") {
    throw new Error(`Real Applio training requires manifest status voice_pack_ready. manifestPath: ${dataset.manifestPath}`);
  }
  if (generatedClipCount < 200 || readyClips.length < 200) {
    throw new Error(`Real Applio training requires 200 ready generated clips. Found generated=${generatedClipCount}, ready=${readyClips.length}.`);
  }
  for (const clip of clips.slice(0, 200)) {
    const clipPath = cleanString(clip.expectedAudioPath);
    if (!clipPath || !fs.existsSync(clipPath)) {
      throw new Error(`Real Applio training clip is missing: ${clip.clipId} (${clipPath || "no path"})`);
    }
    const stat = fs.statSync(clipPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`Real Applio training clip is empty or invalid: ${clip.clipId} (${clipPath})`);
    }
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function readManifest(filePath: string): TrainingDatasetManifest {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as TrainingDatasetManifest;
}

function characterTrainingDatasetsRoot(ownerKey: string, characterId: string): string {
  return path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey), "training-datasets", safeSegment(characterId));
}

function safeManifestPathFromInput(ownerKey: string, characterId: string, manifestPath: string): string {
  const root = characterTrainingDatasetsRoot(ownerKey, characterId);
  const resolvedRoot = path.resolve(root);
  const resolvedManifestPath = path.resolve(manifestPath);
  if (!resolvedManifestPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Invalid dataset manifest path for Applio artifact.");
  }
  return resolvedManifestPath;
}

export function applioTrainingArtifactDirectory(ownerKey: string, characterId: string, jobId: string): string {
  return path.join(
    OTG_DATA_ROOT,
    "characters",
    safeSegment(ownerKey),
    "applio-models",
    safeSegment(characterId),
    safeSegment(jobId),
  );
}

export function applioTrainingArtifactPath(ownerKey: string, characterId: string, jobId: string): string {
  return path.join(applioTrainingArtifactDirectory(ownerKey, characterId, jobId), "training-artifact.json");
}

export function applioTrainingArtifactUrl(ownerKey: string, characterId: string, jobId: string): string {
  const params = new URLSearchParams({
    owner: safeSegment(ownerKey),
    characterId: safeSegment(characterId),
    jobId: safeSegment(jobId),
  });
  return `/api/characters/applio-training/artifact?${params.toString()}`;
}

export function resolveApplioTrainingArtifactPath(ownerKey: string, characterId: string, jobId: string): string {
  const root = path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey), "applio-models");
  const artifactPath = path.join(root, safeSegment(characterId), safeSegment(jobId), "training-artifact.json");
  const resolvedRoot = path.resolve(root);
  const resolvedArtifactPath = path.resolve(artifactPath);
  if (!resolvedArtifactPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Invalid Applio training artifact path.");
  }
  return resolvedArtifactPath;
}

export function findLatestTrainingDatasetManifest(ownerKey: string, characterId: string): ManifestResolution | null {
  const root = characterTrainingDatasetsRoot(ownerKey, characterId);
  if (!fs.existsSync(root)) return null;

  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(root, entry.name, "manifest.json");
      try {
        const stat = fs.statSync(manifestPath);
        return { jobId: entry.name, manifestPath, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((item): item is { jobId: string; manifestPath: string; mtimeMs: number } => Boolean(item))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latest = candidates[0];
  if (!latest) return null;

  return {
    manifest: readManifest(latest.manifestPath),
    manifestPath: latest.manifestPath,
    manifestUrl: trainingDatasetManifestUrl(ownerKey, characterId, latest.jobId),
    sourceDatasetJobId: latest.jobId,
  };
}

type RealApplioPlan = {
  applioRoot: string;
  python: string;
  coreScript: string;
  outputDir: string;
  logsDir: string;
  stdoutPath: string;
  stderrPath: string;
  commandPath: string;
  preparedDatasetPath: string;
  modelName: string;
  modelPath: string;
  indexPath: string;
  expectedConfigPath: string;
  sampleRate: number;
  trainingQualityPreset: ApplioTrainingQualityPresetKey | string;
  estimatedDurationLabel: string;
  epochs: number;
  batchSize: number;
  saveEveryEpoch: number;
  gpu: string;
  f0Method: string;
  indexAlgorithm: string;
  vocoder: "HiFi-GAN" | "MRF HiFi-GAN" | "RefineGAN";
  cacheDataset: boolean;
  saveEveryWeights: "True" | "False";
  saveOnlyLatest: "True" | "False";
  pretrained: "True" | "False";
  customPretrained: "True" | "False";
  gPretrainedPath: string;
  dPretrainedPath: string;
  cutPreprocess: "Skip" | "Simple" | "Automatic";
  includeMutes: number;
  preprocessCpuCores: number;
  extractCpuCores: number;
};

function resolveApplioCoreScript(applioRoot: string): string {
  const explicitCore = cleanString(process.env.APPLIO_CORE_SCRIPT);
  if (explicitCore) {
    const resolved = path.resolve(explicitCore);
    if (!fs.existsSync(resolved)) throw new Error(`APPLIO_CORE_SCRIPT does not exist: ${resolved}`);
    return resolved;
  }

  const configured = requireExistingPath("APPLIO_TRAIN_SCRIPT", "training CLI entrypoint");
  if (path.basename(configured).toLowerCase() === "core.py") return configured;

  const siblingCore = path.join(path.dirname(configured), "core.py");
  if (fs.existsSync(siblingCore)) return siblingCore;

  const rootCore = path.join(applioRoot, "core.py");
  if (fs.existsSync(rootCore)) return rootCore;

  throw new Error(
    `APPLIO_TRAIN_SCRIPT points to ${configured}, but Applio core.py was not found. Set APPLIO_CORE_SCRIPT or APPLIO_TRAIN_SCRIPT to the Applio core.py CLI entrypoint.`,
  );
}

function applioCutPreprocess(): "Skip" | "Simple" | "Automatic" {
  const value = cleanString(process.env.APPLIO_CUT_PREPROCESS) || "Skip";
  if (value === "Skip" || value === "Simple" || value === "Automatic") return value;
  throw new Error(`APPLIO_CUT_PREPROCESS must be one of Skip, Simple, or Automatic. Received: ${value}`);
}

function applioIncludeMutes(): number {
  const raw = cleanString(process.env.APPLIO_INCLUDE_MUTES);
  if (!raw) return 2;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`APPLIO_INCLUDE_MUTES must be an integer from 0 through 10. Received: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error(`APPLIO_INCLUDE_MUTES must be an integer from 0 through 10. Received: ${raw}`);
  }
  return value;
}

function defaultApplioCpuCores(): number {
  return Math.max(1, Math.min(8, os.cpus().length || 1));
}

function integerEnvInRange(name: string, fallback: number, min: number, max: number): number {
  const raw = cleanString(process.env[name]);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer from ${min} through ${max}. Received: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}. Received: ${raw}`);
  }
  return value;
}

function applioBooleanEnv(name: string, fallback: "True" | "False"): "True" | "False" {
  const raw = cleanString(process.env[name]);
  if (!raw) return fallback;
  if (raw === "True" || raw === "False") return raw;
  throw new Error(`${name} must be True or False. Received: ${raw}`);
}

function applioVocoder(): "HiFi-GAN" | "MRF HiFi-GAN" | "RefineGAN" {
  const raw = cleanString(process.env.APPLIO_VOCODER) || "HiFi-GAN";
  if (raw === "HiFi-GAN" || raw === "MRF HiFi-GAN" || raw === "RefineGAN") return raw;
  throw new Error(`APPLIO_VOCODER must be one of HiFi-GAN, MRF HiFi-GAN, or RefineGAN. Received: ${raw}`);
}

function optionalExistingPath(envName: string, enabled: boolean): string {
  const value = cleanString(process.env[envName]);
  if (!enabled || !value) return "";
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${envName} does not exist for real Applio training: ${resolved}`);
  return resolved;
}

function resolveApplioTrainingQuality(input: Record<string, unknown>): {
  trainingQualityPreset: ApplioTrainingQualityPresetKey | string;
  epochs: number;
  saveEveryEpoch: number;
  estimatedDurationLabel: string;
} {
  const rawPreset = cleanString(input.trainingQualityPreset);
  if (rawPreset && !isApplioTrainingQualityPreset(rawPreset)) {
    throw new Error(`Invalid trainingQualityPreset. Expected fast, normal, or quality. Received: ${rawPreset}`);
  }
  const presetKey = (rawPreset || DEFAULT_APPLIO_TRAINING_QUALITY_PRESET) as ApplioTrainingQualityPresetKey;
  const preset = APPLIO_TRAINING_QUALITY_PRESETS[presetKey];
  const inputEpochs = positiveIntegerInput(input.epochs, "epochs");
  const inputSaveEveryEpoch = positiveIntegerInput(input.saveEveryEpoch, "saveEveryEpoch");
  const hasJobQuality = Boolean(rawPreset || inputEpochs || inputSaveEveryEpoch);
  const epochs = inputEpochs ?? (hasJobQuality ? preset.epochs : positiveIntegerEnv("APPLIO_EPOCHS", preset.epochs, 1, 10_000));
  const saveEveryEpoch =
    inputSaveEveryEpoch ?? (hasJobQuality ? preset.saveEveryEpoch : positiveIntegerEnv("APPLIO_SAVE_EVERY_EPOCH", preset.saveEveryEpoch, 1, 10_000));
  return {
    trainingQualityPreset: presetKey,
    epochs,
    saveEveryEpoch,
    estimatedDurationLabel: cleanString(input.estimatedDurationLabel) || preset.estimatedDurationLabel,
  };
}

function realApplioPlan(ownerKey: string, characterId: string, jobId: string, modelName: string, jobInput: Record<string, unknown>): RealApplioPlan {
  const applioRoot = requireExistingPath("APPLIO_ROOT", "Applio checkout root");
  const python = requireExistingPath("APPLIO_PYTHON", "Applio Python executable");
  const coreScript = resolveApplioCoreScript(applioRoot);
  const outputDir = applioTrainingArtifactDirectory(ownerKey, characterId, jobId);
  const logsDir = path.join(outputDir, "logs");
  const datasetsRoot = path.resolve(cleanString(process.env.APPLIO_DATASETS_ROOT) || path.join(OTG_DATA_ROOT, "applio", "datasets"));
  const preparedDatasetPath = path.join(datasetsRoot, modelName);
  const sampleRate = positiveIntegerEnv("APPLIO_SAMPLE_RATE", 40000, 16000, 48000);
  const trainingQuality = resolveApplioTrainingQuality(jobInput);
  const batchSize = positiveIntegerEnv("APPLIO_BATCH_SIZE", 4, 1, 256);
  const preprocessCpuCores = defaultApplioCpuCores();
  const modelPath = path.join(outputDir, `${modelName}.pth`);
  const indexPath = path.join(outputDir, `${modelName}.index`);
  const customPretrained = applioBooleanEnv("APPLIO_CUSTOM_PRETRAINED", "False");
  return {
    applioRoot,
    python,
    coreScript,
    outputDir,
    logsDir,
    stdoutPath: path.join(logsDir, "applio-stdout.log"),
    stderrPath: path.join(logsDir, "applio-stderr.log"),
    commandPath: path.join(logsDir, "applio-commands.json"),
    preparedDatasetPath,
    modelName,
    modelPath,
    indexPath,
    expectedConfigPath: path.join(outputDir, `${modelName}.json`),
    sampleRate,
    trainingQualityPreset: trainingQuality.trainingQualityPreset,
    estimatedDurationLabel: trainingQuality.estimatedDurationLabel,
    epochs: trainingQuality.epochs,
    batchSize,
    saveEveryEpoch: trainingQuality.saveEveryEpoch,
    gpu: cleanString(process.env.APPLIO_GPU) || "0",
    f0Method: cleanString(process.env.APPLIO_F0_METHOD) || "rmvpe",
    indexAlgorithm: cleanString(process.env.APPLIO_INDEX_ALGORITHM) || "Auto",
    vocoder: applioVocoder(),
    cacheDataset: boolFlag("APPLIO_CACHE_DATASET", true),
    saveEveryWeights: applioBooleanEnv("APPLIO_SAVE_EVERY_WEIGHTS", "True"),
    saveOnlyLatest: applioBooleanEnv("APPLIO_SAVE_ONLY_LATEST", "False"),
    pretrained: applioBooleanEnv("APPLIO_PRETRAINED", "True"),
    customPretrained,
    gPretrainedPath: optionalExistingPath("APPLIO_G_PRETRAINED_PATH", customPretrained === "True"),
    dPretrainedPath: optionalExistingPath("APPLIO_D_PRETRAINED_PATH", customPretrained === "True"),
    cutPreprocess: applioCutPreprocess(),
    includeMutes: applioIncludeMutes(),
    preprocessCpuCores,
    extractCpuCores: integerEnvInRange("APPLIO_EXTRACT_CPU_CORES", preprocessCpuCores, 1, 64),
  };
}

function prepareApplioDataset(dataset: ManifestResolution, plan: RealApplioPlan): void {
  fs.rmSync(plan.preparedDatasetPath, { recursive: true, force: true });
  ensureDir(plan.preparedDatasetPath);
  const readyClips = dataset.manifest.clips.filter((clip) => clip.status === "ready").slice(0, 200);
  for (const clip of readyClips) {
    const sourcePath = cleanString(clip.expectedAudioPath);
    const targetPath = path.join(plan.preparedDatasetPath, `${clip.clipId}.wav`);
    fs.copyFileSync(sourcePath, targetPath);
  }
  writeJsonAtomic(path.join(plan.preparedDatasetPath, "otg-dataset-source.json"), {
    schemaVersion: 1,
    sourceManifestPath: dataset.manifestPath,
    sourceDatasetJobId: dataset.sourceDatasetJobId,
    clipCount: readyClips.length,
    copiedAt: new Date().toISOString(),
  });
}

type ApplioCommand = {
  step: string;
  args: string[];
};

function commandLogPayload(plan: RealApplioPlan, commands: ApplioCommand[], validation?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    adapter: "applio_real_training",
    cwd: plan.applioRoot,
    modelName: plan.modelName,
    preparedDatasetPath: plan.preparedDatasetPath,
    trainingQualityPreset: plan.trainingQualityPreset,
    epochs: plan.epochs,
    saveEveryEpoch: plan.saveEveryEpoch,
    estimatedDurationLabel: plan.estimatedDurationLabel,
    validation: {
      extractCpuCores: plan.extractCpuCores,
      includeMutes: plan.includeMutes,
      saveEveryWeights: plan.saveEveryWeights,
      saveOnlyLatest: plan.saveOnlyLatest,
      pretrained: plan.pretrained,
      customPretrained: plan.customPretrained,
      vocoder: plan.vocoder,
      postExtractConfigPath: applioTrainingConfigPath(plan),
      ...(validation || {}),
    },
    commands: commands.map((command) => ({ step: command.step, command: plan.python, cwd: plan.applioRoot, args: command.args })),
  };
}

function buildApplioCommands(plan: RealApplioPlan): ApplioCommand[] {
  const common = ["--model_name", plan.modelName];
  const customPretrainedArgs = [
    ...(plan.customPretrained === "True" && plan.gPretrainedPath ? ["--g_pretrained_path", plan.gPretrainedPath] : []),
    ...(plan.customPretrained === "True" && plan.dPretrainedPath ? ["--d_pretrained_path", plan.dPretrainedPath] : []),
  ];
  return [
    {
      step: "preprocess",
      args: [
        plan.coreScript,
        "preprocess",
        ...common,
        "--dataset_path",
        plan.preparedDatasetPath,
        "--sample_rate",
        String(plan.sampleRate),
        "--cpu_cores",
        String(plan.preprocessCpuCores),
        "--cut_preprocess",
        plan.cutPreprocess,
      ],
    },
    {
      step: "extract",
      args: [
        plan.coreScript,
        "extract",
        ...common,
        "--f0_method",
        plan.f0Method,
        "--gpu",
        plan.gpu,
        "--sample_rate",
        String(plan.sampleRate),
        "--include_mutes",
        String(plan.includeMutes),
        "--cpu_cores",
        String(plan.extractCpuCores),
      ],
    },
    {
      step: "train",
      args: [
        plan.coreScript,
        "train",
        ...common,
        "--save_every_epoch",
        String(plan.saveEveryEpoch),
        "--save_only_latest",
        plan.saveOnlyLatest,
        "--save_every_weights",
        plan.saveEveryWeights,
        "--total_epoch",
        String(plan.epochs),
        "--sample_rate",
        String(plan.sampleRate),
        "--batch_size",
        String(plan.batchSize),
        "--gpu",
        plan.gpu,
        "--pretrained",
        plan.pretrained,
        "--custom_pretrained",
        plan.customPretrained,
        ...customPretrainedArgs,
        "--vocoder",
        plan.vocoder,
        "--cache_data_in_gpu",
        plan.cacheDataset ? "True" : "False",
        "--index_algorithm",
        plan.indexAlgorithm,
      ],
    },
  ];
}

function appendLog(filePath: string, text: string): void {
  fs.appendFileSync(filePath, text, "utf8");
}

function requireApplioFile(filePath: string, description: string): void {
  if (!hasBytes(filePath)) {
    throw new Error(`Missing required Applio ${description}: ${filePath}`);
  }
}

function validateApplioTrainingPrerequisites(plan: RealApplioPlan): void {
  const predictorsDir = path.join(plan.applioRoot, "rvc", "models", "predictors");
  const f0Method = plan.f0Method.toLowerCase();
  if (f0Method === "rmvpe") {
    requireApplioFile(path.join(predictorsDir, "rmvpe.pt"), "RMVPE predictor model for APPLIO_F0_METHOD=rmvpe");
  } else if (f0Method === "fcpe") {
    requireApplioFile(path.join(predictorsDir, "fcpe.pt"), "FCPE predictor model for APPLIO_F0_METHOD=fcpe");
  }

  if (plan.pretrained === "True" && plan.customPretrained === "False") {
    const pretrainedDir = path.join(plan.applioRoot, "rvc", "models", "pretraineds", plan.vocoder.toLowerCase());
    const sampleRatePrefix = `${String(plan.sampleRate).slice(0, 2)}k`;
    requireApplioFile(path.join(pretrainedDir, `f0G${sampleRatePrefix}.pth`), `generator pretrained checkpoint for ${plan.vocoder} ${plan.sampleRate}Hz`);
    requireApplioFile(path.join(pretrainedDir, `f0D${sampleRatePrefix}.pth`), `discriminator pretrained checkpoint for ${plan.vocoder} ${plan.sampleRate}Hz`);
  }
}

function hasApplioStageTraceback(stderrText: string): boolean {
  return stderrText.includes("Traceback (most recent call last)") || stderrText.includes("ValueError:");
}

type ApplioCommandResult = {
  stdoutText: string;
  stderrText: string;
  code: number | null;
};

function parseEpochProgress(text: string, totalEpochs: number): { currentEpoch: number; totalEpochs: number } | null {
  const patterns = [
    /epoch[=:\s]+(\d+)\s*\/\s*(\d+)/i,
    /(\d+)\s*\/\s*(\d+)[^\n\r]{0,40}epoch/i,
    /epoch[=:\s]+(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const currentEpoch = Number(match[1]);
    const parsedTotal = Number(match[2] || totalEpochs);
    if (Number.isInteger(currentEpoch) && currentEpoch > 0) {
      return {
        currentEpoch,
        totalEpochs: Number.isInteger(parsedTotal) && parsedTotal > 0 ? parsedTotal : totalEpochs,
      };
    }
  }
  return null;
}

function runApplioCommand(
  plan: RealApplioPlan,
  command: ApplioCommand,
  onEpochProgress?: (progress: { currentEpoch: number; totalEpochs: number }) => void,
): Promise<ApplioCommandResult> {
  const timeout = positiveIntegerEnv("APPLIO_TIMEOUT_MS", 7_200_000, 60_000, 24 * 60 * 60 * 1000);
  appendLog(plan.stdoutPath, `\n[${new Date().toISOString()}] START ${command.step}: ${plan.python} ${command.args.join(" ")}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(plan.python, command.args, {
      cwd: plan.applioRoot,
      env: { ...process.env },
      windowsHide: true,
    });
    let settled = false;
    let stdoutText = "";
    let stderrText = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Applio ${command.step} timed out after ${timeout}ms. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`));
    }, timeout);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutText += text;
      appendLog(plan.stdoutPath, text);
      if (command.step === "train" && onEpochProgress) {
        const epochProgress = parseEpochProgress(text, plan.epochs);
        if (epochProgress) onEpochProgress(epochProgress);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrText += text;
      appendLog(plan.stderrPath, text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Applio ${command.step} failed to start: ${error.message}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      appendLog(plan.stdoutPath, `\n[${new Date().toISOString()}] EXIT ${command.step}: ${code}\n`);
      if (code === 0 && hasApplioStageTraceback(stderrText)) {
        reject(new Error(`Applio ${command.step} reported a traceback despite exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`));
      } else if (code === 0) resolve({ stdoutText, stderrText, code });
      else reject(new Error(`Applio ${command.step} exited with code ${code}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`));
    });
  });
}

function applioTrainingConfigPath(plan: RealApplioPlan): string {
  return path.join(plan.applioRoot, "logs", plan.modelName, "config.json");
}

function countFilesWithExtension(dirPath: string, extension: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  return fs.readdirSync(dirPath, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension)).length;
}

function verifyApplioExtractOutputs(plan: RealApplioPlan): void {
  const modelRoot = path.join(plan.applioRoot, "logs", plan.modelName);
  const configPath = applioTrainingConfigPath(plan);
  if (!hasBytes(configPath)) {
    throw new Error(`Applio extract completed but training config.json was not created or is empty: ${configPath}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }
  const slicedCount = countFilesWithExtension(path.join(modelRoot, "sliced_audios"), ".wav");
  const f0Count = countFilesWithExtension(path.join(modelRoot, "f0"), ".npy");
  const f0VoicedCount = countFilesWithExtension(path.join(modelRoot, "f0_voiced"), ".npy");
  const extractedCount = countFilesWithExtension(path.join(modelRoot, "extracted"), ".npy");
  const filelistPath = path.join(modelRoot, "filelist.txt");
  if (!hasBytes(filelistPath)) {
    throw new Error(
      `Applio extract completed but filelist.txt is empty, so model training would not run. modelRoot: ${modelRoot}; sliced=${slicedCount}; f0=${f0Count}; f0_voiced=${f0VoicedCount}; extracted=${extractedCount}. Check APPLIO_F0_METHOD prerequisites such as rvc/models/predictors/rmvpe.pt. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
    );
  }
  if (slicedCount < 3 || f0Count < 3 || f0VoicedCount < 3 || extractedCount < 3) {
    throw new Error(
      `Applio extract produced insufficient training features. modelRoot: ${modelRoot}; sliced=${slicedCount}; f0=${f0Count}; f0_voiced=${f0VoicedCount}; extracted=${extractedCount}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
    );
  }
}

function verifyApplioTrainEvidence(plan: RealApplioPlan, stdoutText: string): void {
  const hasTrainingEvidence =
    stdoutText.includes("Starting training") ||
    stdoutText.includes("epoch=") ||
    stdoutText.includes("Training has been successfully completed");
  const hasIndexOnlyEvidence = stdoutText.includes("Generating index for") && stdoutText.includes("Saved index file");
  if (!hasTrainingEvidence && hasIndexOnlyEvidence) {
    throw new Error(
      `Applio train produced index only; model training did not run. Check extract filelist/features and Applio child process logs. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
    );
  }
}

type ApplioOutputDiscovery = {
  sourceModelPath: string;
  sourceIndexPath: string;
  searchedDirectories: string[];
};

function hasBytes(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function newestFileMatching(root: string, extension: ".pth" | ".index", modelName: string): string {
  if (!fs.existsSync(root)) return "";
  const found: { filePath: string; mtimeMs: number; score: number }[] = [];
  const normalizedModelName = modelName.toLowerCase();
  const visit = (dir: string, depth: number) => {
    if (depth > 5) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(filePath, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          const normalizedPath = filePath.toLowerCase();
          const normalizedName = entry.name.toLowerCase();
          const score = normalizedName.includes(normalizedModelName) ? 3 : normalizedPath.includes(normalizedModelName) ? 2 : 1;
          found.push({ filePath, mtimeMs: stat.mtimeMs, score });
        }
      }
    }
  };
  visit(root, 0);
  found.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs);
  return found[0]?.filePath || "";
}

function collectApplioOutputs(plan: RealApplioPlan): ApplioOutputDiscovery {
  const searchRoots = [
    path.join(plan.applioRoot, "assets", "weights"),
    path.join(plan.applioRoot, "logs", plan.modelName),
    path.join(plan.applioRoot, "logs"),
    path.resolve(cleanString(process.env.APPLIO_MODELS_ROOT) || path.join(OTG_DATA_ROOT, "applio", "models")),
    plan.outputDir,
  ];
  const searchedDirectories = Array.from(new Set(searchRoots.map((root) => path.resolve(root))));
  const sourceModelPath = searchedDirectories.map((root) => newestFileMatching(root, ".pth", plan.modelName)).find(Boolean) || "";
  const sourceIndexPath = searchedDirectories.map((root) => newestFileMatching(root, ".index", plan.modelName)).find(Boolean) || "";
  return { sourceModelPath, sourceIndexPath, searchedDirectories };
}

function copyVerifiedApplioOutputs(plan: RealApplioPlan, outputs: ApplioOutputDiscovery): void {
  if (!outputs.sourceModelPath || !outputs.sourceIndexPath) {
    if (outputs.sourceIndexPath && !outputs.sourceModelPath) {
      throw new Error(
        `Applio produced index but no model checkpoint. Check --save_every_weights and train logs. Searched: ${outputs.searchedDirectories.join("; ")}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
      );
    }
    throw new Error(
      `Applio training finished but required .pth/.index outputs were not found for ${plan.modelName}. Searched: ${outputs.searchedDirectories.join("; ")}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
    );
  }
  ensureDir(plan.outputDir);
  fs.copyFileSync(outputs.sourceModelPath, plan.modelPath);
  fs.copyFileSync(outputs.sourceIndexPath, plan.indexPath);
  if (!hasBytes(plan.modelPath) || !hasBytes(plan.indexPath)) {
    throw new Error(`Applio training copied outputs are missing or empty. modelPath: ${plan.modelPath}; indexPath: ${plan.indexPath}`);
  }
}

async function createRealApplioTrainingArtifact(
  ownerKey: string,
  job: QueuedContractJob,
  dataset: ManifestResolution,
  onProgress?: ApplioTrainingProgressCallback,
): Promise<ApplioTrainingArtifactResult> {
  ensureRealVoicePack(dataset);

  const characterId = cleanString(job.characterId);
  const modelName = `voice_model_${safeSegment(characterId)}_${safeSegment(job.jobId)}`;
  const plan = realApplioPlan(ownerKey, characterId, job.jobId, modelName, job.input || {});
  ensureDir(plan.outputDir);
  ensureDir(plan.logsDir);
  fs.writeFileSync(plan.stdoutPath, "", "utf8");
  fs.writeFileSync(plan.stderrPath, "", "utf8");
  const trainingStartedAt = new Date().toISOString();
  let stageStartedAt = trainingStartedAt;
  let currentStage: ApplioTrainingStage = "queued";
  let latestEpochProgress: { currentEpoch?: number; totalEpochs?: number; epochProgressPercent?: number; estimatedCompletionAt?: string } = {};
  const snapshot = (status: "running" | "trained" | "failed", message: string, extra: Partial<ApplioTrainingProgressSnapshot> = {}): ApplioTrainingProgressSnapshot => {
    const nowMs = Date.now();
    const trainingStartedMs = Date.parse(trainingStartedAt);
    const stageStartedMs = Date.parse(stageStartedAt);
    const elapsedTrainingMs = Math.max(0, nowMs - trainingStartedMs);
    const currentStageElapsedMs = Math.max(0, nowMs - stageStartedMs);
    return {
      mock: false,
      adapter: "applio_real_training",
      status,
      currentStage,
      stageStartedAt,
      elapsedTrainingMs,
      elapsedTrainingLabel: formatDuration(elapsedTrainingMs),
      currentStageElapsedMs,
      currentStageElapsedLabel: formatDuration(currentStageElapsedMs),
      trainingQualityPreset: plan.trainingQualityPreset,
      epochs: plan.epochs,
      saveEveryEpoch: plan.saveEveryEpoch,
      estimatedDurationLabel: plan.estimatedDurationLabel,
      trainingStartedAt,
      ...latestEpochProgress,
      ...extra,
      message,
    };
  };
  const emitProgress = async (stage: ApplioTrainingStage, message: string, extra: Partial<ApplioTrainingProgressSnapshot> = {}) => {
    currentStage = stage;
    stageStartedAt = new Date().toISOString();
    await onProgress?.(snapshot(stage === "completed" ? "trained" : stage === "failed" ? "failed" : "running", message, extra));
  };
  const emitSameStageProgress = async (message: string, extra: Partial<ApplioTrainingProgressSnapshot> = {}) => {
    await onProgress?.(snapshot("running", message, extra));
  };

  const testMode = process.env.OTG_APPLIO_TRAINING_TEST_MODE;
  try {
    await emitProgress("queued", `Applio training queued. Preset: ${plan.trainingQualityPreset}; epochs: ${plan.epochs}; save every ${plan.saveEveryEpoch}.`);
    if (!testMode) {
      validateApplioTrainingPrerequisites(plan);
    }
    prepareApplioDataset(dataset, plan);
  } catch (error) {
    await emitProgress("failed", "Applio training failed before subprocess execution.", {
      trainingFailedAt: new Date().toISOString(),
      failedStage: currentStage,
      totalTrainingMs: Date.now() - Date.parse(trainingStartedAt),
      totalTrainingLabel: formatDuration(Date.now() - Date.parse(trainingStartedAt)),
    });
    throw error;
  }
  const commands = buildApplioCommands(plan);
  writeJsonAtomic(plan.commandPath, commandLogPayload(plan, commands));

  let sourceModelPath = plan.modelPath;
  let sourceIndexPath = plan.indexPath;
  if (testMode === "success") {
    await emitProgress("train", `Applio test-mode training running. Preset: ${plan.trainingQualityPreset}.`);
    fs.writeFileSync(plan.modelPath, "fake pth", "utf8");
    fs.writeFileSync(plan.indexPath, "fake index", "utf8");
  } else {
    if (testMode === "stderr-traceback") {
      appendLog(plan.stderrPath, "Traceback (most recent call last)\nValueError: invalid literal for int() with base 10: 'None'\n");
      throw new Error(`Applio extract reported a traceback despite exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
    } else if (testMode === "missing-config") {
      verifyApplioExtractOutputs(plan);
    } else if (testMode === "empty-filelist") {
      const modelRoot = path.join(plan.applioRoot, "logs", plan.modelName);
      ensureDir(path.join(modelRoot, "sliced_audios"));
      ensureDir(path.join(modelRoot, "extracted"));
      ensureDir(path.join(modelRoot, "f0"));
      ensureDir(path.join(modelRoot, "f0_voiced"));
      fs.writeFileSync(path.join(modelRoot, "config.json"), JSON.stringify({ modelName: plan.modelName }), "utf8");
      fs.writeFileSync(path.join(modelRoot, "filelist.txt"), "", "utf8");
      fs.writeFileSync(path.join(modelRoot, "sliced_audios", "0_0_0.wav"), "fake wav", "utf8");
      fs.writeFileSync(path.join(modelRoot, "extracted", "0_0_0.npy"), "fake features", "utf8");
      verifyApplioExtractOutputs(plan);
    } else if (testMode === "external-outputs" || testMode === "index-only") {
      const configPath = applioTrainingConfigPath(plan);
      const modelRoot = path.dirname(configPath);
      const externalModelPath = path.join(plan.applioRoot, "assets", "weights", `${plan.modelName}.pth`);
      const externalIndexPath = path.join(plan.applioRoot, "logs", plan.modelName, `added_${plan.modelName}.index`);
      ensureDir(path.dirname(configPath));
      ensureDir(path.join(modelRoot, "sliced_audios"));
      ensureDir(path.join(modelRoot, "extracted"));
      ensureDir(path.join(modelRoot, "f0"));
      ensureDir(path.join(modelRoot, "f0_voiced"));
      ensureDir(path.dirname(externalModelPath));
      ensureDir(path.dirname(externalIndexPath));
      fs.writeFileSync(configPath, JSON.stringify({ modelName: plan.modelName }), "utf8");
      const filelistLines: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const stem = `0_${index}_0`;
        const wavPath = path.join(modelRoot, "sliced_audios", `${stem}.wav`);
        const extractedPath = path.join(modelRoot, "extracted", `${stem}.npy`);
        const f0Path = path.join(modelRoot, "f0", `${stem}.wav.npy`);
        const f0VoicedPath = path.join(modelRoot, "f0_voiced", `${stem}.wav.npy`);
        fs.writeFileSync(wavPath, "fake wav", "utf8");
        fs.writeFileSync(extractedPath, "fake features", "utf8");
        fs.writeFileSync(f0Path, "fake f0", "utf8");
        fs.writeFileSync(f0VoicedPath, "fake f0 voiced", "utf8");
        filelistLines.push(`${wavPath}|${extractedPath}|${f0Path}|${f0VoicedPath}|0`);
      }
      fs.writeFileSync(path.join(modelRoot, "filelist.txt"), filelistLines.join("\n"), "utf8");
      fs.writeFileSync(externalIndexPath, "fake external index", "utf8");
      if (testMode === "external-outputs") {
        fs.writeFileSync(externalModelPath, "fake external pth", "utf8");
      }
    } else if (testMode !== "missing-outputs") {
      for (const command of commands) {
        const stage: ApplioTrainingStage =
          command.step === "preprocess" || command.step === "extract" || command.step === "train" ? command.step : "train";
        await emitProgress(stage, `Applio ${command.step} started. Preset: ${plan.trainingQualityPreset}; epochs: ${plan.epochs}.`);
        const result = await runApplioCommand(plan, command, (epochProgress) => {
          const elapsedMs = Math.max(0, Date.now() - Date.parse(trainingStartedAt));
          const currentEpoch = epochProgress.currentEpoch;
          const totalEpochs = epochProgress.totalEpochs || plan.epochs;
          const epochProgressPercent = Math.max(0, Math.min(100, Math.round((currentEpoch / Math.max(1, totalEpochs)) * 100)));
          latestEpochProgress = {
            currentEpoch,
            totalEpochs,
            epochProgressPercent,
            estimatedCompletionAt: currentEpoch > 0
              ? new Date(Date.parse(trainingStartedAt) + Math.round((elapsedMs / currentEpoch) * totalEpochs)).toISOString()
              : undefined,
          };
          void emitSameStageProgress(`Applio train epoch ${currentEpoch}/${totalEpochs}.`);
        });
        if (command.step === "extract") {
          verifyApplioExtractOutputs(plan);
          writeJsonAtomic(plan.commandPath, commandLogPayload(plan, commands, { postExtractConfigExists: true }));
        } else if (command.step === "train") {
          verifyApplioTrainEvidence(plan, result.stdoutText);
        }
      }
    }
    if (testMode === "external-outputs" || testMode === "index-only") {
      await emitProgress("artifact_copy", "Verifying Applio test-mode external outputs.");
      verifyApplioExtractOutputs(plan);
      writeJsonAtomic(plan.commandPath, commandLogPayload(plan, commands, { postExtractConfigExists: true }));
    }
    await emitProgress("artifact_copy", "Collecting and copying verified Applio model artifacts.");
    const outputs = collectApplioOutputs(plan);
    copyVerifiedApplioOutputs(plan, outputs);
    sourceModelPath = outputs.sourceModelPath;
    sourceIndexPath = outputs.sourceIndexPath;
  }

  for (const requiredPath of [plan.modelPath, plan.indexPath]) {
    if (!hasBytes(requiredPath)) {
      throw new Error(`Applio training did not produce required output: ${requiredPath}`);
    }
  }
  await emitProgress("artifact_copy", "Verified Applio model and index outputs.");

  const artifactPath = applioTrainingArtifactPath(ownerKey, characterId, job.jobId);
  const clipCount = dataset.manifest.clips.length;
  const approvedSampleUrl = cleanString(dataset.manifest.source?.approvedSampleUrl);
  const trainingCompletedAt = new Date().toISOString();
  const totalTrainingMs = Math.max(0, Date.parse(trainingCompletedAt) - Date.parse(trainingStartedAt));
  const totalTrainingLabel = formatDuration(totalTrainingMs);
  const artifact: ApplioTrainingArtifact = {
    schemaVersion: 1,
    ownerKey,
    characterId,
    jobId: job.jobId,
    createdAt: new Date().toISOString(),
    status: "trained",
    mock: false,
    adapter: "applio_real_training",
    dataset: {
      manifestPath: dataset.manifestPath,
      manifestUrl: dataset.manifestUrl,
      sourceDatasetJobId: dataset.sourceDatasetJobId,
      clipCount,
      approvedSampleUrl,
      preparedDatasetPath: plan.preparedDatasetPath,
      generationMode: dataset.manifest.generationMode,
      provider: dataset.manifest.provider,
    },
    model: {
      modelName,
      expectedModelPath: plan.modelPath,
      expectedIndexPath: plan.indexPath,
      expectedConfigPath: plan.expectedConfigPath,
      modelPath: plan.modelPath,
      indexPath: plan.indexPath,
      sourceModelPath,
      sourceIndexPath,
      status: "trained",
    },
    logs: {
      logsDir: plan.logsDir,
      stdoutPath: plan.stdoutPath,
      stderrPath: plan.stderrPath,
      commandPath: plan.commandPath,
    },
    trainingQualityPreset: plan.trainingQualityPreset,
    epochs: plan.epochs,
    saveEveryEpoch: plan.saveEveryEpoch,
    estimatedDurationLabel: plan.estimatedDurationLabel,
    trainingStartedAt,
    trainingCompletedAt,
    totalTrainingMs,
    totalTrainingLabel,
    note: "Real Applio training ran through the configured local Applio CLI. Required .pth and .index outputs were verified.",
  };
  writeJsonAtomic(artifactPath, artifact);
  await emitProgress("completed", "Applio training completed.", {
    trainingCompletedAt,
    totalTrainingMs,
    totalTrainingLabel,
  });

  return {
    mock: false,
    adapter: "applio_real_training",
    artifactPath,
    artifactUrl: applioTrainingArtifactUrl(ownerKey, characterId, job.jobId),
    status: "trained",
    manifestPath: dataset.manifestPath,
    clipCount,
    modelName,
    expectedModelPath: plan.modelPath,
    expectedIndexPath: plan.indexPath,
    modelPath: plan.modelPath,
    indexPath: plan.indexPath,
    sourceModelPath,
    sourceIndexPath,
    stdoutPath: plan.stdoutPath,
    stderrPath: plan.stderrPath,
    commandPath: plan.commandPath,
    preparedDatasetPath: plan.preparedDatasetPath,
    trainingQualityPreset: plan.trainingQualityPreset,
    epochs: plan.epochs,
    saveEveryEpoch: plan.saveEveryEpoch,
    estimatedDurationLabel: plan.estimatedDurationLabel,
    currentStage: "completed",
    trainingStartedAt,
    trainingCompletedAt,
    totalTrainingMs,
    totalTrainingLabel,
    ...latestEpochProgress,
  };
}

export function resolveDatasetManifestForApplio(ownerKey: string, job: QueuedContractJob): ManifestResolution {
  const characterId = cleanString(job.characterId);
  if (!characterId) throw new Error("Missing characterId for Applio artifact.");

  const sourceDatasetJobId = cleanString(job.input.sourceDatasetJobId);
  const inputManifestPath = cleanString(job.input.manifestPath);

  if (inputManifestPath) {
    const manifestPath = safeManifestPathFromInput(ownerKey, characterId, inputManifestPath);
    if (!fs.existsSync(manifestPath)) throw new Error(`Dataset manifest not found: ${manifestPath}`);
    const manifest = readManifest(manifestPath);
    return {
      manifest,
      manifestPath,
      manifestUrl: cleanString(job.input.manifestUrl) || trainingDatasetManifestUrl(ownerKey, characterId, manifest.jobId),
      sourceDatasetJobId: cleanString(job.input.sourceDatasetJobId) || manifest.jobId,
    };
  }

  if (sourceDatasetJobId) {
    const manifestPath = resolveTrainingDatasetManifestPath(ownerKey, characterId, sourceDatasetJobId);
    if (!fs.existsSync(manifestPath)) throw new Error(`Dataset manifest not found: ${manifestPath}`);
    return {
      manifest: readManifest(manifestPath),
      manifestPath,
      manifestUrl: trainingDatasetManifestUrl(ownerKey, characterId, sourceDatasetJobId),
      sourceDatasetJobId,
    };
  }

  const latest = findLatestTrainingDatasetManifest(ownerKey, characterId);
  if (!latest) {
    throw new Error(`No dataset manifest found for character ${characterId}. Run generate_training_dataset first.`);
  }
  return latest;
}

export async function createApplioTrainingArtifact(
  ownerKey: string,
  job: QueuedContractJob,
  options: { onProgress?: ApplioTrainingProgressCallback } = {},
): Promise<ApplioTrainingArtifactResult> {
  if (job.jobType !== "character_voice_pipeline" || job.action !== "start_applio_training") {
    throw new Error("Applio training artifact can only be created for start_applio_training jobs.");
  }

  const characterId = cleanString(job.characterId);
  if (!characterId) throw new Error("Missing characterId for Applio artifact.");

  const dataset = resolveDatasetManifestForApplio(ownerKey, job);
  if (realApplioTrainingEnabled()) {
    return createRealApplioTrainingArtifact(ownerKey, job, dataset, options.onProgress);
  }

  const outputDir = applioTrainingArtifactDirectory(ownerKey, characterId, job.jobId);
  const artifactPath = applioTrainingArtifactPath(ownerKey, characterId, job.jobId);
  const modelName = `voice_model_${safeSegment(characterId)}_${safeSegment(job.jobId)}`;
  const expectedModelPath = path.join(outputDir, `${modelName}.pth`);
  const expectedIndexPath = path.join(outputDir, `${modelName}.index`);
  const expectedConfigPath = path.join(outputDir, `${modelName}.json`);
  const trainingQuality = resolveApplioTrainingQuality(job.input || {});
  const clipCount = Array.isArray(dataset.manifest.clips) ? dataset.manifest.clips.length : Number(dataset.manifest.requestedClipCount || 0);
  const generatedClipCount = Number(dataset.manifest.generatedClipCount || 0);
  if (dataset.manifest.status !== "voice_pack_ready" || generatedClipCount <= 0 || generatedClipCount < clipCount) {
    throw new Error(
      `Dataset manifest is not a ready voice pack. Run generate_training_dataset successfully first. manifestPath: ${dataset.manifestPath}`,
    );
  }
  const approvedSampleUrl = cleanString(dataset.manifest.source?.approvedSampleUrl);

  const artifact: ApplioTrainingArtifact = {
    schemaVersion: 1,
    ownerKey,
    characterId,
    jobId: job.jobId,
    createdAt: new Date().toISOString(),
    status: "training_artifact_ready",
    mock: true,
    adapter: "applio_training_artifact",
    dataset: {
      manifestPath: dataset.manifestPath,
      manifestUrl: dataset.manifestUrl,
      sourceDatasetJobId: dataset.sourceDatasetJobId,
      clipCount,
      approvedSampleUrl,
    },
    model: {
      modelName,
      expectedModelPath,
      expectedIndexPath,
      expectedConfigPath,
      status: "not_trained",
    },
    trainingQualityPreset: trainingQuality.trainingQualityPreset,
    epochs: trainingQuality.epochs,
    saveEveryEpoch: trainingQuality.saveEveryEpoch,
    estimatedDurationLabel: trainingQuality.estimatedDurationLabel,
    note: "No real Applio training has run. This artifact reserves deterministic model/index paths for the future Applio worker.",
  };

  writeJsonAtomic(artifactPath, artifact);

  return {
    mock: true,
    adapter: "applio_training_artifact",
    artifactPath,
    artifactUrl: applioTrainingArtifactUrl(ownerKey, characterId, job.jobId),
    status: "training_artifact_ready",
    manifestPath: dataset.manifestPath,
    clipCount,
    modelName,
    expectedModelPath,
    expectedIndexPath,
    trainingQualityPreset: trainingQuality.trainingQualityPreset,
    epochs: trainingQuality.epochs,
    saveEveryEpoch: trainingQuality.saveEveryEpoch,
    estimatedDurationLabel: trainingQuality.estimatedDurationLabel,
  };
}
