import type {
  CharacterVoicePipelineAction,
  ProductionAudioStudioAction,
  QueuedContractJob,
} from "@/lib/jobs/voicePipelineJobs";

export type JobTerminalStatus = "completed" | "failed" | "canceled" | "cancelled" | "error";

export type QueueCharacterVoiceJobInput = {
  action: CharacterVoicePipelineAction;
  characterId: string;
  [key: string]: unknown;
};

export type QueueAudioStudioJobInput = {
  action: ProductionAudioStudioAction;
  clipId: string;
  [key: string]: unknown;
};

type JobResponse = {
  job?: QueuedContractJob;
  error?: string;
};

type WorkerTickResponse = {
  processed?: number;
  jobs?: QueuedContractJob[];
  error?: string;
};

type JobsListResponse = {
  jobs?: QueuedContractJob[];
  error?: string;
};

async function readJobResponse(response: Response, fallback: string): Promise<QueuedContractJob> {
  const json = (await response.json().catch(() => null)) as JobResponse | null;
  if (!response.ok || !json?.job) {
    throw new Error(json?.error || fallback);
  }
  return json.job;
}

export async function queueCharacterVoiceJob(input: QueueCharacterVoiceJobInput): Promise<QueuedContractJob> {
  const response = await fetch("/api/characters/voice-pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(input),
  });
  return readJobResponse(response, "Could not queue character voice job.");
}

export async function getCharacterVoiceJob(jobId: string): Promise<QueuedContractJob> {
  const response = await fetch(`/api/characters/voice-pipeline/${encodeURIComponent(jobId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  return readJobResponse(response, "Could not load character voice job.");
}

export async function updateCharacterVoiceJob(
  jobId: string,
  action: "stop" | "resume",
): Promise<QueuedContractJob> {
  const response = await fetch(`/api/characters/voice-pipeline/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ action }),
  });
  return readJobResponse(response, `Could not ${action} character voice job.`);
}

export async function listCharacterVoiceJobs(params: {
  action?: CharacterVoicePipelineAction;
  characterId?: string;
  status?: string;
} = {}): Promise<QueuedContractJob[]> {
  const search = new URLSearchParams();
  if (params.action) search.set("action", params.action);
  if (params.characterId) search.set("characterId", params.characterId);
  if (params.status) search.set("status", params.status);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const response = await fetch(`/api/characters/voice-pipeline${suffix}`, {
    credentials: "include",
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as JobsListResponse | null;
  if (!response.ok) {
    throw new Error(json?.error || `Could not list character voice jobs (${response.status}).`);
  }
  return Array.isArray(json?.jobs) ? json.jobs : [];
}

export async function queueAudioStudioJob(input: QueueAudioStudioJobInput): Promise<QueuedContractJob> {
  const response = await fetch("/api/production/audio-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(input),
  });
  return readJobResponse(response, "Could not queue audio studio job.");
}

export async function getAudioStudioJob(jobId: string): Promise<QueuedContractJob> {
  const response = await fetch(`/api/production/audio-studio/${encodeURIComponent(jobId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  return readJobResponse(response, "Could not load audio studio job.");
}

export function isTerminalJobStatus(status: string | null | undefined): status is JobTerminalStatus {
  return status === "completed" || status === "failed" || status === "canceled" || status === "cancelled" || status === "error";
}

export async function tickVoicePipelineWorker(
  limit = 1,
  jobId?: string,
): Promise<{ processed: number; jobs: QueuedContractJob[] }> {
  const response = await fetch("/api/characters/voice-pipeline/tick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ limit, ...(jobId ? { jobId } : {}) }),
  });
  const json = (await response.json().catch(() => null)) as WorkerTickResponse | null;
  if (!response.ok) {
    throw new Error(json?.error || `Voice worker tick unavailable (${response.status}).`);
  }
  return {
    processed: typeof json?.processed === "number" ? json.processed : 0,
    jobs: Array.isArray(json?.jobs) ? json.jobs : [],
  };
}