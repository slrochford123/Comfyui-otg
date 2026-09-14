import crypto from "node:crypto";
import path from "node:path";

import Database from "better-sqlite3";

import {
  ensureDir,
  OTG_DATA_ROOT,
} from "@/lib/paths";

import type {
  Ltx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

import type {
  Ltx25IngredientsBackendId,
  Ltx25IngredientsQualifiedDuration,
} from "@/lib/production/ltx25IngredientsWorkflow";

export type ProductionV2Ltx25GenerationStatus =
  | "pending"
  | "queued_waiting_for_gpu"
  | "claimed"
  | "submitted"
  | "running"
  | "completed"
  | "failed";

export type ProductionV2Ltx25SubmissionState =
  | "pre-submit"
  | "accepted"
  | "unknown"
  | "failed";

export type ProductionV2Ltx25GenerationPayload = {
  finalPrompt: string;
  lockedReferenceContext: string;
  promptFingerprint: string;
  durationSeconds:
    Ltx25IngredientsQualifiedDuration;
  seed: number;
  manifest: Ltx25IngredientsManifest;

  /*
   * Server-owned path prepared from the prior scene's
   * selected media version. Never populate this directly
   * from an unverified client filesystem path.
   */
  continuationFirstFramePath?: string | null;
};

export type ProductionV2Ltx25GenerationJob = {
  id: string;
  ownerKey: string;
  productionId: string;
  sceneId: string;

  model: "ltx-2.5";
  mode:
    "ltx-ingredients-image-to-video";

  status:
    ProductionV2Ltx25GenerationStatus;

  statusMessage: string | null;

  backend:
    Ltx25IngredientsBackendId
    | null;

  comfyPromptId: string | null;

  submissionState:
    ProductionV2Ltx25SubmissionState;

  payload:
    ProductionV2Ltx25GenerationPayload;

  workflowId: string | null;
  workflowFile: string | null;

  sheetPath: string | null;
  sheetSha256: string | null;

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
  sheet_path: string | null;
  sheet_sha256: string | null;
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

let storePathOverrideForTests:
  string | null = null;

let connection: any = null;
let connectionPath = "";

function nowIso() {
  return new Date().toISOString();
}

function storePath() {
  return (
    storePathOverrideForTests
    || path.join(
      OTG_DATA_ROOT,
      "productions-v2",
      "ltx25-ingredients-generation-jobs.sqlite",
    )
  );
}

function closeConnection() {
  try {
    connection?.close();
  } catch {}

  connection = null;
  connectionPath = "";
}

export function setProductionV2Ltx25GenerationJobStorePathForTests(
  value: string | null,
) {
  closeConnection();

  storePathOverrideForTests =
    value;
}

function db() {
  const filePath =
    storePath();

  if (
    connection
    && connectionPath === filePath
  ) {
    return connection;
  }

  closeConnection();

  ensureDir(
    path.dirname(filePath),
  );

  const next =
    new Database(filePath);

  next.pragma(
    "journal_mode = WAL",
  );

  next.pragma(
    "busy_timeout = 5000",
  );

  next.exec(`
    CREATE TABLE IF NOT EXISTS
      production_v2_ltx25_generation_jobs (
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

        sheet_path TEXT,
        sheet_sha256 TEXT,

        output_path TEXT,
        error TEXT,

        attempts INTEGER
          NOT NULL DEFAULT 0,

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        claimed_at TEXT,
        submitted_at TEXT,
        started_at TEXT,
        completed_at TEXT
      );

    CREATE INDEX IF NOT EXISTS
      production_v2_ltx25_fifo_idx
      ON production_v2_ltx25_generation_jobs(
        status,
        created_at,
        id
      );

    CREATE INDEX IF NOT EXISTS
      production_v2_ltx25_scene_idx
      ON production_v2_ltx25_generation_jobs(
        owner_key,
        production_id,
        scene_id,
        created_at
      );
  `);

  connection = next;
  connectionPath = filePath;

  return next;
}

function fromRow(
  row: JobRow | undefined,
): ProductionV2Ltx25GenerationJob | null {
  if (!row) {
    return null;
  }

  const payload =
    JSON.parse(
      row.payload_json,
    ) as ProductionV2Ltx25GenerationPayload;

  return {
    id: row.id,
    ownerKey: row.owner_key,
    productionId:
      row.production_id,
    sceneId: row.scene_id,

    model: "ltx-2.5",

    mode:
      "ltx-ingredients-image-to-video",

    status:
      row.status as
        ProductionV2Ltx25GenerationStatus,

    statusMessage:
      row.status_message,

    backend:
      row.backend === "rtx5060ti"
      || row.backend === "rtx3090"
        ? row.backend
        : null,

    comfyPromptId:
      row.comfy_prompt_id,

    submissionState:
      row.submission_state as
        ProductionV2Ltx25SubmissionState,

    payload,

    workflowId:
      row.workflow_id,

    workflowFile:
      row.workflow_file,

    sheetPath:
      row.sheet_path,

    sheetSha256:
      row.sheet_sha256,

    outputPath:
      row.output_path,

    error:
      row.error,

    attempts:
      row.attempts,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,

    claimedAt:
      row.claimed_at,

    submittedAt:
      row.submitted_at,

    startedAt:
      row.started_at,

    completedAt:
      row.completed_at,
  };
}

function selectJob(
  id: string,
) {
  return fromRow(
    db()
      .prepare(
        `
          SELECT *
          FROM production_v2_ltx25_generation_jobs
          WHERE id = ?
        `,
      )
      .get(id) as
        JobRow | undefined,
  );
}

export function createProductionV2Ltx25GenerationJob(
  input: {
    ownerKey: string;
    productionId: string;
    sceneId: string;
    payload:
      ProductionV2Ltx25GenerationPayload;
  },
) {
  const database =
    db();

  const transaction =
    database.transaction(() => {
      const existing =
        database
          .prepare(`
            SELECT *
            FROM production_v2_ltx25_generation_jobs
            WHERE
              owner_key = ?
              AND production_id = ?
              AND scene_id = ?
              AND status IN (
                'pending',
                'queued_waiting_for_gpu',
                'claimed',
                'submitted',
                'running'
              )
            ORDER BY
              created_at ASC,
              id ASC
            LIMIT 1
          `)
          .get(
            input.ownerKey,
            input.productionId,
            input.sceneId,
          ) as JobRow | undefined;

      if (existing) {
        return fromRow(existing);
      }

      const timestamp =
        nowIso();

      const id =
        `production-ltx25-${crypto.randomUUID()}`;

      database
        .prepare(`
          INSERT INTO
            production_v2_ltx25_generation_jobs (
              id,
              owner_key,
              production_id,
              scene_id,

              model,
              mode,

              status,
              status_message,

              backend,
              comfy_prompt_id,
              submission_state,

              payload_json,

              workflow_id,
              workflow_file,

              sheet_path,
              sheet_sha256,

              output_path,
              error,

              attempts,

              created_at,
              updated_at,

              claimed_at,
              submitted_at,
              started_at,
              completed_at
            )
          VALUES (
            ?,
            ?,
            ?,
            ?,

            'ltx-2.5',
            'ltx-ingredients-image-to-video',

            'pending',
            'Waiting for an idle LTX 2.5 GPU',

            NULL,
            NULL,
            'pre-submit',

            ?,

            NULL,
            NULL,

            NULL,
            NULL,

            NULL,
            NULL,

            0,

            ?,
            ?,

            NULL,
            NULL,
            NULL,
            NULL
          )
        `)
        .run(
          id,
          input.ownerKey,
          input.productionId,
          input.sceneId,
          JSON.stringify(
            input.payload,
          ),
          timestamp,
          timestamp,
        );

      return selectJob(id);
    });

  return transaction.immediate() as ProductionV2Ltx25GenerationJob;
}

export function getProductionV2Ltx25GenerationJob(
  id: string,
  ownerKey?: string,
) {
  const job =
    selectJob(id);

  if (!job) {
    return null;
  }

  if (
    ownerKey
    && job.ownerKey !== ownerKey
  ) {
    return null;
  }

  return job;
}

export function getLatestProductionV2Ltx25SceneGeneration(
  ownerKey: string,
  productionId: string,
  sceneId: string,
) {
  return fromRow(
    db()
      .prepare(`
        SELECT *
        FROM production_v2_ltx25_generation_jobs
        WHERE
          owner_key = ?
          AND production_id = ?
          AND scene_id = ?
        ORDER BY
          created_at DESC,
          id DESC
        LIMIT 1
      `)
      .get(
        ownerKey,
        productionId,
        sceneId,
      ) as JobRow | undefined,
  );
}

export function getOldestWaitingProductionV2Ltx25GenerationJob() {
  return fromRow(
    db()
      .prepare(`
        SELECT *
        FROM production_v2_ltx25_generation_jobs
        WHERE status IN (
          'pending',
          'queued_waiting_for_gpu'
        )
        ORDER BY
          created_at ASC,
          id ASC
        LIMIT 1
      `)
      .get() as
        JobRow | undefined,
  );
}

export function markProductionV2Ltx25GenerationWaiting(
  id: string,
  message =
    "Waiting for an idle LTX 2.5 GPU",
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE
        production_v2_ltx25_generation_jobs
      SET
        status =
          'queued_waiting_for_gpu',
        status_message = ?,
        updated_at = ?
      WHERE
        id = ?
        AND status IN (
          'pending',
          'queued_waiting_for_gpu'
        )
    `)
    .run(
      message,
      timestamp,
      id,
    );

  return selectJob(id);
}

export function claimProductionV2Ltx25GenerationJob(
  id: string,
  backend:
    Ltx25IngredientsBackendId,
) {
  const timestamp =
    nowIso();

  const result =
    db()
      .prepare(`
        UPDATE
          production_v2_ltx25_generation_jobs
        SET
          status = 'claimed',
          status_message =
            'Preparing LTX 2.5 Ingredients generation',
          backend = ?,
          attempts = attempts + 1,
          claimed_at = ?,
          updated_at = ?
        WHERE
          id = ?
          AND status IN (
            'pending',
            'queued_waiting_for_gpu'
          )
          AND submission_state =
            'pre-submit'
          AND comfy_prompt_id IS NULL
      `)
      .run(
        backend,
        timestamp,
        timestamp,
        id,
      );

  if (!result.changes) {
    return null;
  }

  return selectJob(id);
}

export function markProductionV2Ltx25SheetReady(
  id: string,
  input: {
    sheetPath: string;
    sheetSha256: string;
  },
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE
        production_v2_ltx25_generation_jobs
      SET
        sheet_path = ?,
        sheet_sha256 = ?,
        status_message =
          'Ingredients sheet ready',
        updated_at = ?
      WHERE
        id = ?
        AND status = 'claimed'
        AND submission_state =
          'pre-submit'
        AND comfy_prompt_id IS NULL
    `)
    .run(
      input.sheetPath,
      input.sheetSha256,
      timestamp,
      id,
    );

  return selectJob(id);
}

export function markProductionV2Ltx25SubmissionAccepted(
  id: string,
  input: {
    promptId: string;
    workflowId: string;
    workflowFile: string;
  },
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE
        production_v2_ltx25_generation_jobs
      SET
        status = 'submitted',
        status_message =
          'Submitted to ComfyUI',
        comfy_prompt_id = ?,
        submission_state =
          'accepted',
        workflow_id = ?,
        workflow_file = ?,
        submitted_at = ?,
        updated_at = ?
      WHERE
        id = ?
        AND status = 'claimed'
        AND submission_state IN (
          'pre-submit',
          'unknown'
        )
        AND comfy_prompt_id IS NULL
    `)
    .run(
      input.promptId,
      input.workflowId,
      input.workflowFile,
      timestamp,
      timestamp,
      id,
    );

  return selectJob(id);
}

export function markProductionV2Ltx25GenerationRunning(
  id: string,
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE
        production_v2_ltx25_generation_jobs
      SET
        status = 'running',
        status_message =
          'Rendering LTX 2.5 Ingredients video',
        started_at =
          COALESCE(
            started_at,
            ?
          ),
        updated_at = ?
      WHERE
        id = ?
        AND status IN (
          'submitted',
          'running'
        )
        AND submission_state =
          'accepted'
        AND comfy_prompt_id IS NOT NULL
    `)
    .run(
      timestamp,
      timestamp,
      id,
    );

  return selectJob(id);
}

