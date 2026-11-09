import type {
  StoryProductionPlan,
  StoryProductionShot,
} from "@/lib/storyCreator/productionPlan";
export type Workspace = "Plan" | "Cast & World" | "Storyboard" | "Action" | "Edit" | "Finish";
export type Aspect = "landscape" | "portrait" | "square";
export type AssetKind = "image" | "video" | "audio" | "character" | "refmod";
export type Asset = {
  id: string;
  projectId: string;
  name: string;
  kind: AssetKind;
  sha256: string;
  mime: string;
  bytes: number;
  createdAt: string;
  metadata: Record<string, unknown>;
};
export type Clip = {
  id: string;
  assetId: string;
  shotId?: string;
  in: number;
  out: number;
  transition: "cut" | "fade" | "dissolve";
  transitionSeconds: number;
  volume: number;
  editRevision?: number;
  audioMode?: "original" | "stems" | "hybrid";
};
export type GainRegion = { id: string; label: string; start: number; end: number; gain: number; evidence?: string };
export type MixControl = { volume: number; muted?: boolean; solo?: boolean; pan?: number };
export type AudioClip = {
  localMix?: MixControl;
  id: string;
  assetId: string;
  track: "dialogue" | "music" | "sfx" | "ambience";
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  label?: string;
  muted?: boolean;
  solo?: boolean;
  pan?: number;
  /** Linked stems use source-video seconds, not the current timeline position. */
  parentClipId?: string;
  sourceAssetId?: string;
  regions?: GainRegion[];
  keyframes?: { time: number; gain: number }[];
  loop?: boolean;
  loopCrossfade?: number;
  length?: number;
  treatment?: "none" | "telephone" | "room" | "level";
};
export type Title = {
  id: string;
  text: string;
  start: number;
  end: number;
  position: "top" | "center" | "bottom";
};
export type Timeline = {
  clips: Clip[];
  audio: AudioClip[];
  titles: Title[];
  duckMusic: boolean;
  mixTracks?: Partial<Record<AudioClip["track"], MixControl>>;
};
export type ShotSettings = {
  storyboardFrames?: {assetId:string;seconds:number;caption:string}[];
  storyboardApproval?: {key:string;versionId:string;at:string};
  audioSelections?: Record<string,string>;
  audioDecisions?: {sourceId:string;assetId:string;decision:"cinematic"|"original";at:string}[];
  direction?: import("./shotDirection").ShotDirection;
  shotStage?: "image" | "direction" | "review";
  retakeMode?: boolean;
  orientation?: "landscape"|"portrait";
  renderMode?: "native"|"turbo";
  quality?: "sh"|"hq";
  referenceLoader?: "auto"|"native"|"refmods"|"combined";
  referenceInput?: "images"|"refmods";
  refModIds?: string[];
  referenceRoles?: Record<string,{name:string;role:string}>;
  promptSource?: "director"|"manual";
  storyboardId?: string;
  storyboardApproved?: boolean;
  model: "standard" | "singularity" | "singularity-v1.3" | "fasth3";
  continuity: "new-scene" | "new-angle" | "previous-frame";
  firstImageId?: string;
  lastImageId?: string;
  referenceIds: string[];
  seed: number | null;
  approvedTakeId?: string;
  finalAssetId?: string;
  continuitySourceShotId?: string;
  continuityFrameSeconds?: number;
  continuityNotes?: string;
  cameraSetup?: string;
  continuityReviewed?: boolean;
  referenceSelectionExplicit?: boolean;
  storyboardCandidates?: string[];
  storyboardMode?: "auto" | "references" | "text";
  storyboardReferenceIds?: string[];
  storyboardInstructions?: string;
  /** Undefined follows the plan; an empty string deliberately clears the prompt. */
  storyboardPromptOverride?: string;
  videoPromptOverride?: string;
  useStoryboardFirstFrame?: boolean;
};
export type Brief = {
  clipName?: string;
  description: string;
  format: "movie" | "anime" | "commercial" | "music-video" | "custom";
  style: string;
  atmosphere: string;
  aspect: Aspect;
  targetSeconds: number;
  /** An unset target is represented explicitly; targetSeconds retains legacy compatibility. */
  durationOptional?: boolean;
};
export type Project = {
  workflow?: {version:2;workspace:Workspace;clipId?:string};
  storyboards?: {id:string;at:string;revision:number;clips:import("./workflow").StoryboardClip[]}[];
  clipEdits?: Record<string,{revision:number;sourceTakeId?:string;reviewedAgainstTakeId?:string;timeline:Timeline;history:Timeline[];future:Timeline[];videoPrompt?:string}>;
  schemaVersion: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  brief: Brief;
  storyProjectId: string | null;
  storyPlanVersion: number | null;
  plan: StoryProductionPlan;
  shots: Record<string, ShotSettings>;
  bindings: Array<{ assetId: string; role: string; approved: boolean }>;
  characterVoices?: Record<string, string>;
  audioStudioSessionId?: string;
  narratorVoice?: "af_heart" | "am_puck" | "bf_isabella" | "bm_fable";
  planningMode?: "ai" | "manual";
  planningReview?: string;
  lastChange?: string;
  retiredPlanShots?: StoryProductionShot[];
  film?: import("./filmStructure").FilmStructure;
  assemblies?: { id: string; name: string; createdAt: string; revision: number; timeline: Timeline }[];
  creation?: import("./createTypes").CreateManifest;
  timeline: Timeline;
  history: Timeline[];
  future: Timeline[];
  assistant: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
    shotId?: string;
    promptTarget?: "storyboard" | "video";
    shotPromptSuggestion?: import("./shotPrompts").ShotPromptSuggestion;
    directionSuggestion?: import("./shotDirection").DirectionProposal;
    suggestion?: StoryProductionPlan;
    storySuggestion?: import("./storyPreview").StoryPreview;
    basedOnPlanKey?: string;
    createSuggestion?: import("./createTypes").CreateSuggestion;
    basedOnItemKey?: string;
    changes?: string[];
    outlineSuggestion?: import("./filmStructure").FilmOutline;
    decision?: "accepted" | "rejected" | "superseded";
    appliedDirection?: {at:string;revision:number;duration:number};
    workspace?: Workspace;
    workflowSuggestion?: import("./workflowAssistant").WorkflowSuggestion;
  }>;
};
export type ExportSettings = {
  aspect: Aspect;
  resolution: 720 | 1080;
  fps: 24 | 30;
  format: "mp4" | "webm";
  filename: string;
};
export type JobKind =
  | "video-edit"
  | "audio-prepare"
  | "audio-preview"
  | "review"
  | "proxy"
  | "export"
  | "animatic"
  | "assistant"
  | "asset-analysis"
  | "asset-assistant"
  | "asset-image"
  | "preview"
  | "regenerate"
  | "audio-finish"
  | "finish"
  | "storyboard"
  | "voice";
