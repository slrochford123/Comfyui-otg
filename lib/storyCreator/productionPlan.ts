import { randomUUID } from "node:crypto";

export type StoryPlanStatus = "draft" | "approved";
export type StoryShotStatus =
  | "planned"
  | "approved"
  | "generating"
  | "complete"
  | "needs_attention";
export type StoryTakeStatus =
  | "proposed"
  | "queued"
  | "running"
  | "complete"
  | "accepted"
  | "rejected";
export type StoryGenerationApproach =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "video-edit";

export type StoryPlanDialogueLine = {
  speaker: string;
  line: string;
  delivery: string;
};

export type StoryProductionTake = {
  id: string;
  version: number;
  status: StoryTakeStatus;
  assetId: string | null;
  generationJobId: string | null;
  productionId: string | null;
  productionSceneId: string | null;
  previewUrl: string | null;
  createdAt: number;
};

export type StoryProductionShot = {
  id: string;
  order: number;
  shotNumber: string;
  screenplayExcerpt: string;
  description: string;
  cameraFraming: string;
  cameraMovement: string;
  characterActions: string;
  dialogue: StoryPlanDialogueLine[];
  referenceAssetIds: string[];
  generationApproach: StoryGenerationApproach;
  requestedDurationSeconds: 5 | 10;
  status: StoryShotStatus;
  acceptedTakeId: string | null;
  takes: StoryProductionTake[];
};

export type StoryProductionScene = {
  id: string;
  order: number;
  sceneNumber: string;
  title: string;
  purpose: string;
  location: string;
  timeOfDay: string;
  characters: string[];
  action: string;
  dialogue: StoryPlanDialogueLine[];
  emotionalTone: string;
  continuityRequirements: string[];
  durationTargetSeconds: number;
  screenplaySource: string;
  shots: StoryProductionShot[];
};

export type StoryProductionAct = {
  id: string;
  order: number;
  title: string;
  summary: string;
  scenes: StoryProductionScene[];
};

export type StoryProductionPlan = {
  schemaVersion: 1;
  projectId: string;
  title: string;
  format: string;
  summary: string;
  targetDurationSeconds: number;
  status: StoryPlanStatus;
  acts: StoryProductionAct[];
};

export type StoryProductionPlanRecord = {
  projectId: string;
  ownerKey: string;
  version: number;
  status: StoryPlanStatus;
  plan: StoryProductionPlan;
  approvedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

function text(value: unknown, max = 20_000) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function positiveInt(value: unknown, fallback: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(max, Math.round(number))
    : fallback;
}

function id(value: unknown, prefix: string) {
  return text(value, 160) || `${prefix}-${randomUUID()}`;
}

function stringList(value: unknown, max = 30) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 240)).filter(Boolean).slice(0, max);
}

function dialogue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      speaker: text((item as any)?.speaker, 120),
      line: text((item as any)?.line, 4_000),
      delivery: text((item as any)?.delivery, 500),
    }))
    .filter((item) => item.speaker || item.line)
    .slice(0, 80);
}

function approach(value: unknown): StoryGenerationApproach {
  if (
    value === "image-to-video" ||
    value === "reference-to-video" ||
    value === "video-edit"
  ) {
    return value;
  }
  return "text-to-video";
}

function shotStatus(value: unknown): StoryShotStatus {
  if (
    value === "approved" ||
    value === "generating" ||
    value === "complete" ||
    value === "needs_attention"
  ) {
    return value;
  }
  return "planned";
}

function takeStatus(value: unknown): StoryTakeStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "complete" ||
    value === "accepted" ||
    value === "rejected"
  ) {
    return value;
  }
  return "proposed";
}

function normalizeTake(value: unknown, index: number): StoryProductionTake {
  const item = value && typeof value === "object" ? value as any : {};
  return {
    id: id(item.id, "take"),
    version: positiveInt(item.version, index + 1, 10_000),
    status: takeStatus(item.status),
    assetId: text(item.assetId, 160) || null,
    generationJobId: text(item.generationJobId, 160) || null,
    productionId: text(item.productionId, 160) || null,
    productionSceneId: text(item.productionSceneId, 160) || null,
    previewUrl: text(item.previewUrl, 2_000) || null,
    createdAt: positiveInt(item.createdAt, Date.now(), Number.MAX_SAFE_INTEGER),
  };
}

