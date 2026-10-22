import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import {
  DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
  applyProductionV2H3UserLoraTriggers,
  normalizeProductionV2H3UserLoras,
} from "@/lib/production/h3Loras";
import {
  DEFAULT_H3_ADVANCED_SETTINGS,
  normalizeH3AdvancedSettings,
} from "@/lib/production/h3Settings";
import {
  normalizeH3Orientation,
  normalizeH3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  assertProductionV2BackgroundVisualReference,
  assertProductionV2H3StartingImage,
  type ProductionV2VisualReference,
} from "@/lib/production/v2";
import {
  cancelProductionV2GenerationJob,
  createProductionV2GenerationJob,
  getProductionV2GenerationJob,
  type ProductionV2GenerationJob,
} from "@/lib/production/h3GenerationJobs";
import {
  getStoryProductionPlan,
  listStoryBibleEntities,
  listStoryVisualAssets,
} from "@/lib/storyCreator/store";
import {
  normalizeStoryProductionPlan,
  type StoryProductionPlan,
  type StoryProductionScene,
  type StoryProductionShot,
} from "@/lib/storyCreator/productionPlan";
import type {
  StoryVideoBatch,
  StoryVideoMethod,
  StoryVideoReferenceSnapshot,
  StoryVideoSettingsSnapshot,
  StoryVideoShotContext,
  StoryVideoTake,
  StoryVideoTakeStatus,
} from "@/lib/storyCreator/videoProductionTypes";

let connection: Database.Database | null = null;
let connectionPath = "";
let storePathOverrideForTests: string | null = null;

function databasePath() {
  if (storePathOverrideForTests) return storePathOverrideForTests;
  const configured =
    String(process.env.OTG_DATA_DIR || "").trim()
    || String(process.env.OTG_DATA_ROOT || "").trim();
  const root = configured
    ? path.join(configured, "story-creator")
    : path.join(os.homedir(), "AI", "runtime", "story-creator");
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, "story-creator.sqlite");
}

function closeConnection() {
  try { connection?.close(); } catch {}
  connection = null;
  connectionPath = "";
}

export function setStoryVideoProductionStorePathForTests(value: string | null) {
  closeConnection();
  storePathOverrideForTests = value;
}

function db() {
  const filePath = databasePath();
  if (connection && connectionPath === filePath) return connection;
  closeConnection();
  const next = new Database(filePath);
  next.pragma("journal_mode = WAL");
  next.pragma("foreign_keys = ON");
  next.pragma("busy_timeout = 10000");
  next.exec(`
    CREATE TABLE IF NOT EXISTS story_video_takes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      plan_version INTEGER NOT NULL,
      scene_id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      take_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN (
        'proposed', 'queued', 'claimed', 'running', 'postprocessing',
        'completed', 'accepted', 'rejected', 'failed', 'canceled'
      )),
      method TEXT NOT NULL CHECK(method IN (
        'text-to-video', 'image-to-video', 'reference-to-video', 'video-edit'
      )),
      generation_job_id TEXT,
      idempotency_key TEXT NOT NULL,
      parent_take_id TEXT,
      prompt TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]',
      backend TEXT,
      workflow_id TEXT,
      workflow_file TEXT,
      resolution TEXT,
      output_path TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      accepted_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_take_id) REFERENCES story_video_takes(id) ON DELETE SET NULL,
      UNIQUE(project_id, owner_key, plan_version, scene_id, shot_id, take_number),
      UNIQUE(owner_key, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_video_takes_shot
      ON story_video_takes(project_id, owner_key, plan_version, scene_id, shot_id, take_number DESC);
    CREATE INDEX IF NOT EXISTS idx_story_video_takes_job
      ON story_video_takes(owner_key, generation_job_id);

    CREATE TABLE IF NOT EXISTS story_video_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      plan_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('prepared', 'queued', 'partial', 'completed', 'canceled')),
      scene_ids_json TEXT NOT NULL DEFAULT '[]',
      shot_ids_json TEXT NOT NULL DEFAULT '[]',
      take_ids_json TEXT NOT NULL DEFAULT '[]',
      max_jobs INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      approved_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      UNIQUE(owner_key, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_video_batches_project
      ON story_video_batches(project_id, owner_key, plan_version, created_at DESC);
  `);
  connection = next;
  connectionPath = filePath;
  return next;
}

function clean(value: unknown, max = 20_000) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function required(value: unknown, label: string, max = 240) {
  const output = clean(value, max);
  if (!output) throw new Error(`${label} is required.`);
  return output;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

function randomSeed() {
  return crypto.randomBytes(6).readUIntBE(0, 6);
}

function rowToTake(row: any): StoryVideoTake {
  const projectId = String(row.project_id);
  const id = String(row.id);
  const status = String(row.status) as StoryVideoTakeStatus;
  return {
    id,
    projectId,
    planVersion: Number(row.plan_version),
    sceneId: String(row.scene_id),
    shotId: String(row.shot_id),
    takeNumber: Number(row.take_number),
    status,
    method: String(row.method) as StoryVideoMethod,
    generationJobId: row.generation_job_id ? String(row.generation_job_id) : null,
    idempotencyKey: String(row.idempotency_key),
    parentTakeId: row.parent_take_id ? String(row.parent_take_id) : null,
    prompt: String(row.prompt || ""),
    settings: parseJson<StoryVideoSettingsSnapshot>(row.settings_json, {
      orientation: "landscape",
      quality: "lq",
      durationSeconds: 5,
      seed: 0,
      rifeInterpolation60Fps: false,
      userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
      h3Settings: DEFAULT_H3_ADVANCED_SETTINGS,
      referenceVersionIds: [],
      sourceTakeId: null,
      videoClipStartSeconds: 0,
    }),
    references: parseJson<StoryVideoReferenceSnapshot[]>(row.references_json, []),
    backend: row.backend ? String(row.backend) : null,
    workflowId: row.workflow_id ? String(row.workflow_id) : null,
    workflowFile: row.workflow_file ? String(row.workflow_file) : null,
    resolution: row.resolution ? String(row.resolution) : null,
    outputPath: row.output_path ? String(row.output_path) : null,
    previewUrl: row.output_path
      ? `/api/story-creator/video-production/media?projectId=${encodeURIComponent(projectId)}&takeId=${encodeURIComponent(id)}`
      : null,
    error: row.error ? String(row.error) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
  };
}

function rowToBatch(row: any): StoryVideoBatch {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    planVersion: Number(row.plan_version),
    status: row.status,
    sceneIds: parseJson<string[]>(row.scene_ids_json, []),
    shotIds: parseJson<string[]>(row.shot_ids_json, []),
    takeIds: parseJson<string[]>(row.take_ids_json, []),
    maxJobs: Number(row.max_jobs),
    idempotencyKey: String(row.idempotency_key),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    approvedAt: row.approved_at == null ? null : Number(row.approved_at),
  };
}

