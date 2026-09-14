import fs from "node:fs";
import path from "node:path";

export type VoiceTrainingPolicy = {
  schemaVersion: number;
  acceptedMinutesMin: number;
  acceptedMinutesTarget: number;
  acceptedMinutesMax: number;
  referenceMode: "original-sample-only";
  speakerSimilarityRequired: boolean;
  transcriptVerificationRequired: boolean;
  audioQualityQcRequired: boolean;
  regenerateRejectedClips: boolean;
  maxGeneratedAttempts: number;
  maxClipRegenerations: number;
  requiredCoverage: string[];
  speakerSimilarityMin: number;
  transcriptSimilarityMin: number;
  audioQuality: {
    minDurationSeconds: number;
    maxDurationSeconds: number;
    minRms: number;
    maxClippingRatio: number;
    maxSilenceRatio: number;
    silenceAmplitude: number;
  };
  speakerQc: {
    engine: string;
    model: string;
    sampleRate: number;
    metric: string;
    executionDevice: string;
  };
  transcriptQc: {
    engine: string;
    endpoint: string;
    executionDevice: string;
  };
  rvc: {
    version: "v2";
    sampleRate: 48000;
    pitchExtractor: "rmvpe";
    pitchGuidance: true;
  };
  checkpointSelection: "held-out-best";
  checkpointEvaluation: {
    speakerSimilarityRequired: boolean;
    intelligibilityRequired: boolean;
    audioQualityRequired: boolean;
    artifactCheckRequired: boolean;
    performancePreservationRequired: boolean;
  };
  thresholdStatus?: string;
};

let cachedPolicy: VoiceTrainingPolicy | null = null;
let cachedPath = "";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

export function voiceTrainingPolicyPath(): string {
  return path.resolve(
    cleanString(process.env.VOICE_TRAINING_POLICY_PATH) ||
      path.join(process.cwd(), "config", "voice-training-policy.json"),
  );
}

function requireFiniteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new Error(
      `Invalid Voice Training policy ${label}: ${String(value)}.`,
    );
  }
  return numberValue;
}

function validateVoiceTrainingPolicy(
  input: VoiceTrainingPolicy,
): VoiceTrainingPolicy {
  requireFiniteNumber(
    input.acceptedMinutesMin,
    "acceptedMinutesMin",
    1,
    60,
  );
  requireFiniteNumber(
    input.acceptedMinutesTarget,
    "acceptedMinutesTarget",
    input.acceptedMinutesMin,
    input.acceptedMinutesMax,
  );
  requireFiniteNumber(
    input.acceptedMinutesMax,
    "acceptedMinutesMax",
    input.acceptedMinutesTarget,
    60,
  );

  if (input.referenceMode !== "original-sample-only") {
    throw new Error(
      "Voice Training policy must use referenceMode=original-sample-only.",
    );
  }

  if (
    !input.speakerSimilarityRequired ||
    !input.transcriptVerificationRequired ||
    !input.audioQualityQcRequired ||
    !input.regenerateRejectedClips
  ) {
    throw new Error(
      "Voice Training policy requires speaker, transcript, audio-quality QC, and regeneration.",
    );
  }

  if (
    input.rvc?.version !== "v2" ||
    input.rvc?.sampleRate !== 48000 ||
    String(input.rvc?.pitchExtractor || "").toLowerCase() !== "rmvpe" ||
    input.rvc?.pitchGuidance !== true
  ) {
    throw new Error(
      "Voice Training RVC policy must be v2 / 48 kHz / RMVPE / pitch-guided.",
    );
  }

  if (input.checkpointSelection !== "held-out-best") {
    throw new Error(
      "Voice Training policy must use held-out-best checkpoint selection.",
    );
  }

  return input;
}

export function loadVoiceTrainingPolicy(): VoiceTrainingPolicy {
  const policyPath = voiceTrainingPolicyPath();

  if (cachedPolicy && cachedPath === policyPath) {
    return cachedPolicy;
  }

  const raw = fs.readFileSync(
    policyPath,
    "utf8",
  );

  const parsed = JSON.parse(
    raw,
  ) as VoiceTrainingPolicy;

  cachedPolicy = validateVoiceTrainingPolicy(
    parsed,
  );

  cachedPath = policyPath;

  return cachedPolicy;
}

export function acceptedDurationSecondsMin(
  policy: VoiceTrainingPolicy = loadVoiceTrainingPolicy(),
): number {
  return Math.round(
    policy.acceptedMinutesMin * 60,
  );
}

export function acceptedDurationSecondsTarget(
  policy: VoiceTrainingPolicy = loadVoiceTrainingPolicy(),
): number {
  return Math.round(
    policy.acceptedMinutesTarget * 60,
  );
}

export function acceptedDurationSecondsMax(
  policy: VoiceTrainingPolicy = loadVoiceTrainingPolicy(),
): number {
  return Math.round(
    policy.acceptedMinutesMax * 60,
  );
}
