import {
  isQwen3CreateVoiceSampleJob,
  type QueuedContractJob,
} from "@/lib/jobs/voicePipelineJobs";

// Qwen3-TTS is loaded inside the voice-design worker for each job. The
// disabled qwen3-tts catalog entry is status-only and is not a separately
// manageable lifecycle dependency.

export type VoiceLifecycleCommandSummary = {
  id: string;
  workerId: string;
  action: string;
  status: string;
  dryRun: boolean;
  requestedAt: string;
  claimedByAgentId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  error: string | null;
  finalState?: string | null;
  healthSummary?: string | null;
};

export type VoiceLifecycleHookResult = {
  enabled: boolean;
  strict: boolean;
  provider: string | null;
  requiredWorkers: string[];
  commands: VoiceLifecycleCommandSummary[];
  ready: boolean;
  warnings: string[];
  errors: string[];
  timedOut: boolean;
};

export type Qwen3VoiceLifecycleReleaseResult = {
  enabled: boolean;
  provider: string | null;
  jobId: string | null;
  requiredWorkers: string[];
  releaseQueued: boolean;
  deferred: boolean;
  commands: VoiceLifecycleCommandSummary[];
  warnings: string[];
  errors: string[];
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function envFlag(name: string): boolean {
  return cleanString(process.env[name]) === "1";
}

function providerFromRequest(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return null;
  const record = rawInput as Record<string, unknown>;
  return cleanString(record.provider || record.voiceProvider || record.method).toLowerCase() || null;
}

function providerFromJob(job: Pick<QueuedContractJob, "input"> | null | undefined): string | null {
  return providerFromRequest(job?.input);
}

function isCreateVoiceSample(rawInput: unknown): boolean {
  return !!rawInput &&
    typeof rawInput === "object" &&
    !Array.isArray(rawInput) &&
    cleanString((rawInput as Record<string, unknown>).action) === "create_voice_sample";
}

export function isQwen3VoiceSampleLifecycleTarget(rawInput: unknown): boolean {
  if (!isCreateVoiceSample(rawInput)) return false;
  const provider = providerFromRequest(rawInput);
  return provider === "qwen3" || provider === "qwen3-tts" || provider === "qwen3_tts";
}

function baseResult(rawInput: unknown): VoiceLifecycleHookResult {
  return {
    enabled: false,
    strict: envFlag("OTG_WORKER_LIFECYCLE_STRICT"),
    provider: providerFromRequest(rawInput),
    requiredWorkers: [],
    commands: [],
    ready: true,
    warnings: [],
    errors: [],
    timedOut: false,
  };
}

export function shouldBlockVoiceLifecycle(result: VoiceLifecycleHookResult): boolean {
  return result.enabled && result.strict && !result.ready;
}

export async function ensureQwen3VoiceSampleLifecycle(rawInput: unknown): Promise<VoiceLifecycleHookResult> {
  const result = baseResult(rawInput);
  if (!envFlag("OTG_WORKER_LIFECYCLE_ENABLED")) return result;
  if (!envFlag("OTG_WORKER_LIFECYCLE_QWEN3")) return result;
  if (!isQwen3VoiceSampleLifecycleTarget(rawInput)) return result;

  result.enabled = true;
  result.ready = true;
  result.warnings.push(
    "Qwen3-TTS lifecycle is managed inside the persistent voice-design worker; no standalone lifecycle command is required.",
  );
  return result;
}

function baseReleaseResult(job: Pick<QueuedContractJob, "jobId" | "input"> | null | undefined): Qwen3VoiceLifecycleReleaseResult {
  return {
    enabled: false,
    provider: providerFromJob(job),
    jobId: cleanString(job?.jobId) || null,
    requiredWorkers: [],
    releaseQueued: false,
    deferred: false,
    commands: [],
    warnings: [],
    errors: [],
  };
}

export function enqueueQwen3VoiceSampleLifecycleRelease(
  job: QueuedContractJob,
  outcome: "complete" | "failed",
): Qwen3VoiceLifecycleReleaseResult {
  const result = baseReleaseResult(job);
  if (!envFlag("OTG_WORKER_LIFECYCLE_ENABLED")) return result;
  if (!envFlag("OTG_WORKER_LIFECYCLE_QWEN3")) return result;
  if (!isQwen3CreateVoiceSampleJob(job)) return result;

  result.enabled = true;
  result.warnings.push(
    `Qwen3-TTS ${outcome} cleanup is handled inside the persistent voice-design worker; no standalone release command is required.`,
  );
  return result;
}
