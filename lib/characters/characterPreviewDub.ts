export const CHARACTER_PREVIEW_DUB_SCRIPT =
  "Hello, I am your created character. This is a voice dub test so you can hear the texture and sound of your created character.";

type VoiceJobLike = {
  jobId?: string;
  action?: string;
  status?: string;
  updatedAt?: string;
  result?: unknown;
};

export type CharacterPreviewDubSelection = {
  job: VoiceJobLike;
  dubbedPreviewVideoUrl: string;
  dubbedPreviewVideoPath: string;
  outputBytes: number;
  videoSrc: string;
  videoKey: string;
};

function objectResult(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clean(value: unknown): string {
  return String(value || "").trim();
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function withCacheBuster(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${encodeURIComponent(token)}`;
}

export function getCharacterPreviewDubSelection(job: VoiceJobLike | null | undefined): CharacterPreviewDubSelection | null {
  if (!job || job.action !== "generate_character_preview" || job.status !== "completed") return null;
  const result = objectResult(job.result);
  if (!result || result.mock !== false) return null;

  const dubbedPreviewVideoUrl = clean(result.dubbedPreviewVideoUrl || result.outputVideoUrl);
  if (!dubbedPreviewVideoUrl || dubbedPreviewVideoUrl.includes("/mock-assets/")) return null;

  const outputBytes = positiveNumber(result.outputBytes || result.dubbedPreviewVideoBytes || result.videoBytes);
  if (outputBytes <= 0) return null;

  const token = clean(job.updatedAt) || clean(job.jobId) || String(outputBytes);
  return {
    job,
    dubbedPreviewVideoUrl,
    dubbedPreviewVideoPath: clean(result.dubbedPreviewVideoPath || result.outputVideoPath),
    outputBytes,
    videoSrc: withCacheBuster(dubbedPreviewVideoUrl, token),
    videoKey: `${clean(job.jobId)}:${outputBytes}`,
  };
}

export function isCharacterPreviewDubReady(job: VoiceJobLike | null | undefined): boolean {
  return !!getCharacterPreviewDubSelection(job);
}