function assertOwnedProject(ownerKey: string, projectId: string) {
  const row = db().prepare(`
    SELECT id FROM story_projects
    WHERE id = ? AND owner_key = ? AND status = 'active' LIMIT 1
  `).get(projectId, ownerKey);
  if (!row) throw new Error("Story project was not found.");
}

function loadPlanVersion(ownerKey: string, projectId: string, planVersion: number) {
  assertOwnedProject(ownerKey, projectId);
  const row = db().prepare(`
    SELECT status, plan_json FROM story_production_plan_versions
    WHERE project_id = ? AND owner_key = ? AND version = ? LIMIT 1
  `).get(projectId, ownerKey, planVersion) as any;
  if (!row) throw new Error("Production plan version was not found.");
  return {
    status: row.status === "approved" ? "approved" as const : "draft" as const,
    plan: normalizeStoryProductionPlan(parseJson(row.plan_json, {}), projectId),
  };
}

function currentApprovedPlan(ownerKey: string, projectId: string) {
  const record = getStoryProductionPlan({ ownerKey, projectId });
  if (!record || record.status !== "approved") {
    throw new Error("Approve the production plan before preparing video takes.");
  }
  return record;
}

function findShot(plan: StoryProductionPlan, sceneId: string, shotId: string) {
  const scene = plan.acts.flatMap((act) => act.scenes).find((item) => item.id === sceneId);
  if (!scene) throw new Error("The selected scene is not part of this production plan version.");
  const shot = scene.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error("The selected shot is not part of this scene.");
  return { scene, shot };
}

function referencePriority(bindingType: string) {
  if (bindingType === "shot") return 0;
  if (bindingType === "scene") return 1;
  if (bindingType === "entity") return 2;
  return 3;
}

function availableReferences(input: {
  ownerKey: string;
  projectId: string;
  planVersion: number;
  scene: StoryProductionScene;
  shot: StoryProductionShot;
}) {
  const entities = listStoryBibleEntities(input);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.name]));
  const characterNames = new Set(input.scene.characters.map((name) => name.toLowerCase()));
  const output: StoryVideoReferenceSnapshot[] = [];

  for (const asset of listStoryVisualAssets(input)) {
    for (const version of asset.versions) {
      if (version.status !== "approved" || !version.filePath || !fs.existsSync(version.filePath)) continue;
      const bindings = asset.bindings.filter((binding) => {
        if (!binding.approved || binding.versionId !== version.id) return false;
        if (binding.bindingType === "project") return true;
        if (binding.bindingType === "shot") {
          return binding.planVersion === input.planVersion
            && binding.sceneId === input.scene.id
            && binding.shotId === input.shot.id;
        }
        if (binding.bindingType === "scene") {
          return binding.planVersion === input.planVersion
            && binding.sceneId === input.scene.id;
        }
        const name = binding.entityId ? entityName.get(binding.entityId) : "";
        return Boolean(name && characterNames.has(name.toLowerCase()));
      });
      if (!bindings.length) continue;
      const binding = [...bindings].sort((a, b) => referencePriority(a.bindingType) - referencePriority(b.bindingType))[0];
      output.push({
        versionId: version.id,
        assetId: asset.id,
        name: asset.name,
        kind: version.kind,
        role: binding.role || "reference",
        filePath: version.filePath,
        previewUrl: version.url,
        entityId: binding.entityId,
        bindingType: binding.bindingType,
      });
    }
  }

  return output
    .sort((a, b) => referencePriority(a.bindingType) - referencePriority(b.bindingType))
    .slice(0, 9);
}

function isShotImage(reference: StoryVideoReferenceSnapshot) {
  return reference.kind === "storyboard"
    || reference.kind === "scene_image"
    || reference.kind === "shot_reference";
}

function recommendMethod(references: StoryVideoReferenceSnapshot[]) {
  const exactImage = references.find((reference) => isShotImage(reference));
  if (exactImage) {
    return {
      method: "image-to-video" as const,
      reason: "An approved storyboard or shot image can anchor the opening frame.",
    };
  }
  if (references.length) {
    return {
      method: "reference-to-video" as const,
      reason: "Approved character or environment references are available for continuity.",
    };
  }
  return {
    method: "text-to-video" as const,
    reason: "No approved model-facing image is attached to this shot yet.",
  };
}