export type Job = {
  id: string;
  projectId: string;
  kind: JobKind;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "canceling"
    | "attention";
  progress: number;
  queueStatus?: "queued" | "dispatching" | "running" | "unknown" | "completed" | "failed" | "canceled";
  message: string;
  input: Record<string, unknown>;
  outputAssetId: string | null;
  backendId: string | null;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  analysisResult?: { state: "Completed" | "Completed — Needs Creative Details"; storyKey: string; storyVersion: number; sourceRevision: number; itemCount: number };
};
export type Operation = { type: string; [key: string]: unknown };
export const DEFAULT_SHOT: ShotSettings = {
  model: "standard",
  continuity: "new-scene",
  referenceIds: [],
  seed: null,
};
export const EMPTY_TIMELINE: Timeline = {
  clips: [],
  audio: [],
  titles: [],
  duckMusic: true,
};
export function allShots(
  project: Pick<Project, "plan">,
): StoryProductionShot[] {
  return project.plan.acts.flatMap((a) => a.scenes.flatMap((s) => s.shots));
}
export function shotPhase(
  project: Project,
  shot: StoryProductionShot,
  jobs: Job[] = [],
): string {
  const s = project.shots[shot.id];
  const active = jobs.find(
    (j) =>
      j.input.shotId === shot.id &&
      ["queued", "running", "canceling"].includes(j.status),
  );
  if (active?.kind === "finish") return "Finishing";
  if (active && ["preview", "regenerate"].includes(active.kind))
    return "Preview";
  return s?.finalAssetId
    ? "Final Ready"
    : s?.approvedTakeId
      ? "Approved"
      : shot.takes.some((t) => ["complete", "accepted"].includes(t.status))
        ? "Review"
        : shot.takes.some(
              (t) => t.status === "running" || t.status === "queued",
            )
          ? "Preview"
          : "Draft";
}
export function timelineDuration(t: Timeline) {
  return t.clips.reduce(
    (sum, c, i) =>
      sum +
      c.out -
      c.in -
      (i > 0 && c.transition !== "cut" ? c.transitionSeconds : 0),
    0,
  );
}
export function deliveryDimensions(s: ExportSettings) {
  return s.aspect === "square"
    ? [s.resolution, s.resolution]
    : s.aspect === "portrait"
      ? [s.resolution, s.resolution === 1080 ? 1920 : 1280]
      : [s.resolution === 1080 ? 1920 : 1280, s.resolution];
}