export function completeProductionV2Ltx25GenerationJob(
  id: string,
  outputPath: string,
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE
        production_v2_ltx25_generation_jobs
      SET
        status = 'completed',
        status_message = 'Complete',
        output_path = ?,
        error = NULL,
        completed_at = ?,
        updated_at = ?
      WHERE
        id = ?
        AND status IN (
          'submitted',
          'running'
        )
        AND submission_state =
          'accepted'
        AND comfy_prompt_id IS NOT NULL
    `)
    .run(
      outputPath,
      timestamp,
      timestamp,
      id,
    );

  return selectJob(id);
}

export function failProductionV2Ltx25GenerationJob(
  id: string,
  error: string,
  submissionUnknown = false,
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE
        production_v2_ltx25_generation_jobs
      SET
        status = 'failed',
        status_message = 'Failed',
        error = ?,
        submission_state = ?,
        completed_at = ?,
        updated_at = ?
      WHERE
        id = ?
        AND status != 'completed'
    `)
    .run(
      String(error || "LTX generation failed"),
      submissionUnknown
        ? "unknown"
        : "failed",
      timestamp,
      timestamp,
      id,
    );

  return selectJob(id);
}

export function requeueProductionV2Ltx25GenerationBeforeAcceptance(
  id: string,
  message =
    "Waiting for another idle LTX 2.5 GPU",
) {
  const timestamp =
    nowIso();

  const result =
    db()
      .prepare(`
        UPDATE
          production_v2_ltx25_generation_jobs
        SET
          status =
            'queued_waiting_for_gpu',
          status_message = ?,
          backend = NULL,
          updated_at = ?
        WHERE
          id = ?
          AND status = 'claimed'
          AND submission_state =
            'pre-submit'
          AND comfy_prompt_id IS NULL
      `)
      .run(
        message,
        timestamp,
        id,
      );

  if (!result.changes) {
    return null;
  }

  return selectJob(id);
}