export function getStoryVideoShotContext(input: {
  ownerKey: unknown;
  projectId: unknown;
  planVersion?: unknown;
  sceneId: unknown;
  shotId: unknown;
}): StoryVideoShotContext {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const current = currentApprovedPlan(ownerKey, projectId);
  const planVersion = Number(input.planVersion || current.version);
  const loaded = loadPlanVersion(ownerKey, projectId, planVersion);
  if (loaded.status !== "approved") throw new Error("Video production requires an approved plan version.");
  const { scene, shot } = findShot(
    loaded.plan,
    required(input.sceneId, "Scene id"),
    required(input.shotId, "Shot id"),
  );
  const references = availableReferences({ ownerKey, projectId, planVersion, scene, shot });
  const recommended = recommendMethod(references);
  const limitations: string[] = [];
  if (!references.length) limitations.push("No approved visual reference is attached; identity continuity will rely on text only.");
  if (references.length > 1) limitations.push("Reference guidance improves continuity but MiniMax H3 cannot guarantee exact identity consistency.");
  return {
    projectId,
    planVersion,
    scene: {
      id: scene.id,
      number: scene.sceneNumber,
      title: scene.title,
      location: scene.location,
      timeOfDay: scene.timeOfDay,
      characters: scene.characters,
      action: scene.action,
      emotionalTone: scene.emotionalTone,
      continuityRequirements: scene.continuityRequirements,
      screenplaySource: scene.screenplaySource,
    },
    shot: {
      id: shot.id,
      number: shot.shotNumber,
      description: shot.description,
      screenplayExcerpt: shot.screenplayExcerpt,
      cameraFraming: shot.cameraFraming,
      cameraMovement: shot.cameraMovement,
      characterActions: shot.characterActions,
      dialogue: shot.dialogue,
      requestedDurationSeconds: shot.requestedDurationSeconds,
    },
    availableReferences: references,
    recommendedMethod: recommended.method,
    recommendationReason: recommended.reason,
    limitations,
  };
}

function compactPrompt(
  context: StoryVideoShotContext,
  motion: string,
  references: StoryVideoReferenceSnapshot[],
) {
  const lines = [
    context.shot.description,
    context.shot.characterActions,
    motion,
    [context.shot.cameraFraming, context.shot.cameraMovement].filter(Boolean).join(", "),
    [context.scene.location, context.scene.timeOfDay, context.scene.emotionalTone].filter(Boolean).join(", "),
    context.scene.continuityRequirements.length
      ? `Continuity: ${context.scene.continuityRequirements.join("; ")}`
      : "",
    ...references.map((reference, index) =>
      `<Picture ${index + 1}> is <Subject ${index + 1}>: preserve ${reference.name}.`),
  ].map((line) => clean(line, 2_000)).filter(Boolean);
  return lines.join("\n").slice(0, 8_000);
}

function normalizeMethod(value: unknown, fallback: StoryVideoMethod): StoryVideoMethod {
  return value === "text-to-video"
    || value === "image-to-video"
    || value === "reference-to-video"
    || value === "video-edit"
    ? value
    : fallback;
}

function selectReferences(
  available: StoryVideoReferenceSnapshot[],
  requestedIds: unknown,
) {
  if (!Array.isArray(requestedIds)) return available;
  const ids = new Set(requestedIds.map((value) => clean(value, 160)).filter(Boolean));
  return available.filter((reference) => ids.has(reference.versionId));
}

function validateMethod(
  method: StoryVideoMethod,
  references: StoryVideoReferenceSnapshot[],
  sourceTake: StoryVideoTake | null,
) {
  if (method === "text-to-video" && references.length) {
    throw new Error("Text-to-Video cannot consume image references. Choose Reference-to-Video or clear the selected references.");
  }
  if (method === "image-to-video" && references.length !== 1) {
    throw new Error("Image-to-Video requires exactly one approved starting image.");
  }
  if (method === "reference-to-video" && (!references.length || references.length > 9)) {
    throw new Error("Reference-to-Video requires between one and nine approved image references.");
  }
  if (method === "video-edit" && (!sourceTake?.outputPath || !["completed", "accepted", "rejected"].includes(sourceTake.status))) {
    throw new Error("Video editing requires a completed source take.");
  }
}

function assertOwnedTake(ownerKey: string, projectId: string, takeId: string) {
  const row = db().prepare(`
    SELECT * FROM story_video_takes
    WHERE id = ? AND project_id = ? AND owner_key = ? LIMIT 1
  `).get(takeId, projectId, ownerKey) as any;
  if (!row) throw new Error("Story video take was not found.");
  return rowToTake(row);
}

export function getStoryVideoTake(input: {
  ownerKey: unknown;
  projectId: unknown;
  takeId: unknown;
}) {
  return assertOwnedTake(
    required(input.ownerKey, "Story owner"),
    required(input.projectId, "Story project id"),
    required(input.takeId, "Take id"),
  );
}

