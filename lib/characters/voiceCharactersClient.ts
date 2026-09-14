"use client";

export const VOICE_CHARACTER_PIPELINE_ENDPOINT =
  "/api/characters/voice-pipeline";

export const VOICE_CHARACTER_PIPELINE_ACTIONS = [
  "generate_training_dataset",
  "start_applio_training",
  "test_trained_voice",
] as const;

export type VoiceCharacterPipelineAction =
  (typeof VOICE_CHARACTER_PIPELINE_ACTIONS)[number];

type UnknownRecord = Record<string, unknown>;

export type VoiceCharacterProfile = {
  status?: string;
  trainingAdapter?: string;
  trainingMock?: boolean;
  modelPath?: string;
  indexPath?: string;
  approvedSamplePath?: string;
  approvedSampleUrl?: string;
  trainingStartedAt?: string;
  trainingCompletedAt?: string;
  updatedAt?: string;
  voiceModelArtifacts?: UnknownRecord[];
};

export type VoiceCharacterRecord = {
  id: string;
  name: string;
  imagePath?: string;
  previewImagePath?: string;
  transparentImagePath?: string;
  fullBodyImagePath?: string;
  defaultCharacterImagePath?: string;
  defaultCharacterPreviewImagePath?: string;
  characterCardPreviewImagePath?: string;
  referenceAudioPath?: string;
  voiceSettings?: UnknownRecord;
  characterVoiceProfile?: VoiceCharacterProfile | null;
  voiceStatus?: string;
  hasCustomVoice?: boolean;
  voiceEngineUsed?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HqVoiceArtifact = {
  modelPath: string;
  indexPath: string;
  adapter: string;
  status: string;
  trainedAt: string;
};

export type VoiceCharacterPipelineResponse = {
  ok?: boolean;
  job?: UnknownRecord;
  result?: UnknownRecord;
  error?: string;
};

export type VoiceCharacterPipelineJob = {
  jobId: string;
  action: string;
  characterId: string;
  status: string;
  progress: number;
  message: string;
  error?: string | null;
  input: UnknownRecord;
  result: UnknownRecord;
  createdAt: string;
  updatedAt: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as UnknownRecord;
}

function normalizeProfile(
  value: unknown,
): VoiceCharacterProfile | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const source = value as UnknownRecord;

  return {
    status: text(source.status) || undefined,
    trainingAdapter:
      text(source.trainingAdapter) || undefined,
    trainingMock:
      typeof source.trainingMock === "boolean"
        ? source.trainingMock
        : undefined,
    modelPath:
      text(source.modelPath) || undefined,
    indexPath:
      text(source.indexPath) || undefined,
    approvedSamplePath:
      text(source.approvedSamplePath) || undefined,
    approvedSampleUrl:
      text(source.approvedSampleUrl) || undefined,
    trainingStartedAt:
      text(source.trainingStartedAt) || undefined,
    trainingCompletedAt:
      text(source.trainingCompletedAt) || undefined,
    updatedAt:
      text(source.updatedAt) || undefined,
    voiceModelArtifacts:
      Array.isArray(source.voiceModelArtifacts)
        ? source.voiceModelArtifacts
            .filter(
              (item) =>
                item &&
                typeof item === "object" &&
                !Array.isArray(item),
            )
            .map((item) => item as UnknownRecord)
        : undefined,
  };
}

function normalizeCharacter(
  value: unknown,
): VoiceCharacterRecord | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const source = value as UnknownRecord;
  const id = text(source.id);
  const name = text(source.name);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    imagePath:
      text(source.imagePath) || undefined,
    previewImagePath:
      text(source.previewImagePath) || undefined,
    transparentImagePath:
      text(source.transparentImagePath) || undefined,
    fullBodyImagePath:
      text(source.fullBodyImagePath) || undefined,
    defaultCharacterImagePath:
      text(source.defaultCharacterImagePath) || undefined,
    defaultCharacterPreviewImagePath:
      text(source.defaultCharacterPreviewImagePath) || undefined,
    characterCardPreviewImagePath:
      text(source.characterCardPreviewImagePath) || undefined,
    referenceAudioPath:
      text(source.referenceAudioPath) || undefined,
    voiceSettings:
      Object.keys(record(source.voiceSettings)).length
        ? record(source.voiceSettings)
        : undefined,
    characterVoiceProfile:
      normalizeProfile(source.characterVoiceProfile),
    voiceStatus:
      text(source.voiceStatus) || undefined,
    hasCustomVoice:
      typeof source.hasCustomVoice === "boolean"
        ? source.hasCustomVoice
        : undefined,
    voiceEngineUsed:
      text(source.voiceEngineUsed) || undefined,
    createdAt:
      text(source.createdAt) || undefined,
    updatedAt:
      text(source.updatedAt) || undefined,
  };
}