export function getOldestActiveProductionV2Ltx25GenerationJob() {
  return fromRow(
    db()
      .prepare(`
        SELECT *
        FROM production_v2_ltx25_generation_jobs
        WHERE status IN (
          'claimed',
          'submitted',
          'running'
        )
        ORDER BY
          created_at ASC,
          id ASC
        LIMIT 1
      `)
      .get() as
        JobRow | undefined,
  );
}

/*
 * Mark the remote-admission window ambiguous immediately
 * before the actual /prompt POST.
 *
 * If the process dies after dispatch but before acceptance
 * is persisted, the job must never be silently replayed.
 */
export function markProductionV2Ltx25SubmissionAttempting(
  id: string,
) {
  const timestamp =
    nowIso();

  const result =
    db()
      .prepare(`
        UPDATE
          production_v2_ltx25_generation_jobs
        SET
          submission_state = 'unknown',
          status_message =
            'Submitting to ComfyUI',
          updated_at = ?
        WHERE
          id = ?
          AND status = 'claimed'
          AND submission_state =
            'pre-submit'
          AND comfy_prompt_id IS NULL
      `)
      .run(
        timestamp,
        id,
      );

  if (!result.changes) {
    return null;
  }

  return selectJob(id);
}

export function productionV2Ltx25GenerationIsActive(
  status:
    ProductionV2Ltx25GenerationStatus
    | null
    | undefined,
) {
  return (
    status === "pending"
    || status ===
      "queued_waiting_for_gpu"
    || status === "claimed"
    || status === "submitted"
    || status === "running"
  );
}
