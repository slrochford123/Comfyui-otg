import { listVoicePipelineJobs } from "@/lib/jobs/voicePipelineJobs";
import { tickVoicePipelineWorker } from "@/lib/jobs/voicePipelineWorker";

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(argValue(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(25, Math.floor(value)));
}

function ownerKeyFromArgs(): string {
  return (
    argValue("owner") ||
    process.env.OTG_WORKER_OWNER_KEY ||
    process.env.OTG_DEVICE_ID ||
    process.env.NEXT_PUBLIC_OTG_DEVICE_ID ||
    "local"
  ).trim();
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.OTG_ALLOW_PRODUCTION_VOICE_WORKER !== "1") {
    throw new Error("Refusing to run voice worker in production without OTG_ALLOW_PRODUCTION_VOICE_WORKER=1.");
  }

  const ownerKey = ownerKeyFromArgs();
  const limit = numberArg("limit", 1);
  const before = listVoicePipelineJobs(ownerKey).filter((job) => job.status === "queued" || job.status === "running");
  const result = await tickVoicePipelineWorker(ownerKey, { limit });

  const payload = {
    ownerKey,
    limit,
    realQwenEnabled: process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE === "1",
    realCosyEnabled: process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE === "1",
    candidatesBefore: before.map((job) => ({
      jobId: job.jobId,
      jobType: job.jobType,
      action: job.action,
      status: job.status,
      progress: job.progress ?? null,
      message: job.message ?? null,
    })),
    processed: result.processed,
    jobs: result.jobs.map((job) => ({
      jobId: job.jobId,
      jobType: job.jobType,
      action: job.action,
      status: job.status,
      progress: job.progress ?? null,
      message: job.message ?? null,
      error: job.error ?? null,
      result: job.result ?? null,
      updatedAt: job.updatedAt,
    })),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
