export type StoryAudioKind =
  | "dialogue"
  | "narration"
  | "music"
  | "sound-effect"
  | "ambience"
  | "mix"
  | "enhancement"
  | "lip-sync";

export type StoryAudioStatus =
  | "prepared"
  | "queued"
  | "running"
  | "completed"
  | "accepted"
  | "rejected"
  | "failed"
  | "canceled";

export type StoryVoiceAssignment = {
  id: string;
  projectId: string;
  characterKey: string;
  characterName: string;
  entityId: string | null;
  voiceId: string;
  voiceName: string;
  provider: string;
  variant: string;
  speakingStyle: string;
  stability: number;
  authorizedReference: boolean;
  createdAt: number;
  updatedAt: number;
};

export type StoryAudioProviderContract = {
  provider: string;
  operation: string;
  endpoint: string;
  method: "POST";
  contentType: "application/json" | "multipart/form-data";
  model: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  request: Record<string, unknown>;
  capabilityStatus: "verified-route" | "verified-runtime" | "limited";
  limitations: string[];
};

export type StoryAudioAsset = {
  id: string;
  projectId: string;
  planVersion: number;
  sceneId: string;
  shotId: string;
  videoTakeId: string | null;
  derivedVideoTakeId: string | null;
  kind: StoryAudioKind;
  status: StoryAudioStatus;
  version: number;
  parentAssetId: string | null;
  speakerKey: string | null;
  speakerName: string | null;
  characterEntityId: string | null;
  voiceAssignmentId: string | null;
  exactText: string;
  prompt: string;
  emotion: string;
  delivery: string;
  startSeconds: number;
  durationSeconds: number | null;
  shotDurationSeconds: number;
  timingConflict: boolean;
  keepOriginalAudio: boolean;
  providerContract: StoryAudioProviderContract;
  sourceAssetIds: string[];
  sourcePaths: string[];
  outputPath: string | null;
  jobId: string | null;
  externalJobId: string | null;
  idempotencyKey: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  authorizedAt: number | null;
  completedAt: number | null;
  acceptedAt: number | null;
};

export type StoryAudioBatch = {
  id: string;
  projectId: string;
  planVersion: number;
  status: "prepared" | "queued" | "partial" | "completed" | "canceled";
  sceneIds: string[];
  shotIds: string[];
  assetIds: string[];
  maxJobs: number;
  workload: Record<string, number>;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  authorizedAt: number | null;
};

export type StoryAudioShotContext = {
  projectId: string;
  planVersion: number;
  scene: {
    id: string;
    number: string;
    title: string;
    characters: string[];
    location: string;
    timeOfDay: string;
    emotionalTone: string;
  };
  shot: {
    id: string;
    number: string;
    description: string;
    screenplayExcerpt: string;
    durationSeconds: number;
    dialogue: Array<{ speaker: string; line: string; delivery: string }>;
  };
  voiceAssignments: StoryVoiceAssignment[];
  acceptedVideoTakeIds: string[];
  capabilities: {
    dialogue: string;
    voiceConversion: string;
    music: string;
    soundEffects: string;
    mixing: string;
    enhancement: string;
    lipSync: string;
  };
  limitations: string[];
};
