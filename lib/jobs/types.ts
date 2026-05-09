export type JobKind =
  | 'image-generation'
  | 'video-generation'
  | 'tts'
  | 'voice-dubbing'
  | 'audio-extraction'
  | 'music-generation'
  | 'angles-3d'
  | 'production-stitch';

// Keep backwards compatibility with the existing UI Job components while also
// supporting the newer unified job registry statuses.
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'cancelled'
  | 'retrying';

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

// Existing client-side job history shape used by components/jobs/* and lib/jobs/store.ts.
export type Job = {
  id: string;
  status: JobStatus;
  prompts?: string[];
  progress?: JobProgress;
  output?: JobOutput;
  error?: {
    message?: string;
  } | string | null;
  [key: string]: unknown;
};

// New server-side unified job registry shape.
export type JobRecord = {
  id: string;
  ownerKey: string;
  deviceId?: string | null;
  kind: JobKind;
  status: JobStatus;
  title?: string | null;
  backend?: string | null;
  promptId?: string | null;
  requestPayload?: unknown;
  outputPaths?: string[];
  error?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export function createJobId(kind: JobKind) {
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
