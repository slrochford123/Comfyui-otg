import type { StagedH3UploadDescriptor } from "@/lib/h3StagedUploads";

export type H3VoiceSequenceDraft = {
  cast: Array<{ characterId: string; voiceId?: string; visualRefMod?: string; audioRefMod?: string }>;
  mode: "h3-reference-to-video" | "h3-image-to-video" | "h3-text-to-video";
  recipe: "auto" | "native" | "visual-refmod" | "visual-refmod-wav" | "combined-refmod" | "fix-voices";
  prompt: string;
  durationSeconds: 5 | 10;
  stylePresetId: string;
  checkpointMode?: "standard" | "singularity-v1.3";
  seed?: number;
  firstImage?: StagedH3UploadDescriptor;
  openingTakeId?: string;
};

export type H3VoiceSequenceSubmission = { requestId: string; fingerprint: string };
export type H3VoiceAcceptedTake = {
  jobId: string;
  title: string;
  acceptedAt: string;
  galleryUrl: string;
  draft: H3VoiceSequenceDraft;
};

export type H3VoiceSequence = {
  draft: H3VoiceSequenceDraft | null;
  activeJobId?: string;
  submission?: H3VoiceSequenceSubmission;
  accepted: H3VoiceAcceptedTake[];
};
