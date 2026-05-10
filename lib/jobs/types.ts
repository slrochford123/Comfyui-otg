export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "completed"
  | "failed"
  | "cancelled"
  | "canceled";

export type JobKind =
  | "image-generation"
  | "video-generation"
  | "tts"
  | "voice-dubbing"
  | "audio-extraction"
  | "music-generation"
  | "angles-3d"
  | "production-stitch";

export type JobRecord = {
  id: string;
  ownerKey: string;
  deviceId: string | null;
  kind: JobKind;
  status: JobStatus;
  title: string | null;
  backend: string | null;
  promptId?: string | null;
  requestPayload?: unknown;
  outputPaths: string[];
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type JobProgress = {
  pct: number;
  step?: number;
  total_steps?: number;
  eta_seconds?: number;
  message?: string;
};

export type JobOutput = {
  thumbnailUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
};

export type Job = {
  id: string;
  status: JobStatus;
  prompts?: string[];
  progress?: JobProgress;
  output?: JobOutput;
  error?: {
    message?: string;
  };
  [key: string]: unknown;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createJobId(kind: JobKind): string {
  return `${kind}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
