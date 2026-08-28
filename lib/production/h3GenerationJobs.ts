import crypto from "node:crypto";
import path from "node:path";

import Database from "better-sqlite3";

import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import {
  normalizeProductionV2H3UserLoras,
  type ProductionV2H3UserLoraState,
} from "@/lib/production/h3Loras";
import type {
  ProductionV2Duration,
  ProductionV2ResolvedVoiceBinding,
  ProductionV2VisualReference,
} from "@/lib/production/v2";
import type { ProductionV2H3BackendId, ProductionV2H3Mode } from "@/lib/production/h3Workflows";

export type ProductionV2GenerationStatus =
  | "pending"
  | "queued_waiting_for_gpu"
  | "claimed"
  | "submitted"
  | "running"
  | "postprocessing_waiting_for_gpu"
  | "postprocessing_submitted"
  | "postprocessing_running"
  | "completed"
  | "failed";

export type ProductionV2H3GenerationPayload = {
  operation?: "scene-generation" | "visual-edit";
  finalPrompt: string;
  promptFingerprint: string;
  durationSeconds: ProductionV2Duration;
  seed: number;
  startImage: ProductionV2VisualReference | null;
  references: ProductionV2VisualReference[];
  voices: ProductionV2ResolvedVoiceBinding[];
  userLoras: ProductionV2H3UserLoraState;
  videoReference?: {
    mediaVersionId: string;
    mediaPath: string;
    includeAudio: boolean;
  };
  retryOfJobId?: string;
};

