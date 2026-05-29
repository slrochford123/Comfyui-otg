export type VoiceGeneratorProvider = "qwen3" | "cosy";
export type CharacterVoiceProfileProvider = VoiceGeneratorProvider | "uploaded";
export type VoiceModelArtifactProvider = "applio";
export type VoiceModelArtifactMode = "noop" | "mock" | "real";
export type ApplioTrainingQualityPresetKey = "fast" | "normal" | "quality";

export type ApplioTrainingQualityPreset = {
  key: ApplioTrainingQualityPresetKey;
  label: string;
  epochs: number;
  saveEveryEpoch: number;
  estimatedDurationLabel: string;
  description: string;
};

export const APPLIO_TRAINING_QUALITY_PRESETS: Record<ApplioTrainingQualityPresetKey, ApplioTrainingQualityPreset> = {
  fast: {
    key: "fast",
    label: "Fast",
    epochs: 25,
    saveEveryEpoch: 5,
    estimatedDurationLabel: "20-40 minutes",
    description: "Quick test model, lower final quality.",
  },
  normal: {
    key: "normal",
    label: "Normal",
    epochs: 100,
    saveEveryEpoch: 10,
    estimatedDurationLabel: "45-90 minutes",
    description: "Recommended balanced production model.",
  },
  quality: {
    key: "quality",
    label: "Quality",
    epochs: 200,
    saveEveryEpoch: 10,
    estimatedDurationLabel: "90-180+ minutes",
    description: "Highest quality, longest training.",
  },
};

export const DEFAULT_APPLIO_TRAINING_QUALITY_PRESET: ApplioTrainingQualityPresetKey = "normal";

export function isApplioTrainingQualityPreset(value: unknown): value is ApplioTrainingQualityPresetKey {
  return value === "fast" || value === "normal" || value === "quality";
}

export type VoiceFxPreset =
  | "clean_dialogue"
  | "monstrous"
  | "angelic"
  | "stutter"
  | "echo"
  | "electric"
  | "stone_person"
  | "zombie"
  | "ghost"
  | "radio"
  | "robotic"
  | "distant_voice"
  | "whisper"
  | "custom";

export type VoicePipelineStatus =
  | "not_started"
  | "draft"
  | "queued"
  | "running"
  | "sample_ready"
  | "needs_approval"
  | "ready"
  | "trained"
  | "error";

export type CharacterVoiceProfile = {
  characterId: string;
  provider: CharacterVoiceProfileProvider;
  baseSamplePath?: string;
  baseSampleUrl?: string;
  approvedSamplePath?: string;
  approvedSampleUrl?: string;
  sourceJobId?: string;
  mockResult?: Record<string, unknown>;
  tunedSamplePath?: string;
  tunedSampleUrl?: string;
  tunedFxPreset?: VoiceFxPreset;
  tunedSourceJobId?: string;
  tunedAt?: string;
  tunedResult?: Record<string, unknown>;
  fxPreset?: VoiceFxPreset;
  fxSamplePath?: string;
  trainingJobId?: string;
  sourceTrainingJobId?: string;
  trainingAdapter?: string;
  trainingMock?: boolean;
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
  voiceModelArtifactId?: string;
  voiceModelArtifacts?: CharacterVoiceModelArtifact[];
  trainingArtifactPath?: string;
  trainingArtifactUrl?: string;
  datasetManifestPath?: string;
  datasetManifestUrl?: string;
  modelPath?: string;
  indexPath?: string;
  previewVideoJobId?: string;
  status: VoicePipelineStatus;
  updatedAt: string;
};