export function hasOriginalVoiceSample(
  character: VoiceCharacterRecord,
): boolean {
  return Boolean(
    text(character.referenceAudioPath),
  );
}

export function voiceSampleUrl(
  character: VoiceCharacterRecord,
): string {
  const settings =
    record(character.voiceSettings);

  const savedUrl =
    text(settings.audioUrl) ||
    text(settings.referenceAudioUrl) ||
    text(settings.url);

  if (savedUrl) {
    return savedUrl;
  }

  const path =
    text(character.referenceAudioPath);

  return path
    ? `/api/file?path=${encodeURIComponent(path)}`
    : "";
}

function mediaUrl(
  value: unknown,
): string {
  const source = text(value);

  if (!source) return "";

  if (
    source.startsWith("/api/") ||
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("data:") ||
    source.startsWith("blob:")
  ) {
    return source;
  }

  return `/api/file?path=${encodeURIComponent(source)}`;
}

export function characterImageUrl(
  character: VoiceCharacterRecord,
): string {
  return mediaUrl(
    character.defaultCharacterPreviewImagePath ||
      character.previewImagePath ||
      character.characterCardPreviewImagePath ||
      character.defaultCharacterImagePath ||
      character.fullBodyImagePath ||
      character.imagePath,
  );
}

function artifactFromRecord(
  source: UnknownRecord,
): HqVoiceArtifact | null {
  const modelPath =
    text(source.modelPath);

  const indexPath =
    text(source.indexPath);

  const status =
    text(source.status).toLowerCase();

  const adapter =
    text(
      source.adapter ||
        source.trainingAdapter,
    ).toLowerCase();

  const explicitMock =
    source.mock === true ||
    source.trainingMock === true;

  if (
    !modelPath ||
    !indexPath ||
    status !== "trained" ||
    explicitMock
  ) {
    return null;
  }

  if (
    adapter &&
    adapter !== "applio_real_training"
  ) {
    return null;
  }

  return {
    modelPath,
    indexPath,
    adapter:
      adapter || "applio_real_training",
    status: "trained",
    trainedAt:
      text(
        source.trainingCompletedAt ||
          source.updatedAt ||
          source.createdAt,
      ),
  };
}

export function getReadyHqVoiceArtifact(
  character: VoiceCharacterRecord,
): HqVoiceArtifact | null {
  const profile =
    character.characterVoiceProfile;

  if (!profile) {
    return null;
  }

  const artifacts =
    Array.isArray(
      profile.voiceModelArtifacts,
    )
      ? profile.voiceModelArtifacts
      : [];

  const artifactMatches =
    artifacts
      .map(artifactFromRecord)
      .filter(
        (
          item,
        ): item is HqVoiceArtifact =>
          Boolean(item),
      );

  if (artifactMatches.length) {
    return artifactMatches[0];
  }

  return artifactFromRecord({
    ...profile,
    adapter:
      profile.trainingAdapter,
    mock:
      profile.trainingMock,
  });
}

export async function listVoiceCharacters(
  endpoint = "/api/characters",
): Promise<VoiceCharacterRecord[]> {
  const response =
    await fetch(endpoint, {
      cache: "no-store",
      credentials: "include",
    });

  const payload =
    await response
      .json()
      .catch(() => null);

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href =
        "/login?reason=session";
    }

    return [];
  }

  if (
    !response.ok ||
    !payload?.ok
  ) {
    throw new Error(
      text(payload?.error) ||
        "Could not load characters.",
    );
  }

  const rows: unknown[] =
    Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.characters)
        ? payload.characters
        : [];

  return rows
    .map(normalizeCharacter)
    .filter(
      (
        item,
      ): item is VoiceCharacterRecord =>
        Boolean(item),
    )
    .filter(hasOriginalVoiceSample);
}

