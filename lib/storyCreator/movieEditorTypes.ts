export type MovieClipKind = "video" | "audio" | "title";
export type MovieAudioRole = "dialogue" | "narration" | "music" | "sound-effect" | "ambience" | "original";
export type MovieTransition = "cut" | "fade" | "crossfade" | "fade-black";

export type MovieTimelineClip = {
  id: string;
  kind: MovieClipKind;
  trackId: string;
  order: number;
  sceneId: string | null;
  shotId: string | null;
  sourceType: "story-video-take" | "story-audio-asset" | "generated-title";
  sourceId: string | null;
  label: string;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number | null;
  durationSeconds: number;
  transitionIn: MovieTransition;
  transitionOut: MovieTransition;
  transitionDurationSeconds: number;
  gainDb: number;
  muted: boolean;
  audioRole: MovieAudioRole | null;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  keepOriginalAudio: boolean;
  fit: "contain" | "cover";
  titleText: string;
};

export type MovieTimelineSnapshot = {
  schemaVersion: 1;
  projectId: string;
  planVersion: number;
  name: string;
  mode: "simple" | "advanced";
  clips: MovieTimelineClip[];
  settings: {
    width: number;
    height: number;
    fps: 24 | 30;
    aspectRatio: "16:9" | "9:16";
    quality: "draft-720p" | "standard-1080p";
    musicDucking: boolean;
    loudnessTargetLufs: number;
  };
  incomplete: boolean;
  missingMedia: Array<{ sceneId: string; shotId: string; label: string; reason: string }>;
};

export type MovieTimelineVersion = {
  id: string;
  timelineId: string;
  projectId: string;
  version: number;
  status: "draft" | "approved";
  label: string;
  snapshot: MovieTimelineSnapshot;
  createdAt: number;
};

export type MovieTimeline = {
  id: string;
  projectId: string;
  name: string;
  planVersion: number;
  currentVersion: number;
  approvedVersion: number | null;
  createdAt: number;
  updatedAt: number;
  versions: MovieTimelineVersion[];
};

export type MovieRenderStatus = "prepared" | "queued" | "running" | "completed" | "failed" | "canceled";
export type MovieRenderJob = {
  id: string;
  projectId: string;
  timelineId: string;
  timelineVersionId: string;
  status: MovieRenderStatus;
  preset: string;
  progress: number;
  stage: string;
  outputPath: string | null;
  downloadUrl: string | null;
  error: string | null;
  manifest: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};