export function recordStoryAudioDrivenVideoTake(input: {
  ownerKey: unknown;
  projectId: unknown;
  sourceTakeId: unknown;
  outputPath: unknown;
  prompt: unknown;
  externalJobId: unknown;
  idempotencyKey: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const source = assertOwnedTake(ownerKey, projectId, required(input.sourceTakeId, "Source take id"));
  if (source.status !== "accepted" || !source.outputPath) {
    throw new Error("Audio-driven video requires an accepted source take.");
  }
  const outputPath = required(input.outputPath, "Derived video output", 2_000);
  const idempotencyKey = required(input.idempotencyKey, "Derived take idempotency key", 240);
  const existing = db().prepare(`SELECT * FROM story_video_takes WHERE owner_key=? AND idempotency_key=? LIMIT 1`).get(ownerKey, idempotencyKey) as any;
  if (existing) return rowToTake(existing);
  const takeNumber = Number((db().prepare(`
    SELECT COALESCE(MAX(take_number), 0) AS value FROM story_video_takes
    WHERE project_id=? AND owner_key=? AND plan_version=? AND scene_id=? AND shot_id=?
  `).get(projectId, ownerKey, source.planVersion, source.sceneId, source.shotId) as any)?.value || 0) + 1;
  const id = randomUUID();
  const now = Date.now();
  const settings: StoryVideoSettingsSnapshot = { ...source.settings, sourceTakeId: source.id };
  db().prepare(`
    INSERT INTO story_video_takes (
      id, project_id, owner_key, plan_version, scene_id, shot_id, take_number,
      status, method, generation_job_id, idempotency_key, parent_take_id,
      prompt, settings_json, references_json, backend, workflow_id, workflow_file,
      resolution, output_path, error, created_at, updated_at, completed_at, accepted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'video-edit', ?, ?, ?, ?, ?, '[]',
      'ltx-2.3', 'production-lipsync-image-to-video', 'production-lipsync.json', ?, ?, NULL, ?, ?, ?, NULL)
  `).run(
    id, projectId, ownerKey, source.planVersion, source.sceneId, source.shotId, takeNumber,
    clean(input.externalJobId, 240) || null, idempotencyKey, source.id,
    clean(input.prompt, 8_000), JSON.stringify(settings), source.resolution, outputPath,
    now, now, now,
  );
  return assertOwnedTake(ownerKey, projectId, id);
}

export function prepareStoryVideoTake(input: {
  ownerKey: unknown;
  projectId: unknown;
  planVersion?: unknown;
  sceneId: unknown;
  shotId: unknown;
  method?: unknown;
  motion?: unknown;
  durationSeconds?: unknown;
  orientation?: unknown;
  quality?: unknown;
  seed?: unknown;
  rifeInterpolation60Fps?: unknown;
  userLoras?: unknown;
  h3Settings?: unknown;
  referenceVersionIds?: unknown;
  sourceTakeId?: unknown;
  videoClipStartSeconds?: unknown;
  parentTakeId?: unknown;
  idempotencyKey?: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const context = getStoryVideoShotContext(input);
  const requestedReferenceIds = Array.isArray(input.referenceVersionIds)
    ? input.referenceVersionIds
    : undefined;
  let references = selectReferences(context.availableReferences, requestedReferenceIds);
  const method = normalizeMethod(input.method, context.recommendedMethod);
  if (input.method == null && method === "image-to-video") {
    references = references.filter(isShotImage).slice(0, 1);
  }
  const sourceTakeId = clean(input.sourceTakeId, 160) || null;
  const sourceTake = sourceTakeId
    ? assertOwnedTake(ownerKey, projectId, sourceTakeId)
    : null;
  if (method === "video-edit") references = [];
  validateMethod(method, references, sourceTake);

  const durationSeconds = Number(input.durationSeconds || context.shot.requestedDurationSeconds) === 10 ? 10 : 5;
  const orientation = normalizeH3Orientation(input.orientation);
  const quality = normalizeH3Quality(input.quality);
  const requestedSeed = Number(input.seed);
  const seed = Number.isSafeInteger(requestedSeed) && requestedSeed >= 0
    ? requestedSeed
    : randomSeed();
  const motion = clean(input.motion, 4_000);
  const basePrompt = method === "video-edit"
    ? [
        "Use <Video 1> as the exact temporal and visual reference.",
        "Preserve subjects, timing, composition, and audio unless the requested change explicitly says otherwise.",
        `Requested visual transformation: ${motion || "Refine this accepted take while preserving continuity."}`,
      ].join("\n")
    : compactPrompt(context, motion, references);
  const userLoras = normalizeProductionV2H3UserLoras(input.userLoras);
  const prompt = applyProductionV2H3UserLoraTriggers(basePrompt, userLoras);
  const settings: StoryVideoSettingsSnapshot = {
    orientation,
    quality,
    durationSeconds,
    seed,
    rifeInterpolation60Fps: input.rifeInterpolation60Fps === true,
    userLoras,
    h3Settings: normalizeH3AdvancedSettings(input.h3Settings, references.length),
    referenceVersionIds: references.map((reference) => reference.versionId),
    sourceTakeId,
    videoClipStartSeconds: Math.max(0, Number(input.videoClipStartSeconds || 0) || 0),
  };
  const idempotencyKey = clean(input.idempotencyKey, 240) || `prepare-${randomUUID()}`;
  const existing = db().prepare(`
    SELECT * FROM story_video_takes WHERE owner_key = ? AND idempotency_key = ? LIMIT 1
  `).get(ownerKey, idempotencyKey) as any;
  if (existing) return { context, take: rowToTake(existing), requiresExplicitConfirmation: true };

  const takeNumber = Number((db().prepare(`
    SELECT COALESCE(MAX(take_number), 0) AS value FROM story_video_takes
    WHERE project_id = ? AND owner_key = ? AND plan_version = ? AND scene_id = ? AND shot_id = ?
  `).get(projectId, ownerKey, context.planVersion, context.scene.id, context.shot.id) as any)?.value || 0) + 1;
  const now = Date.now();
  const id = randomUUID();
  db().prepare(`
    INSERT INTO story_video_takes (
      id, project_id, owner_key, plan_version, scene_id, shot_id, take_number,
      status, method, generation_job_id, idempotency_key, parent_take_id,
      prompt, settings_json, references_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, ownerKey, context.planVersion, context.scene.id, context.shot.id,
    takeNumber, method, idempotencyKey, clean(input.parentTakeId, 160) || sourceTakeId,
    prompt, JSON.stringify(settings), JSON.stringify(references), now, now,
  );
  return {
    context,
    take: assertOwnedTake(ownerKey, projectId, id),
    requiresExplicitConfirmation: true,
  };
}

function toProductionReference(reference: StoryVideoReferenceSnapshot, index: number): ProductionV2VisualReference {
  const slot = index + 1;
  const character = reference.kind === "character" || reference.kind === "villain";
  const background = reference.kind === "location" || reference.kind === "environment";
  const output: ProductionV2VisualReference = {
    id: reference.versionId,
    name: reference.name,
    sourceKind: character ? "character" : background ? "background" : "asset",
    generationSourceType: character ? "character-card" : background ? "background-master" : "asset-default",
    sourceId: reference.assetId,
    pictureSlot: slot as ProductionV2VisualReference["pictureSlot"],
    subjectSlot: slot as ProductionV2VisualReference["subjectSlot"],
    identityDescription: `${reference.name} approved Storyteller visual reference`,
    displayImage: reference.previewUrl || undefined,
    workflowImage: reference.filePath,
  };
  assertProductionV2BackgroundVisualReference(output);
  return output;
}

function h3Mode(method: StoryVideoMethod) {
  if (method === "image-to-video") return "h3-image-to-video" as const;
  if (method === "reference-to-video" || method === "video-edit") return "h3-reference-to-video" as const;
  return "h3-text-to-video" as const;
}

export function submitStoryVideoTake(input: {
  ownerKey: unknown;
  projectId: unknown;
  takeId: unknown;
  authorized: unknown;
}) {
  if (input.authorized !== true) throw new Error("Explicit video generation authorization is required.");
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const take = assertOwnedTake(ownerKey, projectId, required(input.takeId, "Take id"));
  if (take.generationJobId) {
    const existing = getProductionV2GenerationJob(take.generationJobId, ownerKey);
    if (existing) return { take: syncStoryVideoTakeFromJob({ ownerKey, projectId, takeId: take.id, job: existing }), job: existing, reused: true };
  }
  if (take.status !== "proposed") throw new Error("Only a proposed take can be submitted.");
  const loaded = loadPlanVersion(ownerKey, projectId, take.planVersion);
  if (loaded.status !== "approved") throw new Error("The take is not attached to an approved production-plan version.");
  findShot(loaded.plan, take.sceneId, take.shotId);

  const productionReferences = take.references.map(toProductionReference);
  const startImage = take.method === "image-to-video" ? productionReferences[0] : null;
  if (startImage) assertProductionV2H3StartingImage(startImage);
  const sourceTake = take.settings.sourceTakeId
    ? assertOwnedTake(ownerKey, projectId, take.settings.sourceTakeId)
    : null;
  const payload = {
    operation: take.method === "video-edit" ? "visual-edit" as const : "scene-generation" as const,
    finalPrompt: take.prompt,
    promptFingerprint: crypto.createHash("sha256").update(JSON.stringify({
      prompt: take.prompt,
      settings: take.settings,
      references: take.references.map((reference) => reference.versionId),
    })).digest("hex"),
    durationSeconds: take.settings.durationSeconds,
    h3Quality: take.settings.quality,
    orientation: take.settings.orientation,
    h3Settings: take.settings.h3Settings,
    rifeInterpolation60Fps: take.settings.rifeInterpolation60Fps,
    seed: take.settings.seed,
    startImage,
    references: take.method === "reference-to-video" ? productionReferences : [],
    voices: [],
    userLoras: take.settings.userLoras,
    ...(take.method === "video-edit" && sourceTake?.outputPath
      ? {
          videoReference: {
            mediaVersionId: sourceTake.id,
            mediaPath: sourceTake.outputPath,
            includeAudio: true,
            clipStartSeconds: take.settings.videoClipStartSeconds,
          },
        }
      : {}),
    storyBinding: {
      projectId,
      planVersion: take.planVersion,
      sceneId: take.sceneId,
      shotId: take.shotId,
      takeId: take.id,
    },
  };
  const job = createProductionV2GenerationJob({
    ownerKey,
    productionId: `story-${projectId}-v${take.planVersion}`,
    sceneId: take.shotId,
    mode: h3Mode(take.method),
    payload,
  });
  if (job.payload.storyBinding?.takeId !== take.id) {
    throw new Error("Another take for this shot is already active; duplicate submission was blocked.");
  }
  const now = Date.now();
  db().prepare(`
    UPDATE story_video_takes
    SET generation_job_id = ?, status = 'queued', updated_at = ?, error = NULL
    WHERE id = ? AND project_id = ? AND owner_key = ? AND status = 'proposed'
  `).run(job.id, now, take.id, projectId, ownerKey);
  return { take: assertOwnedTake(ownerKey, projectId, take.id), job, reused: false };
}

function mappedStatus(job: ProductionV2GenerationJob): StoryVideoTakeStatus {
  if (job.status === "pending" || job.status === "queued_waiting_for_gpu") return "queued";
  if (job.status === "claimed") return "claimed";
  if (job.status === "submitted" || job.status === "running") return "running";
  if (
    job.status === "postprocessing_waiting_for_gpu"
    || job.status === "postprocessing_submitted"
    || job.status === "postprocessing_running"
  ) return "postprocessing";
  if (job.status === "completed") return "completed";
  return job.status;
}

export function syncStoryVideoTakeFromJob(input: {
  ownerKey: string;
  projectId: string;
  takeId: string;
  job: ProductionV2GenerationJob;
}) {
  const take = assertOwnedTake(input.ownerKey, input.projectId, input.takeId);
  if (take.generationJobId && take.generationJobId !== input.job.id) {
    throw new Error("Generation job does not belong to this Story take.");
  }
  if (input.job.ownerKey !== input.ownerKey || input.job.payload.storyBinding?.takeId !== take.id) {
    throw new Error("Generation job ownership or Story binding does not match this take.");
  }
  let status = mappedStatus(input.job);
  if ((take.status === "accepted" || take.status === "rejected") && status === "completed") status = take.status;
  const now = Date.now();
  const completedAt = input.job.completedAt ? Date.parse(input.job.completedAt) : null;
  db().prepare(`
    UPDATE story_video_takes SET
      status = ?, backend = ?, workflow_id = ?, workflow_file = ?,
      resolution = CASE WHEN ? IS NOT NULL THEN '1920x1080' ELSE resolution END,
      output_path = ?, error = ?, completed_at = COALESCE(?, completed_at), updated_at = ?
    WHERE id = ? AND project_id = ? AND owner_key = ?
  `).run(
    status, input.job.backend, input.job.workflowId, input.job.workflowFile,
    input.job.outputPath, input.job.outputPath, input.job.error,
    Number.isFinite(completedAt) ? completedAt : null, now,
    take.id, input.projectId, input.ownerKey,
  );
  return assertOwnedTake(input.ownerKey, input.projectId, take.id);
}

export function listStoryVideoTakes(input: {
  ownerKey: unknown;
  projectId: unknown;
  planVersion?: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  assertOwnedProject(ownerKey, projectId);
  const planVersion = Number(input.planVersion || 0);
  const rows = db().prepare(`
    SELECT * FROM story_video_takes
    WHERE project_id = ? AND owner_key = ?
      AND (? = 0 OR plan_version = ?)
    ORDER BY plan_version DESC, scene_id, shot_id, take_number ASC
  `).all(projectId, ownerKey, planVersion, planVersion) as any[];
  return rows.map(rowToTake).map((take) => {
    if (!take.generationJobId || ["accepted", "rejected"].includes(take.status)) return take;
    const job = getProductionV2GenerationJob(take.generationJobId, ownerKey);
    return job ? syncStoryVideoTakeFromJob({ ownerKey, projectId, takeId: take.id, job }) : take;
  });
}

export function setStoryVideoTakeDecision(input: {
  ownerKey: unknown;
  projectId: unknown;
  takeId: unknown;
  decision: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const take = assertOwnedTake(ownerKey, projectId, required(input.takeId, "Take id"));
  const decision = input.decision === "reject" ? "rejected" : "accepted";
  if (!["completed", "accepted", "rejected"].includes(take.status)) {
    throw new Error("Only a completed take can be accepted or rejected.");
  }
  const now = Date.now();
  const write = db().transaction(() => {
    if (decision === "accepted") {
      db().prepare(`
        UPDATE story_video_takes SET status = 'completed', accepted_at = NULL, updated_at = ?
        WHERE project_id = ? AND owner_key = ? AND plan_version = ? AND scene_id = ? AND shot_id = ?
          AND status = 'accepted' AND id != ?
      `).run(now, projectId, ownerKey, take.planVersion, take.sceneId, take.shotId, take.id);
    }
    db().prepare(`
      UPDATE story_video_takes SET status = ?, accepted_at = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND owner_key = ?
    `).run(decision, decision === "accepted" ? now : null, now, take.id, projectId, ownerKey);
  });
  write();
  return assertOwnedTake(ownerKey, projectId, take.id);
}

export function prepareStoryVideoRetry(input: {
  ownerKey: unknown;
  projectId: unknown;
  takeId: unknown;
  motion?: unknown;
  promoteSceneHunter?: unknown;
  idempotencyKey?: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const source = assertOwnedTake(ownerKey, projectId, required(input.takeId, "Take id"));
  if (!["completed", "accepted", "rejected", "failed", "canceled"].includes(source.status)) {
    throw new Error("Wait for the current take to finish before preparing another version.");
  }
  const promote = input.promoteSceneHunter === true;
  if (promote && source.settings.quality !== "sh") {
    throw new Error("Only a Scene Hunter take can be promoted to HQ.");
  }
  const idempotencyKey = clean(input.idempotencyKey, 240) || `retry-${randomUUID()}`;
  const existing = db().prepare(`
    SELECT * FROM story_video_takes WHERE owner_key = ? AND idempotency_key = ? LIMIT 1
  `).get(ownerKey, idempotencyKey) as any;
  if (existing) {
    return {
      context: getStoryVideoShotContext({ ownerKey, projectId, planVersion: source.planVersion, sceneId: source.sceneId, shotId: source.shotId }),
      take: rowToTake(existing),
      requiresExplicitConfirmation: true,
    };
  }
  const revision = clean(input.motion, 4_000);
  const prompt = promote || !revision || revision === source.prompt
    ? source.prompt
    : `${source.prompt}\nRevision: ${revision}`.slice(0, 8_000);
  const settings: StoryVideoSettingsSnapshot = {
    ...source.settings,
    quality: promote ? "hq" : source.settings.quality,
    seed: promote ? source.settings.seed : randomSeed(),
  };
  const takeNumber = Number((db().prepare(`
    SELECT COALESCE(MAX(take_number), 0) AS value FROM story_video_takes
    WHERE project_id = ? AND owner_key = ? AND plan_version = ? AND scene_id = ? AND shot_id = ?
  `).get(projectId, ownerKey, source.planVersion, source.sceneId, source.shotId) as any)?.value || 0) + 1;
  const id = randomUUID();
  const now = Date.now();
  db().prepare(`
    INSERT INTO story_video_takes (
      id, project_id, owner_key, plan_version, scene_id, shot_id, take_number,
      status, method, generation_job_id, idempotency_key, parent_take_id,
      prompt, settings_json, references_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, ownerKey, source.planVersion, source.sceneId, source.shotId,
    takeNumber, source.method, idempotencyKey, source.id, prompt,
    JSON.stringify(settings), JSON.stringify(source.references), now, now,
  );
  return {
    context: getStoryVideoShotContext({ ownerKey, projectId, planVersion: source.planVersion, sceneId: source.sceneId, shotId: source.shotId }),
    take: assertOwnedTake(ownerKey, projectId, id),
    requiresExplicitConfirmation: true,
  };
}

export function cancelQueuedStoryVideoTake(input: {
  ownerKey: unknown;
  projectId: unknown;
  takeId: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const take = assertOwnedTake(ownerKey, projectId, required(input.takeId, "Take id"));
  if (take.status === "proposed") {
    db().prepare(`UPDATE story_video_takes SET status = 'canceled', updated_at = ? WHERE id = ?`).run(Date.now(), take.id);
    return assertOwnedTake(ownerKey, projectId, take.id);
  }
  if (!take.generationJobId) throw new Error("This take has no generation job to cancel.");
  const job = getProductionV2GenerationJob(take.generationJobId, ownerKey);
  if (!job) throw new Error("The linked generation job was not found.");
  if (!["pending", "queued_waiting_for_gpu", "claimed"].includes(job.status) || job.comfyPromptId) {
    throw new Error("This job has already reached ComfyUI. Safe cancellation cannot interrupt an unrelated running GPU job.");
  }
  const canceled = cancelProductionV2GenerationJob(job.id, "Canceled before ComfyUI submission");
  if (!canceled) throw new Error("The queued generation job could not be canceled.");
  return syncStoryVideoTakeFromJob({ ownerKey, projectId, takeId: take.id, job: canceled });
}

export function prepareStoryVideoBatch(input: {
  ownerKey: unknown;
  projectId: unknown;
  sceneIds?: unknown;
  maxJobs?: unknown;
  defaults?: Record<string, unknown>;
  idempotencyKey?: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const record = currentApprovedPlan(ownerKey, projectId);
  const requestedScenes = Array.isArray(input.sceneIds)
    ? new Set(input.sceneIds.map((value) => clean(value, 160)).filter(Boolean))
    : null;
  const scenes = record.plan.acts.flatMap((act) => act.scenes)
    .filter((scene) => !requestedScenes || requestedScenes.has(scene.id));
  if (!scenes.length) throw new Error("Select at least one approved scene for production.");
  const maxJobs = Math.max(1, Math.min(32, Number(input.maxJobs || 8) || 8));
  const idempotencyKey = clean(input.idempotencyKey, 240) || `batch-${randomUUID()}`;
  const existing = db().prepare(`SELECT * FROM story_video_batches WHERE owner_key = ? AND idempotency_key = ? LIMIT 1`)
    .get(ownerKey, idempotencyKey) as any;
  if (existing) return { batch: rowToBatch(existing), takes: rowToBatch(existing).takeIds.map((id) => assertOwnedTake(ownerKey, projectId, id)), jobsStarted: 0 };

  const takeIds: string[] = [];
  const shotIds: string[] = [];
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      const prepared = prepareStoryVideoTake({
        ownerKey, projectId, planVersion: record.version,
        sceneId: scene.id, shotId: shot.id,
        ...(input.defaults || {}),
        idempotencyKey: `${idempotencyKey}:${shot.id}`,
      });
      takeIds.push(prepared.take.id);
      shotIds.push(shot.id);
    }
  }
  const id = randomUUID();
  const now = Date.now();
  db().prepare(`
    INSERT INTO story_video_batches (
      id, project_id, owner_key, plan_version, status, scene_ids_json,
      shot_ids_json, take_ids_json, max_jobs, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, ownerKey, record.version, JSON.stringify(scenes.map((scene) => scene.id)),
    JSON.stringify(shotIds), JSON.stringify(takeIds), maxJobs, idempotencyKey, now, now);
  return { batch: getStoryVideoBatch({ ownerKey, projectId, batchId: id }), takes: takeIds.map((takeId) => assertOwnedTake(ownerKey, projectId, takeId)), jobsStarted: 0 };
}

export function getStoryVideoBatch(input: { ownerKey: unknown; projectId: unknown; batchId: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const row = db().prepare(`
    SELECT * FROM story_video_batches WHERE id = ? AND project_id = ? AND owner_key = ? LIMIT 1
  `).get(required(input.batchId, "Batch id"), projectId, ownerKey) as any;
  if (!row) throw new Error("Story video batch was not found.");
  return rowToBatch(row);
}

export function listStoryVideoBatches(input: { ownerKey: unknown; projectId: unknown; planVersion?: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  assertOwnedProject(ownerKey, projectId);
  const planVersion = Number(input.planVersion || 0);
  return (db().prepare(`
    SELECT * FROM story_video_batches WHERE project_id = ? AND owner_key = ?
      AND (? = 0 OR plan_version = ?) ORDER BY created_at DESC
  `).all(projectId, ownerKey, planVersion, planVersion) as any[]).map(rowToBatch);
}

export function approveStoryVideoBatch(input: {
  ownerKey: unknown;
  projectId: unknown;
  batchId: unknown;
  authorized: unknown;
  maxJobs?: unknown;
}) {
  if (input.authorized !== true) throw new Error("Explicit batch generation authorization is required.");
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const batch = getStoryVideoBatch({ ownerKey, projectId, batchId: input.batchId });
  const limit = Math.max(1, Math.min(batch.maxJobs, Number(input.maxJobs || batch.maxJobs) || batch.maxJobs));
  const submitted: StoryVideoTake[] = [];
  const failures: Array<{ takeId: string; error: string }> = [];
  for (const takeId of batch.takeIds.slice(0, limit)) {
    try {
      submitted.push(submitStoryVideoTake({ ownerKey, projectId, takeId, authorized: true }).take);
    } catch (error) {
      failures.push({ takeId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const now = Date.now();
  const status = failures.length ? "partial" : "queued";
  db().prepare(`
    UPDATE story_video_batches SET status = ?, approved_at = COALESCE(approved_at, ?), updated_at = ?
    WHERE id = ? AND project_id = ? AND owner_key = ?
  `).run(status, now, now, batch.id, projectId, ownerKey);
  return { batch: getStoryVideoBatch({ ownerKey, projectId, batchId: batch.id }), submitted, failures };
}

export function storyVideoProductionSnapshot(input: {
  ownerKey: unknown;
  projectId: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const record = getStoryProductionPlan({ ownerKey, projectId });
  return {
    plan: record,
    takes: listStoryVideoTakes({ ownerKey, projectId, planVersion: record?.version }),
    batches: listStoryVideoBatches({ ownerKey, projectId, planVersion: record?.version }),
    generationStarted: false,
  };
}

export function resolveStoryVideoDirectorAction(input: {
  ownerKey: unknown;
  projectId: unknown;
  instruction: unknown;
  sceneId?: unknown;
  shotId?: unknown;
  idempotencyKey?: unknown;
}) {
  const ownerKey = required(input.ownerKey, "Story owner");
  const projectId = required(input.projectId, "Story project id");
  const instruction = required(input.instruction, "Video direction", 4_000);
  const lower = instruction.toLowerCase();
  const record = currentApprovedPlan(ownerKey, projectId);
  const scenes = record.plan.acts.flatMap((act) => act.scenes);
  const sceneNumber = lower.match(/scene\s+(\d+)/)?.[1];
  const shotNumber = lower.match(/shot\s+(\d+)/)?.[1];
  let scene = scenes.find((item) => item.id === clean(input.sceneId, 160))
    || scenes.find((item) => item.sceneNumber === sceneNumber)
    || scenes[0];
  let shot = scene?.shots.find((item) => item.id === clean(input.shotId, 160))
    || scene?.shots.find((item) => item.shotNumber === shotNumber)
    || scene?.shots[0];

  if (lower.includes("next approved shot") || lower.includes("continue producing")) {
    const accepted = new Set(
      listStoryVideoTakes({ ownerKey, projectId, planVersion: record.version })
        .filter((take) => take.status === "accepted")
        .map((take) => `${take.sceneId}:${take.shotId}`),
    );
    const next = scenes.flatMap((item) => item.shots.map((candidate) => ({ scene: item, shot: candidate })))
      .find((candidate) => !accepted.has(`${candidate.scene.id}:${candidate.shot.id}`));
    if (next) ({ scene, shot } = next);
  }

  if (!scene || !shot) throw new Error("The approved plan does not contain a matching shot.");
  if (lower.includes("show all takes")) {
    return {
      intent: "show-takes",
      sceneId: scene.id,
      shotId: shot.id,
      takes: listStoryVideoTakes({ ownerKey, projectId, planVersion: record.version })
        .filter((take) => take.sceneId === scene!.id && take.shotId === shot!.id),
      requiresExplicitConfirmation: false,
    };
  }
  if (lower.includes("prepare every shot") || lower.includes("prepare scene for production")) {
    const prepared = prepareStoryVideoBatch({
      ownerKey,
      projectId,
      sceneIds: [scene.id],
      maxJobs: scene.shots.length,
      idempotencyKey: input.idempotencyKey,
      defaults: {
        quality: lower.includes("scene hunter") ? "sh" : "lq",
      },
    });
    return {
      intent: "prepare-batch",
      sceneId: scene.id,
      batch: prepared.batch,
      takes: prepared.takes,
      jobsStarted: 0,
      requiresExplicitConfirmation: true,
    };
  }

  const context = getStoryVideoShotContext({
    ownerKey,
    projectId,
    planVersion: record.version,
    sceneId: scene.id,
    shotId: shot.id,
  });
  const namedReferences = context.availableReferences.filter((reference) =>
    lower.includes(reference.name.toLowerCase()),
  );
  const method: StoryVideoMethod = lower.includes("scene hunter")
    ? context.recommendedMethod
    : lower.includes("reference") || namedReferences.length
      ? "reference-to-video"
      : lower.includes("image") || lower.includes("storyboard")
        ? "image-to-video"
        : context.recommendedMethod;
  const references = namedReferences.length
    ? namedReferences
    : method === "image-to-video"
      ? context.availableReferences.filter(isShotImage).slice(0, 1)
      : method === "reference-to-video"
        ? context.availableReferences
        : [];
  const prepared = prepareStoryVideoTake({
    ownerKey,
    projectId,
    planVersion: record.version,
    sceneId: scene.id,
    shotId: shot.id,
    method,
    motion: instruction,
    durationSeconds: /ten[- ]second|10[- ]second/.test(lower) ? 10 : /five[- ]second|5[- ]second/.test(lower) ? 5 : shot.requestedDurationSeconds,
    quality: lower.includes("scene hunter") ? "sh" : lower.includes("hq") ? "hq" : "lq",
    referenceVersionIds: references.map((reference) => reference.versionId),
    idempotencyKey: input.idempotencyKey,
  });
  return {
    intent: "prepare-take",
    sceneId: scene.id,
    shotId: shot.id,
    take: prepared.take,
    context,
    jobsStarted: 0,
    requiresExplicitConfirmation: true,
  };
}