export async function queueVoiceCharacterAction(
  character: VoiceCharacterRecord,
  action: VoiceCharacterPipelineAction,
  input: UnknownRecord = {},
): Promise<VoiceCharacterPipelineResponse> {
  const response =
    await fetch(
      VOICE_CHARACTER_PIPELINE_ENDPOINT,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          action,
          characterId:
            character.id,
          ...input,
        }),
      },
    );

  const payload =
    await response
      .json()
      .catch(() => null);

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href =
        "/login?reason=session";
    }

    return {
      ok: false,
      error: "Unauthorized",
    };
  }

  if (
    !response.ok ||
    !payload ||
    payload?.ok === false ||
    !payload?.job
  ) {
    throw new Error(
      text(payload?.error) ||
        `Could not queue ${action}.`,
    );
  }

  return {
    ...payload,
    ok: true,
  } as VoiceCharacterPipelineResponse;
}

function normalizePipelineJob(
  value: unknown,
): VoiceCharacterPipelineJob | null {
  const source = record(value);
  const jobId = text(source.jobId);
  const action = text(source.action);
  const characterId = text(source.characterId);

  if (!jobId || !action || !characterId) {
    return null;
  }

  const progress = Number(source.progress || 0);

  return {
    jobId,
    action,
    characterId,
    status: text(source.status),
    progress:
      Number.isFinite(progress)
        ? Math.max(0, Math.min(100, progress))
        : 0,
    message: text(source.message),
    error:
      source.error === null
        ? null
        : text(source.error) || undefined,
    input: record(source.input),
    result: record(source.result),
    createdAt: text(source.createdAt),
    updatedAt: text(source.updatedAt),
  };
}

export async function listVoiceCharacterJobs(
  characterId: string,
  endpoint = VOICE_CHARACTER_PIPELINE_ENDPOINT,
): Promise<VoiceCharacterPipelineJob[]> {
  const query = new URLSearchParams({
    characterId: text(characterId),
  });

  const response = await fetch(
    `${endpoint}?${query.toString()}`,
    {
      cache: "no-store",
      credentials: "include",
    },
  );

  const payload = await response
    .json()
    .catch(() => null);

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href =
        "/login?reason=session";
    }

    return [];
  }

  if (!response.ok) {
    throw new Error(
      text(payload?.error) ||
        "Could not load Voice Character jobs.",
    );
  }

  const rows: unknown[] =
    Array.isArray(payload?.jobs)
      ? payload.jobs
      : [];

  return rows
    .map(normalizePipelineJob)
    .filter(
      (
        job,
      ): job is VoiceCharacterPipelineJob =>
        Boolean(job),
    )
    .sort((a, b) =>
      (
        b.updatedAt ||
        b.createdAt
      ).localeCompare(
        a.updatedAt ||
          a.createdAt,
      ),
    );
}

export function isVoiceCharacterJobActive(
  job: VoiceCharacterPipelineJob,
): boolean {
  return !new Set([
    "completed",
    "failed",
    "canceled",
    "cancelled",
    "terminated",
    "ready_for_review",
  ]).has(
    text(job.status).toLowerCase(),
  );
}

export function voiceCharacterJobStage(
  job: VoiceCharacterPipelineJob,
): string {
  return text(
    record(job.result).currentStage ||
      record(job.result).stage ||
      "",
  );
}

export function voiceCharacterJobProgress(
  job: VoiceCharacterPipelineJob,
): number {
  const resultProgress = Number(
    record(job.result).progress,
  );

  if (Number.isFinite(resultProgress)) {
    return Math.max(
      0,
      Math.min(100, resultProgress),
    );
  }

  return Math.max(
    0,
    Math.min(100, job.progress),
  );
}
