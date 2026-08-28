export type TrainedVoicePlaybackJobLike = {
  jobId?: string | null;
  action?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  result?: unknown;
};

export type TrainedVoicePlaybackSelection = {
  job: TrainedVoicePlaybackJobLike;
  outputAudioUrl: string;
  outputBytes: number;
  audioSrc: string;
  audioKey: string;
};

export type BaseVoicePlaybackSelection = {
  job: TrainedVoicePlaybackJobLike;
  audioUrl: string;
  audioBytes: number;
  audioSrc: string;
  audioKey: string;
};

export type VoicePreviewPrimaryActionInput = {
  trainedVoiceReady?: boolean;
  trainedVoiceInputAudioPath?: string | null;
  voiceTestText?: string | null;
  submitting?: boolean;
};

export type VoicePreviewPrimaryAction = {
  action: "test_trained_voice" | null;
  disabled: boolean;
  label: string;
  message: string;
};

function resultObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cacheBustedAudioUrl(outputAudioUrl: string, token: string): string {
  const separator = outputAudioUrl.includes("?") ? "&" : "?";
  return `${outputAudioUrl}${separator}t=${encodeURIComponent(token)}`;
}

export function getTrainedVoicePlaybackSelection(job: TrainedVoicePlaybackJobLike | null | undefined): TrainedVoicePlaybackSelection | null {
  if (!job || job.action !== "test_trained_voice" || job.status !== "completed") return null;

  const result = resultObject(job.result);
  if (!result || result.mock !== false) return null;

  const outputAudioUrl = String(result.outputAudioUrl || "").trim();
  const outputBytes = Number(result.outputBytes || 0);
  if (!outputAudioUrl || !Number.isFinite(outputBytes) || outputBytes <= 0) return null;

  const jobId = String(job.jobId || "").trim();
  const cacheToken = String(job.updatedAt || jobId || outputBytes).trim();

  return {
    job,
    outputAudioUrl,
    outputBytes,
    audioSrc: cacheBustedAudioUrl(outputAudioUrl, cacheToken),
    audioKey: `${jobId}:${outputBytes}`,
  };
}

export function getBaseVoicePlaybackSelection(job: TrainedVoicePlaybackJobLike | null | undefined): BaseVoicePlaybackSelection | null {
  if (!job || job.action !== "test_character_voice" || job.status !== "completed") return null;

  const result = resultObject(job.result);
  if (!result || result.mock === true) return null;

  const audioUrl = String(result.previewAudioUrl || result.outputAudioUrl || "").trim();
  const audioBytes = Number(result.previewBytes || result.outputBytes || 0);
  if (!audioUrl || !Number.isFinite(audioBytes) || audioBytes <= 0) return null;

  const mockUrl = audioUrl.startsWith("/mock-assets/");
  if (mockUrl) return null;

  const jobId = String(job.jobId || "").trim();
  const cacheToken = String(job.updatedAt || jobId || audioBytes).trim();

  return {
    job,
    audioUrl,
    audioBytes,
    audioSrc: cacheBustedAudioUrl(audioUrl, cacheToken),
    audioKey: `${jobId}:${audioBytes}`,
  };
}

export function selectLatestTrainedVoicePlaybackJob(jobs: Array<TrainedVoicePlaybackJobLike | null | undefined>): TrainedVoicePlaybackSelection | null {
  const selections = jobs
    .map((job) => getTrainedVoicePlaybackSelection(job))
    .filter((item): item is TrainedVoicePlaybackSelection => Boolean(item));

  if (!selections.length) return null;

  return selections.sort((a, b) => {
    const aTime = Date.parse(String(a.job.updatedAt || ""));
    const bTime = Date.parse(String(b.job.updatedAt || ""));
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    return String(b.job.jobId || "").localeCompare(String(a.job.jobId || ""));
  })[0];
}

export function getVoicePreviewPrimaryAction(input: VoicePreviewPrimaryActionInput): VoicePreviewPrimaryAction {
  const trainedVoiceReady = Boolean(input.trainedVoiceReady);
  const hasInputAudio = Boolean(String(input.trainedVoiceInputAudioPath || "").trim());
  const hasTestText = Boolean(String(input.voiceTestText || "").trim());
  const submitting = Boolean(input.submitting);

  if (!trainedVoiceReady) {
    return {
      action: null,
      disabled: true,
      label: "Speak With Trained Voice",
      message: "Train the voice model before testing custom speech.",
    };
  }

  return {
    action: "test_trained_voice",
    disabled: submitting || !hasInputAudio || !hasTestText,
    label: submitting ? "Generating trained voice..." : "Speak With Trained Voice",
    message: "Enter a sentence and generate playback using the trained voice model.",
  };
}
