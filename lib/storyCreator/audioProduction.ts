import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { loadVoicesLibrary } from "@/lib/voicesStudio";
import {
  getStoryVisualVersion,
  getStoryProductionPlan,
  listStoryBibleEntities,
  listStoryVisualAssets,
} from "@/lib/storyCreator/store";
import { listStoryVideoTakes } from "@/lib/storyCreator/videoProduction";
import type {
  StoryAudioAsset,
  StoryAudioBatch,
  StoryAudioKind,
  StoryAudioProviderContract,
  StoryAudioShotContext,
  StoryAudioStatus,
  StoryVoiceAssignment,
} from "@/lib/storyCreator/audioProductionTypes";

let connection: Database.Database | null = null;
let connectionPath = "";
let storePathOverrideForTests: string | null = null;

function databasePath() {
  if (storePathOverrideForTests) return storePathOverrideForTests;
  const configured = String(process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || "").trim();
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

export function setStoryAudioProductionStorePathForTests(value: string | null) {
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
    CREATE TABLE IF NOT EXISTS story_voice_assignments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      character_key TEXT NOT NULL,
      character_name TEXT NOT NULL,
      entity_id TEXT,
      voice_id TEXT NOT NULL,
      voice_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'default',
      speaking_style TEXT NOT NULL DEFAULT '',
      stability REAL NOT NULL DEFAULT 0.7,
      authorized_reference INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, owner_key, character_key, variant)
    );
    CREATE INDEX IF NOT EXISTS idx_story_voice_assignments_project
      ON story_voice_assignments(project_id, owner_key, character_name);

    CREATE TABLE IF NOT EXISTS story_audio_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      plan_version INTEGER NOT NULL,
      scene_id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      video_take_id TEXT,
      derived_video_take_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN (
        'dialogue', 'narration', 'music', 'sound-effect', 'ambience',
        'mix', 'enhancement', 'lip-sync'
      )),
      status TEXT NOT NULL CHECK(status IN (
        'prepared', 'queued', 'running', 'completed', 'accepted',
        'rejected', 'failed', 'canceled'
      )),
      version INTEGER NOT NULL,
      parent_asset_id TEXT,
      speaker_key TEXT,
      speaker_name TEXT,
      character_entity_id TEXT,
      voice_assignment_id TEXT,
      exact_text TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      emotion TEXT NOT NULL DEFAULT '',
      delivery TEXT NOT NULL DEFAULT '',
      start_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL,
      shot_duration_seconds REAL NOT NULL,
      timing_conflict INTEGER NOT NULL DEFAULT 0,
      keep_original_audio INTEGER NOT NULL DEFAULT 1,
      provider_contract_json TEXT NOT NULL,
      source_asset_ids_json TEXT NOT NULL DEFAULT '[]',
      source_paths_json TEXT NOT NULL DEFAULT '[]',
      output_path TEXT,
      job_id TEXT,
      external_job_id TEXT,
      idempotency_key TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      authorized_at INTEGER,
      completed_at INTEGER,
      accepted_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_asset_id) REFERENCES story_audio_assets(id) ON DELETE SET NULL,
      FOREIGN KEY (voice_assignment_id) REFERENCES story_voice_assignments(id) ON DELETE SET NULL,
      UNIQUE(project_id, owner_key, plan_version, scene_id, shot_id, kind, version),
      UNIQUE(owner_key, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_audio_assets_shot
      ON story_audio_assets(project_id, owner_key, plan_version, scene_id, shot_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_story_audio_assets_job
      ON story_audio_assets(owner_key, job_id);

    CREATE TABLE IF NOT EXISTS story_audio_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      plan_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('prepared', 'queued', 'partial', 'completed', 'canceled')),
      scene_ids_json TEXT NOT NULL DEFAULT '[]',
      shot_ids_json TEXT NOT NULL DEFAULT '[]',
      asset_ids_json TEXT NOT NULL DEFAULT '[]',
      max_jobs INTEGER NOT NULL,
      workload_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      authorized_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      UNIQUE(owner_key, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_audio_batches_project
      ON story_audio_batches(project_id, owner_key, plan_version, created_at DESC);
  `);
  const assetColumns = next.prepare(`PRAGMA table_info(story_audio_assets)`).all() as Array<{ name: string }>;
  if (!assetColumns.some((column) => column.name === "external_job_id")) {
    next.exec(`ALTER TABLE story_audio_assets ADD COLUMN external_job_id TEXT`);
  }
  connection = next;
  connectionPath = filePath;
  return next;
}

function clean(value: unknown, max = 20_000) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function required(value: unknown, label: string, max = 240) {
  const result = clean(value, max);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function key(value: unknown) {
  return clean(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function number(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function json<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

function assertProject(ownerKeyValue: unknown, projectIdValue: unknown) {
  const ownerKey = required(ownerKeyValue, "ownerKey");
  const projectId = required(projectIdValue, "projectId");
  const plan = getStoryProductionPlan({ ownerKey, projectId });
  if (!plan) throw new Error("An approved or saved production plan is required.");
  return { ownerKey, projectId, plan };
}

function locateShot(ownerKey: string, projectId: string, sceneIdValue: unknown, shotIdValue: unknown) {
  const record = getStoryProductionPlan({ ownerKey, projectId });
  if (!record) throw new Error("Production plan not found.");
  const sceneId = required(sceneIdValue, "sceneId");
  const shotId = required(shotIdValue, "shotId");
  const scenes = record.plan.acts.flatMap((act) => act.scenes);
  const scene = scenes.find((item) => item.id === sceneId);
  const shot = scene?.shots.find((item) => item.id === shotId);
  if (!scene || !shot) throw new Error("Scene or shot not found in the current production plan.");
  return { record, scene, shot };
}

function rowToAssignment(row: any): StoryVoiceAssignment {
  return {
    id: String(row.id), projectId: String(row.project_id), characterKey: String(row.character_key),
    characterName: String(row.character_name), entityId: row.entity_id ? String(row.entity_id) : null,
    voiceId: String(row.voice_id), voiceName: String(row.voice_name), provider: String(row.provider),
    variant: String(row.variant), speakingStyle: String(row.speaking_style), stability: Number(row.stability),
    authorizedReference: Boolean(row.authorized_reference), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function rowToAsset(row: any): StoryAudioAsset {
  return {
    id: String(row.id), projectId: String(row.project_id), planVersion: Number(row.plan_version),
    sceneId: String(row.scene_id), shotId: String(row.shot_id),
    videoTakeId: row.video_take_id ? String(row.video_take_id) : null,
    derivedVideoTakeId: row.derived_video_take_id ? String(row.derived_video_take_id) : null,
    kind: String(row.kind) as StoryAudioKind, status: String(row.status) as StoryAudioStatus,
    version: Number(row.version), parentAssetId: row.parent_asset_id ? String(row.parent_asset_id) : null,
    speakerKey: row.speaker_key ? String(row.speaker_key) : null,
    speakerName: row.speaker_name ? String(row.speaker_name) : null,
    characterEntityId: row.character_entity_id ? String(row.character_entity_id) : null,
    voiceAssignmentId: row.voice_assignment_id ? String(row.voice_assignment_id) : null,
    exactText: String(row.exact_text), prompt: String(row.prompt), emotion: String(row.emotion),
    delivery: String(row.delivery), startSeconds: Number(row.start_seconds),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    shotDurationSeconds: Number(row.shot_duration_seconds), timingConflict: Boolean(row.timing_conflict),
    keepOriginalAudio: Boolean(row.keep_original_audio),
    providerContract: json<StoryAudioProviderContract>(row.provider_contract_json, providerContract("dialogue", {})),
    sourceAssetIds: json<string[]>(row.source_asset_ids_json, []), sourcePaths: json<string[]>(row.source_paths_json, []),
    outputPath: row.output_path ? String(row.output_path) : null, jobId: row.job_id ? String(row.job_id) : null,
    externalJobId: row.external_job_id ? String(row.external_job_id) : null,
    idempotencyKey: String(row.idempotency_key), error: row.error ? String(row.error) : null,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    authorizedAt: row.authorized_at == null ? null : Number(row.authorized_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
  };
}

function rowToBatch(row: any): StoryAudioBatch {
  return {
    id: String(row.id), projectId: String(row.project_id), planVersion: Number(row.plan_version), status: row.status,
    sceneIds: json<string[]>(row.scene_ids_json, []), shotIds: json<string[]>(row.shot_ids_json, []),
    assetIds: json<string[]>(row.asset_ids_json, []), maxJobs: Number(row.max_jobs),
    workload: json<Record<string, number>>(row.workload_json, {}), idempotencyKey: String(row.idempotency_key),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    authorizedAt: row.authorized_at == null ? null : Number(row.authorized_at),
  };
}

function providerContract(kind: StoryAudioKind, input: Record<string, unknown>): StoryAudioProviderContract {
  if (kind === "dialogue" || kind === "narration") {
    return {
      provider: clean(input.provider, 80) || "indextts2", operation: "text-to-speech",
      endpoint: "/api/voice/tts", method: "POST", contentType: "multipart/form-data",
      model: clean(input.model, 160) || null, workflowId: null, workflowFile: null,
      request: { text: clean(input.exactText, 12_000), voiceId: clean(input.voiceId, 160), emotion: clean(input.emotion, 80), delivery: clean(input.delivery, 500), speed: number(input.speed, 1, 0.5, 2) },
      capabilityStatus: "verified-route",
      limitations: ["Exact voice availability is validated again at execution time.", "Audio duration is measured from the completed file, not guessed from text."],
    };
  }
  if (kind === "music") {
    return {
      provider: "ace-step-1.5", operation: "generate-music", endpoint: "/api/production/background-audio/ace-generate",
      method: "POST", contentType: "application/json", model: "ACE-Step 1.5", workflowId: null, workflowFile: null,
      request: { prompt: clean(input.prompt), durationSeconds: number(input.durationSeconds, 30, 10, 600), bpm: clean(input.bpm, 20), keyScale: clean(input.keyScale, 40), lyrics: clean(input.lyrics, 12_000) },
      capabilityStatus: "verified-runtime", limitations: ["Music is generated only after explicit authorization."],
    };
  }
  if (kind === "sound-effect" || kind === "ambience") {
    return {
      provider: "sony-woosh", operation: kind === "ambience" ? "generate-ambience" : "generate-sound-effect",
      endpoint: "/api/edit-video/woosh-sfx", method: "POST", contentType: "multipart/form-data",
      model: "Sony Woosh", workflowId: "woosh-v2", workflowFile: null,
      request: { prompt: clean(input.prompt), durationSeconds: number(input.durationSeconds, 5, 0.5, 60), startSeconds: number(input.startSeconds, 0, 0, 43_200) },
      capabilityStatus: "verified-route", limitations: ["Woosh runtime execution remains subject to the configured Comfy backend and model inventory."],
    };
  }
  if (kind === "mix" || kind === "enhancement") {
    return {
      provider: "ffmpeg", operation: kind === "mix" ? "non-destructive-audio-mix" : "dialogue-enhancement",
      endpoint: kind === "mix" ? "/api/edit-video/audio-mix" : "/api/edit-video/enhance-audio",
      method: "POST", contentType: "application/json", model: null, workflowId: null, workflowFile: null,
      request: { sourceAssetIds: input.sourceAssetIds || [], keepOriginalAudio: input.keepOriginalAudio !== false },
      capabilityStatus: "verified-route",
      limitations: kind === "enhancement" ? ["Current enhancement is ffmpeg loudness, resampling, and filtering; it is not a neural studio-restoration model."] : ["Source separation is not included; removing dialogue while perfectly preserving background is unsupported."],
    };
  }
  return {
    provider: "ltx-2.3", operation: "image-audio-to-derived-video", endpoint: "/api/comfy",
    method: "POST", contentType: "multipart/form-data", model: "LTX 2.3",
    workflowId: "production-lipsync-image-to-video", workflowFile: "production-lipsync.json",
    request: { visualVersionId: clean(input.visualVersionId, 160), audioAssetId: clean(input.audioAssetId, 160), prompt: clean(input.prompt), durationSeconds: number(input.durationSeconds, 5, 1, 20), sourceVideoTakeId: clean(input.videoTakeId, 160) },
    capabilityStatus: "limited",
    limitations: ["Installed workflow generates a new image-plus-audio video; it does not edit the accepted H3 video in place.", "The accepted source video is preserved and linked as lineage, not used as the model video input."],
  };
}

export function listStoryVoiceAssignments(input: { ownerKey: unknown; projectId: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  return db().prepare(`SELECT * FROM story_voice_assignments WHERE project_id = ? AND owner_key = ? ORDER BY character_name, variant`).all(projectId, ownerKey).map(rowToAssignment);
}

export function saveStoryVoiceAssignment(input: {
  ownerKey: unknown; projectId: unknown; characterName: unknown; entityId?: unknown;
  voiceId: unknown; variant?: unknown; speakingStyle?: unknown; stability?: unknown; authorizedReference?: unknown;
}) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const characterName = required(input.characterName, "characterName", 160);
  const characterKey = key(characterName);
  const variant = clean(input.variant, 80) || "default";
  const voiceId = required(input.voiceId, "voiceId", 160);
  const voice = loadVoicesLibrary(ownerKey).voices.find((item) => item.voiceId === voiceId);
  if (!voice) throw new Error("Selected voice does not belong to this user.");
  const entities = listStoryBibleEntities({ ownerKey, projectId });
  const entityId = clean(input.entityId, 160) || entities.find((item) => key(item.name) === characterKey)?.id || null;
  const now = Date.now();
  const existing = db().prepare(`SELECT * FROM story_voice_assignments WHERE project_id = ? AND owner_key = ? AND character_key = ? AND variant = ?`).get(projectId, ownerKey, characterKey, variant) as any;
  const id = existing?.id || randomUUID();
  db().prepare(`INSERT INTO story_voice_assignments (
    id, project_id, owner_key, character_key, character_name, entity_id, voice_id, voice_name, provider,
    variant, speaking_style, stability, authorized_reference, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(project_id, owner_key, character_key, variant) DO UPDATE SET
    character_name=excluded.character_name, entity_id=excluded.entity_id, voice_id=excluded.voice_id,
    voice_name=excluded.voice_name, provider=excluded.provider, speaking_style=excluded.speaking_style,
    stability=excluded.stability, authorized_reference=excluded.authorized_reference, updated_at=excluded.updated_at`).run(
      id, projectId, ownerKey, characterKey, characterName, entityId, voiceId, voice.name,
      voice.type || "voice-library", variant, clean(input.speakingStyle, 500), number(input.stability, 0.7, 0, 1),
      input.authorizedReference === true ? 1 : 0, existing?.created_at || now, now,
    );
  return rowToAssignment(db().prepare(`SELECT * FROM story_voice_assignments WHERE id = ?`).get(id));
}

export function getStoryAudioShotContext(input: { ownerKey: unknown; projectId: unknown; sceneId: unknown; shotId: unknown }): StoryAudioShotContext {
  const ownerKey = required(input.ownerKey, "ownerKey");
  const projectId = required(input.projectId, "projectId");
  const { record, scene, shot } = locateShot(ownerKey, projectId, input.sceneId, input.shotId);
  const assignments = listStoryVoiceAssignments({ ownerKey, projectId });
  const acceptedTakes = listStoryVideoTakes({ ownerKey, projectId, planVersion: record.version })
    .filter((take) => take.sceneId === scene.id && take.shotId === shot.id && take.status === "accepted");
  return {
    projectId, planVersion: record.version,
    scene: { id: scene.id, number: scene.sceneNumber, title: scene.title, characters: scene.characters, location: scene.location, timeOfDay: scene.timeOfDay, emotionalTone: scene.emotionalTone },
    shot: { id: shot.id, number: shot.shotNumber, description: shot.description, screenplayExcerpt: shot.screenplayExcerpt, durationSeconds: shot.requestedDurationSeconds, dialogue: shot.dialogue.length ? shot.dialogue : scene.dialogue },
    voiceAssignments: assignments,
    acceptedVideoTakeIds: acceptedTakes.map((take) => take.id),
    capabilities: {
      dialogue: "Existing authenticated TTS and trained Applio voice routes",
      voiceConversion: "Applio inference worker is configured; Seed-VC is optional only when its runtime is present",
      music: "ACE-Step 1.5 local API",
      soundEffects: "Sony Woosh route and Comfy workflow",
      mixing: "Non-destructive ffmpeg overlay/replacement contracts",
      enhancement: "ffmpeg loudness, resampling, high-pass, and low-pass processing",
      lipSync: "LTX 2.3 image-plus-audio derived-video workflow",
    },
    limitations: ["No verified source-separation workflow was found.", "LTX 2.3 does not modify an accepted H3 video in place.", "Completed audio duration must be measured before timing can be approved."],
  };
}

export function listStoryAudioAssets(input: { ownerKey: unknown; projectId: unknown; planVersion?: unknown; sceneId?: unknown; shotId?: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const clauses = ["project_id = ?", "owner_key = ?"];
  const values: unknown[] = [projectId, ownerKey];
  if (Number.isFinite(Number(input.planVersion))) { clauses.push("plan_version = ?"); values.push(Number(input.planVersion)); }
  if (clean(input.sceneId)) { clauses.push("scene_id = ?"); values.push(clean(input.sceneId)); }
  if (clean(input.shotId)) { clauses.push("shot_id = ?"); values.push(clean(input.shotId)); }
  return db().prepare(`SELECT * FROM story_audio_assets WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`).all(...values).map(rowToAsset);
}

export function getStoryAudioAsset(input: { ownerKey: unknown; projectId: unknown; assetId: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const assetId = required(input.assetId, "assetId");
  const row = db().prepare(`SELECT * FROM story_audio_assets WHERE id=? AND project_id=? AND owner_key=?`).get(assetId, projectId, ownerKey);
  if (!row) throw new Error("Audio asset not found.");
  return rowToAsset(row);
}

export function claimStoryAudioAssetExecution(input: { ownerKey: unknown; projectId: unknown; assetId: unknown }) {
  const asset = getStoryAudioAsset(input);
  if (asset.status === "running") return { asset, claimed: false };
  if (asset.status !== "queued") return { asset, claimed: false };
  const now = Date.now();
  const result = db().prepare(`UPDATE story_audio_assets SET status='running', updated_at=? WHERE id=? AND project_id=? AND owner_key=? AND status='queued'`).run(now, asset.id, asset.projectId, required(input.ownerKey, "ownerKey"));
  return { asset: getStoryAudioAsset(input), claimed: result.changes === 1 };
}

export function prepareStoryAudioAsset(input: {
  ownerKey: unknown; projectId: unknown; planVersion?: unknown; sceneId: unknown; shotId: unknown;
  kind: unknown; speakerName?: unknown; exactText?: unknown; prompt?: unknown; emotion?: unknown; delivery?: unknown;
  startSeconds?: unknown; durationSeconds?: unknown; voiceAssignmentId?: unknown; videoTakeId?: unknown;
  sourceAssetIds?: unknown; sourcePaths?: unknown; keepOriginalAudio?: unknown; idempotencyKey: unknown;
  provider?: unknown; model?: unknown; speed?: unknown; bpm?: unknown; keyScale?: unknown; lyrics?: unknown;
  visualVersionId?: unknown; sourceAudioAssetId?: unknown; parentAssetId?: unknown;
}) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const { record, scene, shot } = locateShot(ownerKey, projectId, input.sceneId, input.shotId);
  const planVersion = Number(input.planVersion || record.version);
  if (planVersion !== record.version) throw new Error("Audio must be prepared against the current production-plan version.");
  const kinds: StoryAudioKind[] = ["dialogue", "narration", "music", "sound-effect", "ambience", "mix", "enhancement", "lip-sync"];
  const kind = clean(input.kind) as StoryAudioKind;
  if (!kinds.includes(kind)) throw new Error("Unsupported audio operation.");
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey", 200);
  const existing = db().prepare(`SELECT * FROM story_audio_assets WHERE owner_key = ? AND idempotency_key = ?`).get(ownerKey, idempotencyKey);
  if (existing) return rowToAsset(existing);
  const speakerName = clean(input.speakerName, 160) || null;
  const exactText = clean(input.exactText, 12_000);
  if ((kind === "dialogue" || kind === "narration") && !exactText) throw new Error("Approved dialogue text is required.");
  const assignments = listStoryVoiceAssignments({ ownerKey, projectId });
  const assignment = clean(input.voiceAssignmentId)
    ? assignments.find((item) => item.id === clean(input.voiceAssignmentId))
    : assignments.find((item) => item.characterKey === key(speakerName));
  if ((kind === "dialogue" || kind === "narration") && !assignment) throw new Error("Assign an authorized character voice before preparing speech.");
  if (assignment && !assignment.authorizedReference) throw new Error("The selected voice reference has not been marked as authorized.");
  const sourceAssetIds = Array.isArray(input.sourceAssetIds) ? input.sourceAssetIds.map((item) => clean(item, 160)).filter(Boolean).slice(0, 30) : [];
  const sourcePaths = Array.isArray(input.sourcePaths) ? input.sourcePaths.map((item) => clean(item, 2_000)).filter(Boolean).slice(0, 30) : [];
  const visualVersionId = clean(input.visualVersionId, 160);
  const sourceAudioAssetId = clean(input.sourceAudioAssetId, 160);
  if (kind === "lip-sync") {
    if (!visualVersionId || !sourceAudioAssetId) throw new Error("Audio-driven video requires an approved source image and completed dialogue audio.");
    const visual = getStoryVisualVersion({ ownerKey, projectId, versionId: visualVersionId });
    if (visual.status !== "approved" || !visual.filePath) throw new Error("The selected visual reference must be approved.");
    const sourceAudio = getStoryAudioAsset({ ownerKey, projectId, assetId: sourceAudioAssetId });
    if (!["completed", "accepted", "rejected"].includes(sourceAudio.status) || !sourceAudio.outputPath) {
      throw new Error("The selected dialogue audio must be completed.");
    }
    sourceAssetIds.unshift(sourceAudio.id);
  }
  const versionRow = db().prepare(`SELECT COALESCE(MAX(version), 0) AS value FROM story_audio_assets WHERE project_id = ? AND owner_key = ? AND plan_version = ? AND scene_id = ? AND shot_id = ? AND kind = ?`).get(projectId, ownerKey, planVersion, scene.id, shot.id, kind) as any;
  const estimatedDuration = input.durationSeconds == null || input.durationSeconds === "" ? null : number(input.durationSeconds, 0, 0, 43_200);
  const startSeconds = number(input.startSeconds, 0, 0, 43_200);
  const timingConflict = estimatedDuration != null && startSeconds + estimatedDuration > shot.requestedDurationSeconds;
  const contract = providerContract(kind, {
    ...input, exactText, voiceId: assignment?.voiceId || "", durationSeconds: estimatedDuration || shot.requestedDurationSeconds,
    startSeconds, videoTakeId: clean(input.videoTakeId), sourceAssetIds,
    visualVersionId, audioAssetId: sourceAudioAssetId,
  });
  const id = randomUUID();
  const now = Date.now();
  db().prepare(`INSERT INTO story_audio_assets (
    id, project_id, owner_key, plan_version, scene_id, shot_id, video_take_id, derived_video_take_id,
    kind, status, version, parent_asset_id, speaker_key, speaker_name, character_entity_id, voice_assignment_id,
    exact_text, prompt, emotion, delivery, start_seconds, duration_seconds, shot_duration_seconds, timing_conflict,
    keep_original_audio, provider_contract_json, source_asset_ids_json, source_paths_json, output_path, job_id,
    idempotency_key, error, created_at, updated_at, authorized_at, completed_at, accepted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, NULL, NULL)`).run(
      id, projectId, ownerKey, planVersion, scene.id, shot.id, clean(input.videoTakeId) || null,
      kind, Number(versionRow?.value || 0) + 1, clean(input.parentAssetId) || null,
      speakerName ? key(speakerName) : null, speakerName, assignment?.entityId || null, assignment?.id || null,
      exactText, clean(input.prompt), clean(input.emotion, 80), clean(input.delivery, 500), startSeconds,
      estimatedDuration, shot.requestedDurationSeconds, timingConflict ? 1 : 0, input.keepOriginalAudio === false ? 0 : 1,
      JSON.stringify(contract), JSON.stringify(sourceAssetIds), JSON.stringify(sourcePaths), idempotencyKey, now, now,
    );
  return rowToAsset(db().prepare(`SELECT * FROM story_audio_assets WHERE id = ?`).get(id));
}

export function authorizeStoryAudioAsset(input: { ownerKey: unknown; projectId: unknown; assetId: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const assetId = required(input.assetId, "assetId");
  const row = db().prepare(`SELECT * FROM story_audio_assets WHERE id = ? AND project_id = ? AND owner_key = ?`).get(assetId, projectId, ownerKey) as any;
  if (!row) throw new Error("Audio asset not found.");
  if (!["prepared", "failed"].includes(String(row.status))) return rowToAsset(row);
  const now = Date.now();
  const jobId = row.job_id || `story-audio-${randomUUID()}`;
  db().prepare(`UPDATE story_audio_assets SET status='queued', job_id=?, authorized_at=COALESCE(authorized_at, ?), updated_at=?, error=NULL WHERE id=?`).run(jobId, now, now, assetId);
  return rowToAsset(db().prepare(`SELECT * FROM story_audio_assets WHERE id = ?`).get(assetId));
}

export function recordStoryAudioResult(input: {
  ownerKey: unknown; projectId: unknown; assetId: unknown; status: "running" | "completed" | "failed";
  outputPath?: unknown; durationSeconds?: unknown; error?: unknown; derivedVideoTakeId?: unknown; externalJobId?: unknown;
}) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const assetId = required(input.assetId, "assetId");
  const row = db().prepare(`SELECT * FROM story_audio_assets WHERE id = ? AND project_id = ? AND owner_key = ?`).get(assetId, projectId, ownerKey) as any;
  if (!row) throw new Error("Audio asset not found.");
  const now = Date.now();
  const duration = input.durationSeconds == null ? row.duration_seconds : number(input.durationSeconds, 0, 0, 43_200);
  const conflict = duration != null && Number(row.start_seconds) + Number(duration) > Number(row.shot_duration_seconds);
  db().prepare(`UPDATE story_audio_assets SET status=?, output_path=?, duration_seconds=?, timing_conflict=?, derived_video_take_id=?, external_job_id=?, error=?, updated_at=?, completed_at=? WHERE id=?`).run(
    input.status, clean(input.outputPath, 2_000) || row.output_path, duration, conflict ? 1 : 0,
    clean(input.derivedVideoTakeId, 160) || row.derived_video_take_id,
    clean(input.externalJobId, 240) || row.external_job_id,
    input.status === "failed" ? clean(input.error, 4_000) || "Audio job failed." : null,
    now, input.status === "completed" ? now : row.completed_at, assetId,
  );
  return rowToAsset(db().prepare(`SELECT * FROM story_audio_assets WHERE id = ?`).get(assetId));
}

export function setStoryAudioDecision(input: { ownerKey: unknown; projectId: unknown; assetId: unknown; decision: "accepted" | "rejected" }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const assetId = required(input.assetId, "assetId");
  const row = db().prepare(`SELECT * FROM story_audio_assets WHERE id = ? AND project_id = ? AND owner_key = ?`).get(assetId, projectId, ownerKey) as any;
  if (!row) throw new Error("Audio asset not found.");
  if (!["completed", "accepted", "rejected"].includes(String(row.status))) throw new Error("Only completed audio can be reviewed.");
  const now = Date.now();
  if (input.decision === "accepted") {
    db().prepare(`UPDATE story_audio_assets SET status='completed', accepted_at=NULL, updated_at=? WHERE project_id=? AND owner_key=? AND plan_version=? AND scene_id=? AND shot_id=? AND kind=? AND status='accepted'`).run(now, projectId, ownerKey, row.plan_version, row.scene_id, row.shot_id, row.kind);
  }
  db().prepare(`UPDATE story_audio_assets SET status=?, accepted_at=?, updated_at=? WHERE id=?`).run(input.decision, input.decision === "accepted" ? now : null, now, assetId);
  return rowToAsset(db().prepare(`SELECT * FROM story_audio_assets WHERE id = ?`).get(assetId));
}

export function prepareStoryAudioRevision(input: { ownerKey: unknown; projectId: unknown; assetId: unknown; idempotencyKey: unknown; emotion?: unknown; delivery?: unknown; prompt?: unknown; exactText?: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const assetId = required(input.assetId, "assetId");
  const row = db().prepare(`SELECT * FROM story_audio_assets WHERE id = ? AND project_id = ? AND owner_key = ?`).get(assetId, projectId, ownerKey) as any;
  if (!row) throw new Error("Audio asset not found.");
  const original = rowToAsset(row);
  return prepareStoryAudioAsset({
    ownerKey, projectId, planVersion: original.planVersion, sceneId: original.sceneId, shotId: original.shotId,
    kind: original.kind, speakerName: original.speakerName, exactText: input.exactText === undefined ? original.exactText : input.exactText,
    prompt: input.prompt === undefined ? original.prompt : input.prompt,
    emotion: input.emotion === undefined ? original.emotion : input.emotion,
    delivery: input.delivery === undefined ? original.delivery : input.delivery,
    startSeconds: original.startSeconds, durationSeconds: original.durationSeconds,
    voiceAssignmentId: original.voiceAssignmentId, videoTakeId: original.videoTakeId,
    sourceAssetIds: [original.id, ...original.sourceAssetIds], sourcePaths: [...original.sourcePaths, ...(original.outputPath ? [original.outputPath] : [])],
    keepOriginalAudio: original.keepOriginalAudio, idempotencyKey: input.idempotencyKey,
    parentAssetId: original.id,
    visualVersionId: original.providerContract.request.visualVersionId,
    sourceAudioAssetId: original.providerContract.request.audioAssetId,
  });
}

export function listStoryAudioBatches(input: { ownerKey: unknown; projectId: unknown; planVersion?: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const rows = Number.isFinite(Number(input.planVersion))
    ? db().prepare(`SELECT * FROM story_audio_batches WHERE project_id=? AND owner_key=? AND plan_version=? ORDER BY created_at DESC`).all(projectId, ownerKey, Number(input.planVersion))
    : db().prepare(`SELECT * FROM story_audio_batches WHERE project_id=? AND owner_key=? ORDER BY created_at DESC`).all(projectId, ownerKey);
  return rows.map(rowToBatch);
}

export function prepareStoryAudioBatch(input: { ownerKey: unknown; projectId: unknown; sceneIds?: unknown; maxJobs?: unknown; idempotencyKey: unknown }) {
  const { ownerKey, projectId, plan } = assertProject(input.ownerKey, input.projectId);
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey", 200);
  const existing = db().prepare(`SELECT * FROM story_audio_batches WHERE owner_key=? AND idempotency_key=?`).get(ownerKey, idempotencyKey);
  if (existing) return rowToBatch(existing);
  const selected = Array.isArray(input.sceneIds) ? input.sceneIds.map((item) => clean(item, 160)).filter(Boolean) : [];
  const scenes = plan.plan.acts.flatMap((act) => act.scenes).filter((scene) => !selected.length || selected.includes(scene.id));
  const maxJobs = Math.round(number(input.maxJobs, 20, 1, 100));
  const preparedIds: string[] = [];
  const shotIds: string[] = [];
  let dialogue = 0;
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      if (preparedIds.length >= maxJobs) break;
      shotIds.push(shot.id);
      const lines = shot.dialogue.length ? shot.dialogue : [];
      for (let index = 0; index < lines.length && preparedIds.length < maxJobs; index += 1) {
        const line = lines[index];
        try {
          const asset = prepareStoryAudioAsset({
            ownerKey, projectId, planVersion: plan.version, sceneId: scene.id, shotId: shot.id,
            kind: "dialogue", speakerName: line.speaker, exactText: line.line, delivery: line.delivery,
            emotion: line.delivery, idempotencyKey: `${idempotencyKey}:${scene.id}:${shot.id}:${index}`,
          });
          preparedIds.push(asset.id);
          dialogue += 1;
        } catch {
          // Missing authorized voices stay visible as unprepared work instead of silently substituting another voice.
        }
      }
    }
  }
  const now = Date.now();
  const id = randomUUID();
  const workload = { dialogue, music: 0, soundEffects: 0, ambience: 0, lipSync: 0, blockedVoiceAssignments: scenes.flatMap((scene) => scene.shots).reduce((count, shot) => count + shot.dialogue.length, 0) - dialogue };
  db().prepare(`INSERT INTO story_audio_batches (id, project_id, owner_key, plan_version, status, scene_ids_json, shot_ids_json, asset_ids_json, max_jobs, workload_json, idempotency_key, created_at, updated_at, authorized_at) VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
    id, projectId, ownerKey, plan.version, JSON.stringify(scenes.map((scene) => scene.id)), JSON.stringify([...new Set(shotIds)]), JSON.stringify(preparedIds), maxJobs, JSON.stringify(workload), idempotencyKey, now, now,
  );
  return rowToBatch(db().prepare(`SELECT * FROM story_audio_batches WHERE id=?`).get(id));
}

export function authorizeStoryAudioBatch(input: { ownerKey: unknown; projectId: unknown; batchId: unknown }) {
  const { ownerKey, projectId } = assertProject(input.ownerKey, input.projectId);
  const batchId = required(input.batchId, "batchId");
  const row = db().prepare(`SELECT * FROM story_audio_batches WHERE id=? AND project_id=? AND owner_key=?`).get(batchId, projectId, ownerKey) as any;
  if (!row) throw new Error("Audio batch not found.");
  const batch = rowToBatch(row);
  const now = Date.now();
  const updateAsset = db().prepare(`UPDATE story_audio_assets SET status='queued', job_id=COALESCE(job_id, ?), authorized_at=COALESCE(authorized_at, ?), updated_at=? WHERE id=? AND project_id=? AND owner_key=? AND status='prepared'`);
  const tx = db().transaction(() => {
    for (const assetId of batch.assetIds.slice(0, batch.maxJobs)) updateAsset.run(`story-audio-${randomUUID()}`, now, now, assetId, projectId, ownerKey);
    db().prepare(`UPDATE story_audio_batches SET status='queued', authorized_at=COALESCE(authorized_at, ?), updated_at=? WHERE id=?`).run(now, now, batchId);
  });
  tx();
  return rowToBatch(db().prepare(`SELECT * FROM story_audio_batches WHERE id=?`).get(batchId));
}

export function storyAudioProductionSnapshot(input: { ownerKey: unknown; projectId: unknown; sceneId?: unknown; shotId?: unknown }) {
  const { ownerKey, projectId, plan } = assertProject(input.ownerKey, input.projectId);
  const sceneId = clean(input.sceneId);
  const shotId = clean(input.shotId);
  return {
    context: sceneId && shotId ? getStoryAudioShotContext({ ownerKey, projectId, sceneId, shotId }) : null,
    assignments: listStoryVoiceAssignments({ ownerKey, projectId }),
    assets: listStoryAudioAssets({ ownerKey, projectId, planVersion: plan.version, sceneId, shotId }),
    batches: listStoryAudioBatches({ ownerKey, projectId, planVersion: plan.version }),
    approvedVisuals: listStoryVisualAssets({ ownerKey, projectId }).flatMap((asset) => asset.versions
      .filter((version) => version.status === "approved" && Boolean(version.filePath))
      .map((version) => ({ versionId: version.id, assetId: asset.id, name: asset.name, kind: version.kind }))),
    voices: loadVoicesLibrary(ownerKey).voices.map((voice) => ({ voiceId: voice.voiceId, name: voice.name, type: voice.type, tags: voice.tags || [] })),
  };
}

export function resolveStoryAudioDirectorAction(input: { ownerKey: unknown; projectId: unknown; sceneId: unknown; shotId: unknown; instruction: unknown; idempotencyKey: unknown }) {
  const instruction = required(input.instruction, "instruction", 2_000);
  const context = getStoryAudioShotContext(input);
  const lower = instruction.toLowerCase();
  if (lower.includes("music")) return prepareStoryAudioAsset({ ...input, kind: "music", prompt: instruction });
  if (lower.includes("sound") || lower.includes("thunder") || lower.includes("footstep") || lower.includes("rain")) {
    return prepareStoryAudioAsset({ ...input, kind: lower.includes("ambience") || lower.includes("rain") ? "ambience" : "sound-effect", prompt: instruction });
  }
  const line = context.shot.dialogue.find((item) => lower.includes(item.speaker.toLowerCase())) || context.shot.dialogue[0];
  if (!line) throw new Error("This shot has no approved dialogue to prepare.");
  return prepareStoryAudioAsset({ ...input, kind: "dialogue", speakerName: line.speaker, exactText: line.line, delivery: instruction, emotion: instruction });
}
