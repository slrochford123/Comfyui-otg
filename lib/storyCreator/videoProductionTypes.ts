import type { H3AdvancedSettings } from "@/lib/production/h3Settings";
import type { ProductionV2H3UserLoraState } from "@/lib/production/h3Loras";
import type {
  H3Orientation,
  H3Quality,
} from "@/lib/production/h3ProductionRecipes";

export type StoryVideoMethod =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "video-edit";

export type StoryVideoTakeStatus =
  | "proposed"
  | "queued"
  | "claimed"
  | "running"
  | "postprocessing"
  | "completed"
  | "accepted"
  | "rejected"
  | "failed"
  | "canceled";

export type StoryVideoReferenceSnapshot = {
  versionId: string;
  assetId: string;
  name: string;
  kind: string;
  role: string;
  filePath: string;
  previewUrl: string | null;
  entityId: string | null;
  bindingType: string;
};

export type StoryVideoSettingsSnapshot = {
  orientation: H3Orientation;
  quality: H3Quality;
  durationSeconds: 5 | 10;
  seed: number;
  rifeInterpolation60Fps: boolean;
  userLoras: ProductionV2H3UserLoraState;
  h3Settings: H3AdvancedSettings;
  referenceVersionIds: string[];
  sourceTakeId: string | null;
  videoClipStartSeconds: number;
};

export type StoryVideoTake = {
  id: string;
  projectId: string;
  planVersion: number;
  sceneId: string;
  shotId: string;
  takeNumber: number;
  status: StoryVideoTakeStatus;
  method: StoryVideoMethod;
  generationJobId: string | null;
  idempotencyKey: string;
  parentTakeId: string | null;
  prompt: string;
  settings: StoryVideoSettingsSnapshot;
  references: StoryVideoReferenceSnapshot[];
  backend: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  resolution: string | null;
  outputPath: string | null;
  previewUrl: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  acceptedAt: number | null;
};

export type StoryVideoBatchStatus =
  | "prepared"
  | "queued"
  | "partial"
  | "completed"
  | "canceled";

export type StoryVideoBatch = {
  id: string;
  projectId: string;
  planVersion: number;
  status: StoryVideoBatchStatus;
  sceneIds: string[];
  shotIds: string[];
  takeIds: string[];
  maxJobs: number;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
};

export type StoryVideoShotContext = {
  projectId: string;
  planVersion: number;
  scene: {
    id: string;
    number: string;
    title: string;
    location: string;
    timeOfDay: string;
    characters: string[];
    action: string;
    emotionalTone: string;
    continuityRequirements: string[];
    screenplaySource: string;
  };
  shot: {
    id: string;
    number: string;
    description: string;
    screenplayExcerpt: string;
    cameraFraming: string;
    cameraMovement: string;
    characterActions: string;
    dialogue: Array<{ speaker: string; line: string; delivery: string }>;
    requestedDurationSeconds: 5 | 10;
  };
  availableReferences: StoryVideoReferenceSnapshot[];
  recommendedMethod: StoryVideoMethod;
  recommendationReason: string;
  limitations: string[];
};