export type ProductionV2GenerationJob = {
  id: string;
  ownerKey: string;
  productionId: string;
  sceneId: string;
  model: "minimax-h3";
  mode: ProductionV2H3Mode;
  status: ProductionV2GenerationStatus;
  statusMessage: string | null;
  backend: ProductionV2H3BackendId | null;
  comfyPromptId: string | null;
  submissionState: "pre-submit" | "accepted" | "unknown" | "failed";
  payload: ProductionV2H3GenerationPayload;
  workflowId: string | null;
  workflowFile: string | null;
  nativeOutputPath: string | null;
  vsrBackend: "rtx5060ti" | null;
  vsrPromptId: string | null;
  outputPath: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

type JobRow = {
  id: string;
  owner_key: string;
  production_id: string;
  scene_id: string;
  model: string;
  mode: string;
  status: string;
  status_message: string | null;
  backend: string | null;
  comfy_prompt_id: string | null;
  submission_state: string;
  payload_json: string;
  workflow_id: string | null;
  workflow_file: string | null;
  native_output_path: string | null;
  vsr_backend: string | null;
  vsr_prompt_id: string | null;
  output_path: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

let storePathOverrideForTests: string | null = null;
let connection: any = null;
let connectionPath = "";

function nowIso() {
  return new Date().toISOString();
}

function storePath() {
  return storePathOverrideForTests || path.join(OTG_DATA_ROOT, "productions-v2", "generation-jobs.sqlite");
}

function closeConnection() {
  try { connection?.close(); } catch {}
  connection = null;
  connectionPath = "";
}

export function setProductionV2GenerationJobStorePathForTests(value: string | null) {
  closeConnection();
  storePathOverrideForTests = value;
}

function db() {
  const filePath = storePath();
  if (connection && connectionPath === filePath) return connection;
  closeConnection();
  ensureDir(path.dirname(filePath));
  const next: any = new (Database as any)(filePath);
  next.pragma("journal_mode = WAL");
  next.pragma("busy_timeout = 10000");
  next.pragma("synchronous = FULL");
  next.exec(`
    CREATE TABLE IF NOT EXISTS production_v2_generation_jobs (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      production_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      status_message TEXT,
      backend TEXT,
      comfy_prompt_id TEXT,
      submission_state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      workflow_id TEXT,
      workflow_file TEXT,
      native_output_path TEXT,
      vsr_backend TEXT,
      vsr_prompt_id TEXT,
      output_path TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      claimed_at TEXT,
      submitted_at TEXT,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS production_v2_generation_fifo_idx
      ON production_v2_generation_jobs(status, created_at, id);
    CREATE INDEX IF NOT EXISTS production_v2_generation_scene_idx
      ON production_v2_generation_jobs(owner_key, production_id, scene_id, created_at);
  `);
  const columns = new Set((next.prepare("PRAGMA table_info(production_v2_generation_jobs)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("native_output_path")) next.exec("ALTER TABLE production_v2_generation_jobs ADD COLUMN native_output_path TEXT");
  if (!columns.has("vsr_backend")) next.exec("ALTER TABLE production_v2_generation_jobs ADD COLUMN vsr_backend TEXT");
  if (!columns.has("vsr_prompt_id")) next.exec("ALTER TABLE production_v2_generation_jobs ADD COLUMN vsr_prompt_id TEXT");
  connection = next;
  connectionPath = filePath;
  return next;
}

function fromRow(row: JobRow | undefined): ProductionV2GenerationJob | null {
  if (!row) return null;
  const rawPayload = JSON.parse(row.payload_json) as ProductionV2H3GenerationPayload;
  return {
    id: row.id,
    ownerKey: row.owner_key,
    productionId: row.production_id,
    sceneId: row.scene_id,
    model: "minimax-h3",
    mode: row.mode as ProductionV2H3Mode,
    status: row.status as ProductionV2GenerationStatus,
    statusMessage: row.status_message,
    backend: row.backend as ProductionV2H3BackendId | null,
    comfyPromptId: row.comfy_prompt_id,
    submissionState: row.submission_state as ProductionV2GenerationJob["submissionState"],
    payload: {
      ...rawPayload,
      userLoras: normalizeProductionV2H3UserLoras(rawPayload.userLoras),
    },
    workflowId: row.workflow_id,
    workflowFile: row.workflow_file,
    nativeOutputPath: row.native_output_path,
    vsrBackend: row.vsr_backend === "rtx5060ti" ? "rtx5060ti" : null,
    vsrPromptId: row.vsr_prompt_id,
    outputPath: row.output_path,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    submittedAt: row.submitted_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function selectJob(id: string) {
  return fromRow(db().prepare("SELECT * FROM production_v2_generation_jobs WHERE id = ?").get(id) as JobRow | undefined);
}

export function createProductionV2GenerationJob(input: {
  ownerKey: string;
  productionId: string;
  sceneId: string;
  mode: ProductionV2H3Mode;
  payload: ProductionV2H3GenerationPayload;
}) {
  const database = db();
  const create = database.transaction(() => {
    const existing = database.prepare(`
      SELECT * FROM production_v2_generation_jobs
      WHERE owner_key = ? AND production_id = ? AND scene_id = ?
        AND status IN ('pending','queued_waiting_for_gpu','claimed','submitted','running','postprocessing_waiting_for_gpu','postprocessing_submitted','postprocessing_running')
      ORDER BY created_at ASC, id ASC LIMIT 1
    `).get(input.ownerKey, input.productionId, input.sceneId) as JobRow | undefined;
    if (existing) return fromRow(existing);
    const timestamp = nowIso();
    const id = `production-h3-${crypto.randomUUID()}`;
    database.prepare(`
      INSERT INTO production_v2_generation_jobs (
        id, owner_key, production_id, scene_id, model, mode, status, status_message,
        backend, comfy_prompt_id, submission_state, payload_json, workflow_id,
        workflow_file, output_path, error, attempts, created_at, updated_at,
        claimed_at, submitted_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, 'minimax-h3', ?, 'pending', 'Waiting for GPU', NULL, NULL,
        'pre-submit', ?, NULL, NULL, NULL, NULL, 0, ?, ?, NULL, NULL, NULL, NULL)
    `).run(id, input.ownerKey, input.productionId, input.sceneId, input.mode, JSON.stringify(input.payload), timestamp, timestamp);
    return selectJob(id);
  });
  return create.immediate() as ProductionV2GenerationJob;
}

export function getProductionV2GenerationJob(id: string, ownerKey?: string) {
  const job = selectJob(id);
  return job && (!ownerKey || job.ownerKey === ownerKey) ? job : null;
}

export function getLatestProductionV2SceneGeneration(ownerKey: string, productionId: string, sceneId: string) {
  return fromRow(db().prepare(`
    SELECT * FROM production_v2_generation_jobs
    WHERE owner_key = ? AND production_id = ? AND scene_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(ownerKey, productionId, sceneId) as JobRow | undefined);
}

export function getLatestProductionV2SceneVideoGeneration(ownerKey: string, productionId: string, sceneId: string) {
  const rows = db().prepare(`
    SELECT * FROM production_v2_generation_jobs
    WHERE owner_key = ? AND production_id = ? AND scene_id = ?
    ORDER BY created_at DESC, rowid DESC
  `).all(ownerKey, productionId, sceneId) as JobRow[];
  return rows
    .map(fromRow)
    .find((job): job is ProductionV2GenerationJob => Boolean(job && job.payload.operation !== "visual-edit")) || null;
}

export function listWaitingProductionV2GenerationJobs(limit = 16) {
  return (db().prepare(`
    SELECT * FROM production_v2_generation_jobs
    WHERE status IN ('pending','queued_waiting_for_gpu')
    ORDER BY created_at ASC, rowid ASC LIMIT ?
  `).all(Math.max(1, Math.min(100, limit))) as JobRow[]).map(fromRow).filter(Boolean) as ProductionV2GenerationJob[];
}

export function listActiveProductionV2GenerationJobs(limit = 32) {
  return (db().prepare(`
    SELECT * FROM production_v2_generation_jobs
    WHERE status IN ('submitted','running','postprocessing_waiting_for_gpu','postprocessing_submitted','postprocessing_running')
    ORDER BY submitted_at ASC, rowid ASC LIMIT ?
  `).all(Math.max(1, Math.min(100, limit))) as JobRow[]).map(fromRow).filter(Boolean) as ProductionV2GenerationJob[];
}

export function markProductionV2GenerationWaiting(id: string, message = "Waiting for first available GPU") {
  const timestamp = nowIso();
  db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'queued_waiting_for_gpu', status_message = ?, updated_at = ?
    WHERE id = ? AND status IN ('pending','queued_waiting_for_gpu')
  `).run(message, timestamp, id);
  return selectJob(id);
}

export function claimProductionV2GenerationJob(id: string, backend: ProductionV2H3BackendId) {
  const timestamp = nowIso();
  const claim = db().transaction(() => {
    const result = db().prepare(`
      UPDATE production_v2_generation_jobs
      SET status = 'claimed', status_message = ?, backend = ?, claimed_at = ?, updated_at = ?,
          attempts = attempts + 1, error = NULL
      WHERE id = ? AND status IN ('pending','queued_waiting_for_gpu') AND comfy_prompt_id IS NULL
    `).run(`Queued on ${backend === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti"}`, backend, timestamp, timestamp, id);
    return result.changes === 1 ? selectJob(id) : null;
  });
  return claim.immediate() as ProductionV2GenerationJob | null;
}

export function requeueProductionV2GenerationBeforeAcceptance(id: string, backend: ProductionV2H3BackendId, message: string) {
  const timestamp = nowIso();
  const result = db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'queued_waiting_for_gpu', status_message = ?, backend = NULL,
        claimed_at = NULL, updated_at = ?, error = NULL
    WHERE id = ? AND status = 'claimed' AND backend = ? AND comfy_prompt_id IS NULL
      AND submission_state = 'pre-submit'
  `).run(message, timestamp, id, backend);
  return result.changes === 1 ? selectJob(id) : null;
}

export function markProductionV2GenerationSubmitted(input: {
  id: string;
  backend: ProductionV2H3BackendId;
  promptId: string;
  workflowId: string;
  workflowFile: string;
}) {
  const timestamp = nowIso();
  const result = db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'submitted', status_message = ?, comfy_prompt_id = ?, submission_state = 'accepted',
        workflow_id = ?, workflow_file = ?, submitted_at = ?, updated_at = ?
    WHERE id = ? AND status = 'claimed' AND backend = ? AND comfy_prompt_id IS NULL
      AND submission_state = 'pre-submit'
  `).run(`Generating on ${input.backend === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti"}`, input.promptId, input.workflowId, input.workflowFile, timestamp, timestamp, input.id, input.backend);
  return result.changes === 1 ? selectJob(input.id) : null;
}

export function markProductionV2GenerationRunning(id: string) {
  const timestamp = nowIso();
  db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'running', status_message = CASE backend WHEN 'rtx3090' THEN 'Generating on RTX 3090' ELSE 'Generating on RTX 5060 Ti' END,
        started_at = COALESCE(started_at, ?), updated_at = ?
    WHERE id = ? AND status IN ('submitted','running') AND comfy_prompt_id IS NOT NULL
  `).run(timestamp, timestamp, id);
  return selectJob(id);
}

export function markProductionV2GenerationNativeReady(id: string, nativeOutputPath: string) {
  const timestamp = nowIso();
  const result = db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'postprocessing_waiting_for_gpu', status_message = 'Waiting for RTX VSR ULTRA 1080p',
        native_output_path = ?, updated_at = ?
    WHERE id = ? AND status IN ('submitted','running') AND comfy_prompt_id IS NOT NULL
  `).run(nativeOutputPath, timestamp, id);
  return result.changes === 1 ? selectJob(id) : null;
}

export function markProductionV2GenerationVsrWaiting(id: string, message: string) {
  const timestamp = nowIso();
  db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'postprocessing_waiting_for_gpu', status_message = ?, updated_at = ?
    WHERE id = ? AND status = 'postprocessing_waiting_for_gpu' AND native_output_path IS NOT NULL
  `).run(message, timestamp, id);
  return selectJob(id);
}

export function markProductionV2GenerationVsrSubmitted(input: { id: string; promptId: string }) {
  const timestamp = nowIso();
  const result = db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'postprocessing_submitted', status_message = 'Upscaling to 1080p with RTX VSR ULTRA',
        vsr_backend = 'rtx5060ti', vsr_prompt_id = ?, updated_at = ?
    WHERE id = ? AND status = 'postprocessing_waiting_for_gpu' AND native_output_path IS NOT NULL
      AND vsr_prompt_id IS NULL
  `).run(input.promptId, timestamp, input.id);
  return result.changes === 1 ? selectJob(input.id) : null;
}

export function markProductionV2GenerationVsrRunning(id: string) {
  const timestamp = nowIso();
  db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'postprocessing_running', status_message = 'Upscaling to 1080p with RTX VSR ULTRA', updated_at = ?
    WHERE id = ? AND status IN ('postprocessing_submitted','postprocessing_running')
      AND vsr_backend = 'rtx5060ti' AND vsr_prompt_id IS NOT NULL
  `).run(timestamp, id);
  return selectJob(id);
}

export function completeProductionV2GenerationJob(id: string, outputPath: string) {
  const timestamp = nowIso();
  const result = db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'completed', status_message = 'Complete - 1080p final output', output_path = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('postprocessing_submitted','postprocessing_running')
      AND native_output_path IS NOT NULL AND vsr_backend = 'rtx5060ti' AND vsr_prompt_id IS NOT NULL
  `).run(outputPath, timestamp, timestamp, id);
  return result.changes === 1 ? selectJob(id) : null;
}

export function failProductionV2GenerationJob(id: string, error: string, submissionUnknown = false) {
  const timestamp = nowIso();
  db().prepare(`
    UPDATE production_v2_generation_jobs
    SET status = 'failed', status_message = 'Failed', error = ?, submission_state = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND status != 'completed'
  `).run(error, submissionUnknown ? "unknown" : "failed", timestamp, timestamp, id);
  return selectJob(id);
}