function normalizeShot(value: unknown, index: number): StoryProductionShot {
  const item = value && typeof value === "object" ? value as any : {};
  const duration = Number(item.requestedDurationSeconds) === 10 ? 10 : 5;
  const takes: StoryProductionTake[] = Array.isArray(item.takes)
    ? item.takes.slice(0, 100).map(normalizeTake)
    : [];
  const acceptedTakeId = text(item.acceptedTakeId, 160) || null;

  return {
    id: id(item.id, "shot"),
    order: positiveInt(item.order, index + 1, 10_000),
    shotNumber: text(item.shotNumber, 40) || String(index + 1),
    screenplayExcerpt: text(item.screenplayExcerpt),
    description: text(item.description),
    cameraFraming: text(item.cameraFraming, 500),
    cameraMovement: text(item.cameraMovement, 500),
    characterActions: text(item.characterActions, 4_000),
    dialogue: dialogue(item.dialogue),
    referenceAssetIds: stringList(item.referenceAssetIds, 20),
    generationApproach: approach(item.generationApproach),
    requestedDurationSeconds: duration,
    status: shotStatus(item.status),
    acceptedTakeId:
      acceptedTakeId && takes.some((take) => take.id === acceptedTakeId)
        ? acceptedTakeId
        : null,
    takes,
  };
}

function normalizeScene(value: unknown, index: number): StoryProductionScene {
  const item = value && typeof value === "object" ? value as any : {};
  return {
    id: id(item.id, "scene"),
    order: positiveInt(item.order, index + 1, 10_000),
    sceneNumber: text(item.sceneNumber, 40) || String(index + 1),
    title: text(item.title, 200) || `Scene ${index + 1}`,
    purpose: text(item.purpose, 2_000),
    location: text(item.location, 240),
    timeOfDay: text(item.timeOfDay, 120),
    characters: stringList(item.characters, 40),
    action: text(item.action),
    dialogue: dialogue(item.dialogue),
    emotionalTone: text(item.emotionalTone, 500),
    continuityRequirements: stringList(item.continuityRequirements, 40),
    durationTargetSeconds: positiveInt(item.durationTargetSeconds, 30, 7_200),
    screenplaySource: text(item.screenplaySource, 40_000),
    shots: Array.isArray(item.shots)
      ? item.shots.slice(0, 300).map(normalizeShot)
      : [],
  };
}

function normalizeAct(value: unknown, index: number): StoryProductionAct {
  const item = value && typeof value === "object" ? value as any : {};
  return {
    id: id(item.id, "act"),
    order: positiveInt(item.order, index + 1, 1_000),
    title: text(item.title, 200) || `Act ${index + 1}`,
    summary: text(item.summary, 4_000),
    scenes: Array.isArray(item.scenes)
      ? item.scenes.slice(0, 200).map(normalizeScene)
      : [],
  };
}

export function normalizeStoryProductionPlan(
  value: unknown,
  projectId: string,
): StoryProductionPlan {
  const item = value && typeof value === "object" ? value as any : {};
  return {
    schemaVersion: 1,
    projectId,
    title: text(item.title, 200) || "Untitled Production",
    format: text(item.format, 120) || "movie",
    summary: text(item.summary, 8_000),
    targetDurationSeconds: positiveInt(
      item.targetDurationSeconds,
      60,
      43_200,
    ),
    status: item.status === "approved" ? "approved" : "draft",
    acts: Array.isArray(item.acts)
      ? item.acts.slice(0, 50).map(normalizeAct)
      : [],
  };
}

export function createEmptyStoryProductionPlan(input: {
  projectId: string;
  title: string;
  format?: string;
  targetDurationSeconds?: number;
}): StoryProductionPlan {
  return normalizeStoryProductionPlan(
    {
      title: input.title,
      format: input.format || "movie",
      targetDurationSeconds: input.targetDurationSeconds || 60,
      acts: [{ title: "Act 1", summary: "", scenes: [] }],
    },
    input.projectId,
  );
}

export function storyProductionWorkload(plan: StoryProductionPlan) {
  const scenes = plan.acts.flatMap((act) => act.scenes);
  const shots = scenes.flatMap((scene) => scene.shots);
  return {
    actCount: plan.acts.length,
    sceneCount: scenes.length,
    shotCount: shots.length,
    plannedVideoSeconds: shots.reduce(
      (sum, shot) => sum + shot.requestedDurationSeconds,
      0,
    ),
    pendingVideoJobs: shots.filter(
      (shot) => !shot.takes.some((take) => take.status === "accepted"),
    ).length,
    acceptedTakes: shots.filter((shot) => shot.acceptedTakeId).length,
  };
}

export function parseStoryProductionPlanResponse(
  value: string,
  projectId: string,
) {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return normalizeStoryProductionPlan(JSON.parse(cleaned), projectId);
}