export type VoiceTrainingJob = {
  id: string;
  characterId: string;
  clipCount: number;
  status: VoicePipelineStatus;
  datasetPath?: string;
  applioRunPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type VoiceModelArtifact = {
  id: string;
  characterId: string;
  modelPath: string;
  indexPath: string;
  samplePath?: string;
  status: VoicePipelineStatus;
  createdAt: string;
};

export type CharacterVoiceModelArtifact = {
  id: string;
  characterId: string;
  provider: VoiceModelArtifactProvider;
  mode: VoiceModelArtifactMode;
  status: "training_artifact_ready" | "ready" | "trained" | "not_trained";
  adapter?: string;
  jobId: string;
  sourceJobId: string;
  sourceTrainingJobId?: string;
  artifactPath?: string;
  trainingArtifactPath?: string;
  artifactUrl?: string;
  trainingArtifactUrl?: string;
  modelPath?: string;
  indexPath?: string;
  datasetManifestPath?: string;
  datasetManifestUrl?: string;
  sourceDatasetJobId?: string;
  approvedSampleUrl?: string;
  approvedSamplePath?: string;
  clipCount?: number;
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
  mock?: boolean;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export function findUsableTrainedVoiceArtifact(profile?: CharacterVoiceProfile | null): CharacterVoiceModelArtifact | null {
  if (!profile) return null;
  const artifacts = Array.isArray(profile.voiceModelArtifacts) ? profile.voiceModelArtifacts : [];
  const usable = artifacts
    .filter((artifact) => (
      artifact.mock === false &&
      artifact.status === "trained" &&
      artifact.adapter === "applio_real_training" &&
      Boolean(cleanString(artifact.modelPath)) &&
      Boolean(cleanString(artifact.indexPath))
    ))
    .sort((a, b) => cleanString(b.updatedAt).localeCompare(cleanString(a.updatedAt)))[0];
  if (usable) return usable;
  if (
    profile.trainingMock === false &&
    profile.status === "trained" &&
    profile.trainingAdapter === "applio_real_training" &&
    cleanString(profile.modelPath) &&
    cleanString(profile.indexPath)
  ) {
    const now = profile.updatedAt || new Date().toISOString();
    return {
      id: cleanString(profile.voiceModelArtifactId) || `voice_model_${profile.characterId}`,
      characterId: profile.characterId,
      provider: "applio",
      mode: "real",
      status: "trained",
      adapter: "applio_real_training",
      jobId: cleanString(profile.sourceTrainingJobId || profile.trainingJobId) || "unknown",
      sourceJobId: cleanString(profile.sourceTrainingJobId || profile.trainingJobId) || "unknown",
      sourceTrainingJobId: cleanString(profile.sourceTrainingJobId || profile.trainingJobId) || undefined,
      artifactPath: profile.trainingArtifactPath,
      trainingArtifactPath: profile.trainingArtifactPath,
      artifactUrl: profile.trainingArtifactUrl,
      trainingArtifactUrl: profile.trainingArtifactUrl,
      modelPath: profile.modelPath,
      indexPath: profile.indexPath,
      datasetManifestPath: profile.datasetManifestPath,
      datasetManifestUrl: profile.datasetManifestUrl,
      approvedSampleUrl: profile.approvedSampleUrl,
      approvedSamplePath: profile.approvedSamplePath,
      trainingQualityPreset: profile.trainingQualityPreset,
      epochs: profile.epochs,
      saveEveryEpoch: profile.saveEveryEpoch,
      estimatedDurationLabel: profile.estimatedDurationLabel,
      trainingStartedAt: profile.trainingStartedAt,
      trainingCompletedAt: profile.trainingCompletedAt,
      totalTrainingMs: profile.totalTrainingMs,
      totalTrainingLabel: profile.totalTrainingLabel,
      mock: false,
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  return isRecord(child) ? child : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const clean = cleanString(value);
    if (clean) return clean;
  }
  return "";
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
}

export function buildApplioTrainingArtifactVoiceProfile(input: {
  characterId: string;
  jobId: string;
  result: unknown;
  jobInput?: Record<string, unknown>;
  currentProfile?: CharacterVoiceProfile | null;
  fallbackProvider?: CharacterVoiceProfileProvider;
  now?: string;
}): CharacterVoiceProfile | null {
  if (!isRecord(input.result)) return null;

  const result = input.result;
  const jobInput = input.jobInput || {};
  const dataset = nestedRecord(result, "dataset");
  const model = nestedRecord(result, "model");
  const now = input.now || new Date().toISOString();
  const characterId = cleanString(input.characterId);
  const jobId = cleanString(input.jobId);
  if (!characterId || !jobId) return null;

  const adapter = firstString(result.adapter);
  const resultStatus = firstString(result.status);
  const resultMock = result.mock === false ? false : true;
  const modelPath = firstString(result.modelPath, model.modelPath, result.expectedModelPath, model.expectedModelPath);
  const indexPath = firstString(result.indexPath, model.indexPath, result.expectedIndexPath, model.expectedIndexPath);
  const artifactPath = firstString(result.artifactPath, result.trainingArtifactPath);
  const artifactUrl = firstString(result.artifactUrl, result.trainingArtifactUrl);
  const datasetManifestPath = firstString(result.manifestPath, dataset.manifestPath, jobInput.manifestPath);
  const datasetManifestUrl = firstString(result.manifestUrl, dataset.manifestUrl, jobInput.manifestUrl);
  const sourceDatasetJobId = firstString(result.sourceDatasetJobId, dataset.sourceDatasetJobId, jobInput.sourceDatasetJobId);
  const approvedSampleUrl = firstString(result.approvedSampleUrl, dataset.approvedSampleUrl, jobInput.approvedSampleUrl, input.currentProfile?.approvedSampleUrl);
  const approvedSamplePath = firstString(result.approvedSamplePath, dataset.approvedSamplePath, jobInput.approvedSamplePath, input.currentProfile?.approvedSamplePath);
  const clipCount = firstNumber(result.clipCount, dataset.clipCount, jobInput.requestedClipCount);
  const modelName = firstString(result.modelName, model.modelName);
  const artifactId = firstString(result.modelArtifactId, modelName, `voice_model_${characterId}_${jobId}`);
  const trainingQualityPreset = firstString(result.trainingQualityPreset, jobInput.trainingQualityPreset);
  const epochs = firstNumber(result.epochs, jobInput.epochs);
  const saveEveryEpoch = firstNumber(result.saveEveryEpoch, jobInput.saveEveryEpoch);
  const estimatedDurationLabel = firstString(result.estimatedDurationLabel, jobInput.estimatedDurationLabel);
  const trainingStartedAt = firstString(result.trainingStartedAt);
  const trainingCompletedAt = firstString(result.trainingCompletedAt);
  const trainingFailedAt = firstString(result.trainingFailedAt);
  const failedStage = firstString(result.failedStage);
  const totalTrainingMs = firstNumber(result.totalTrainingMs);
  const totalTrainingLabel = firstString(result.totalTrainingLabel);
  const isRealTrainedArtifact =
    adapter === "applio_real_training" &&
    resultMock === false &&
    resultStatus === "trained" &&
    Boolean(modelPath && indexPath);

  if (!artifactPath && !modelPath && !indexPath) return null;
  if (adapter === "applio_real_training" && resultMock === false && resultStatus === "trained" && !isRealTrainedArtifact) {
    return null;
  }

  const currentProfile = input.currentProfile || null;
  const artifact: CharacterVoiceModelArtifact = {
    id: artifactId,
    characterId,
    provider: "applio",
    mode: isRealTrainedArtifact ? "real" : "noop",
    status: isRealTrainedArtifact ? "trained" : "training_artifact_ready",
    adapter: adapter || (isRealTrainedArtifact ? "applio_real_training" : "applio_training_artifact"),
    jobId,
    sourceJobId: jobId,
    sourceTrainingJobId: jobId,
    artifactPath: artifactPath || undefined,
    trainingArtifactPath: artifactPath || undefined,
    artifactUrl: artifactUrl || undefined,
    trainingArtifactUrl: artifactUrl || undefined,
    modelPath: modelPath || undefined,
    indexPath: indexPath || undefined,
    datasetManifestPath: datasetManifestPath || undefined,
    datasetManifestUrl: datasetManifestUrl || undefined,
    sourceDatasetJobId: sourceDatasetJobId || undefined,
    approvedSampleUrl: approvedSampleUrl || undefined,
    approvedSamplePath: approvedSamplePath || undefined,
    clipCount: clipCount || undefined,
    trainingQualityPreset: trainingQualityPreset || undefined,
    epochs: epochs || undefined,
    saveEveryEpoch: saveEveryEpoch || undefined,
    estimatedDurationLabel: estimatedDurationLabel || undefined,
    trainingStartedAt: trainingStartedAt || undefined,
    trainingCompletedAt: trainingCompletedAt || undefined,
    trainingFailedAt: trainingFailedAt || undefined,
    failedStage: failedStage || undefined,
    totalTrainingMs: totalTrainingMs || undefined,
    totalTrainingLabel: totalTrainingLabel || undefined,
    mock: !isRealTrainedArtifact,
    result,
    createdAt: now,
    updatedAt: now,
  };

  const existingArtifacts = Array.isArray(currentProfile?.voiceModelArtifacts)
    ? currentProfile.voiceModelArtifacts.filter((item) => item.sourceJobId !== jobId && item.jobId !== jobId)
    : [];

  return {
    ...(currentProfile || {
      characterId,
      provider: input.fallbackProvider || "qwen3",
      status: "sample_ready" as const,
      updatedAt: now,
    }),
    characterId,
    provider: currentProfile?.provider || input.fallbackProvider || "qwen3",
    status: isRealTrainedArtifact ? "trained" : "ready",
    trainingJobId: jobId,
    sourceTrainingJobId: jobId,
    trainingAdapter: artifact.adapter,
    trainingMock: !isRealTrainedArtifact,
    trainingQualityPreset: trainingQualityPreset || currentProfile?.trainingQualityPreset || undefined,
    epochs: epochs || currentProfile?.epochs || undefined,
    saveEveryEpoch: saveEveryEpoch || currentProfile?.saveEveryEpoch || undefined,
    estimatedDurationLabel: estimatedDurationLabel || currentProfile?.estimatedDurationLabel || undefined,
    trainingStartedAt: trainingStartedAt || currentProfile?.trainingStartedAt || undefined,
    trainingCompletedAt: trainingCompletedAt || currentProfile?.trainingCompletedAt || undefined,
    trainingFailedAt: trainingFailedAt || currentProfile?.trainingFailedAt || undefined,
    failedStage: failedStage || currentProfile?.failedStage || undefined,
    totalTrainingMs: totalTrainingMs || currentProfile?.totalTrainingMs || undefined,
    totalTrainingLabel: totalTrainingLabel || currentProfile?.totalTrainingLabel || undefined,
    voiceModelArtifactId: artifactId,
    voiceModelArtifacts: [...existingArtifacts, artifact],
    trainingArtifactPath: artifactPath || undefined,
    trainingArtifactUrl: artifactUrl || undefined,
    datasetManifestPath: datasetManifestPath || undefined,
    datasetManifestUrl: datasetManifestUrl || undefined,
    modelPath: modelPath || undefined,
    indexPath: indexPath || undefined,
    approvedSampleUrl: currentProfile?.approvedSampleUrl || approvedSampleUrl || undefined,
    approvedSamplePath: currentProfile?.approvedSamplePath || approvedSamplePath || undefined,
    updatedAt: now,
  };
}

export type AudioStudioJobBase = {
  id: string;
  clipId: string;
  status: VoicePipelineStatus;
  previewUrl?: string;
  outputPath?: string;
  createdAt: string;
  updatedAt: string;
};

export type DubExistingVoiceJob = AudioStudioJobBase & {
  kind: "dub_existing_voice";
  sourceVoiceId?: string;
  targetCharacterId: string;
  targetVoiceModelArtifactId?: string;
};

export type AddVoiceJob = AudioStudioJobBase & {
  kind: "add_voice";
  characterId?: string;
  voiceModelArtifactId?: string;
  spokenText: string;
  placement: "onscreen" | "offscreen" | "radio" | "ambient" | "crowd";
  fxPreset?: VoiceFxPreset;
  depth: "foreground" | "midground" | "background";
};

export type AudioStudioJob = DubExistingVoiceJob | AddVoiceJob;

export type QueuedPlaceholderResult = {
  ok: true;
  status: "queued";
  message: string;
};

function queuedPlaceholder(message: string): QueuedPlaceholderResult {
  return { ok: true, status: "queued", message };
}

export async function createVoiceSample(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("Voice sample generation is queued for backend integration.");
}

export async function applyVoiceFx(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("Voice FX processing is queued for backend integration.");
}

export async function generateVoiceDataset(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("200 training clip dataset generation is queued for backend integration.");
}

export async function startApplioTraining(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("Applio training is queued for backend integration.");
}

export async function testCharacterVoice(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("Character voice test playback is queued for backend integration.");
}

export async function generateCharacterPreviewVideo(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("LTX preview video generation is queued for backend integration.");
}

export async function dubPreviewVideo(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("Preview video dubbing is queued for backend integration.");
}

export async function dubExistingClipVoice(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("Existing clip voice dubbing is queued for backend integration.");
}

export async function addVoiceToClip(): Promise<QueuedPlaceholderResult> {
  return queuedPlaceholder("New or off-screen voice mixing is queued for backend integration.");
}
