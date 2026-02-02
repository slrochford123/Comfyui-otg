export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

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
