import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  OTG_DATA_ROOT,
} from "@/lib/paths";

import type {
  QwenClusterNode,
} from "@/lib/workers/qwenClusterRouter";

/*
 * OTG_QWEN_DURABLE_QUEUE_V1
 *
 * Capacity waiting belongs in durable application state, not in
 * the lifetime of one browser/HTTP request.
 */

export type QwenDurableJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed";

export type QwenDurableJobPath =
  | "/api/generate"
  | "/api/chat";

export type QwenDurableJob = {
  id: string;
  ownerKey: string | null;
  requestKind: string;
  path: QwenDurableJobPath;
  payload: Record<string, unknown>;

  requiredContextTokens: number;
  allowedNodes: QwenClusterNode[];

  model: string | null;
  modelByNode:
    Partial<
      Record<
        QwenClusterNode,
        string
      >
    >;

  keepAlive:
    string
    | number
    | null;

  executionTimeoutMs: number;
  leaseTtlSeconds: number | null;

  status: QwenDurableJobStatus;
  statusMessage: string;

  assignedNode:
    QwenClusterNode
    | null;

  attempts: number;

  responseStatus: number | null;
  responseStatusText: string;
  responseHeaders:
    Record<string, string>;
  responseBody: string | null;

  error: string | null;

  createdAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type JobRow = {
  id: string;
  owner_key: string | null;
  request_kind: string;
  path: string;
  payload_json: string;

  required_context_tokens: number;
  allowed_nodes_json: string;

  model: string | null;
  model_by_node_json: string;

  keep_alive_json: string | null;

  execution_timeout_ms: number;
  lease_ttl_seconds: number | null;

  status: string;
  status_message: string;

  assigned_node: string | null;

  attempts: number;

  response_status: number | null;
  response_status_text: string | null;
  response_headers_json:
    string | null;
  response_body: string | null;

  error: string | null;

  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

let database:
  any = null;

let storePathOverrideForTests:
  string | null =
    null;

function nowIso() {
  return new Date().toISOString();
}

function configuredStorePath() {
  return (
    storePathOverrideForTests
    || path.join(
      OTG_DATA_ROOT,
      "qwen-cluster",
      "jobs.sqlite",
    )
  );
}

function closeDatabase() {
  if (!database) return;

  try {
    database.close();
  } catch {}

  database = null;
}

export function setQwenDurableJobStorePathForTests(
  value: string | null,
) {
  closeDatabase();

  storePathOverrideForTests =
    value;
}

function db() {
  if (database) {
    return database;
  }

  const filePath =
    configuredStorePath();

  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true,
    },
  );

  const next:
    any =
      new (Database as any)(
        filePath,
      );

  next.pragma(
    "journal_mode = WAL",
  );

  next.pragma(
    "busy_timeout = 10000",
  );

  next.pragma(
    "synchronous = FULL",
  );

  next.exec(`
    CREATE TABLE IF NOT EXISTS qwen_cluster_jobs (
      id TEXT PRIMARY KEY,

      owner_key TEXT,
      request_kind TEXT NOT NULL,
      path TEXT NOT NULL,
      payload_json TEXT NOT NULL,

      required_context_tokens INTEGER NOT NULL,
      allowed_nodes_json TEXT NOT NULL,

      model TEXT,
      model_by_node_json TEXT NOT NULL,
      keep_alive_json TEXT,

      execution_timeout_ms INTEGER NOT NULL,
      lease_ttl_seconds INTEGER,

      status TEXT NOT NULL,
      status_message TEXT NOT NULL,

      assigned_node TEXT,

      attempts INTEGER NOT NULL DEFAULT 0,

      response_status INTEGER,
      response_status_text TEXT,
      response_headers_json TEXT,
      response_body TEXT,

      error TEXT,

      created_at TEXT NOT NULL,
      claimed_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS
      qwen_cluster_jobs_status_created_idx
    ON qwen_cluster_jobs(
      status,
      created_at
    );
  `);

  database =
    next;

  return database;
}

function parseJson<T>(
  value: unknown,
  fallback: T,
): T {
  if (
    typeof value !== "string"
    || !value
  ) {
    return fallback;
  }

  try {
    return JSON.parse(
      value,
    ) as T;
  } catch {
    return fallback;
  }
}

function fromRow(
  row:
    JobRow
    | undefined,
): QwenDurableJob | null {
  if (!row) return null;

  const allowedNodes =
    parseJson<QwenClusterNode[]>(
      row.allowed_nodes_json,
      [],
    ).filter(
      (node) =>
        node === "slr"
        || node === "shawn",
    );

  const assignedNode =
    row.assigned_node === "slr"
    || row.assigned_node
      === "shawn"
      ? row.assigned_node
      : null;

  const status =
    (
      [
        "queued",
        "claimed",
        "running",
        "completed",
        "failed",
      ] as const
    ).includes(
      row.status as
        QwenDurableJobStatus,
    )
      ? row.status as
          QwenDurableJobStatus
      : "failed";

  return {
    id:
      row.id,

    ownerKey:
      row.owner_key,

    requestKind:
      row.request_kind,

    path:
      row.path === "/api/chat"
        ? "/api/chat"
        : "/api/generate",

    payload:
      parseJson<
        Record<string, unknown>
      >(
        row.payload_json,
        {},
      ),

    requiredContextTokens:
      Number(
        row.required_context_tokens,
      ) || 1,

    allowedNodes,

    model:
      row.model,

    modelByNode:
      parseJson<
        Partial<
          Record<
            QwenClusterNode,
            string
          >
        >
      >(
        row.model_by_node_json,
        {},
      ),

    keepAlive:
      parseJson<
        string
        | number
        | null
      >(
        row.keep_alive_json,
        null,
      ),

    executionTimeoutMs:
      Number(
        row.execution_timeout_ms,
      ) || 180_000,

    leaseTtlSeconds:
      row.lease_ttl_seconds == null
        ? null
        : Number(
            row.lease_ttl_seconds,
          ),

    status,

    statusMessage:
      row.status_message,

    assignedNode,

    attempts:
      Number(
        row.attempts,
      ) || 0,

    responseStatus:
      row.response_status == null
        ? null
        : Number(
            row.response_status,
          ),

    responseStatusText:
      String(
        row.response_status_text
        || "",
      ),

    responseHeaders:
      parseJson<
        Record<string, string>
      >(
        row.response_headers_json,
        {},
      ),

    responseBody:
      row.response_body,

    error:
      row.error,

    createdAt:
      row.created_at,

    claimedAt:
      row.claimed_at,

    startedAt:
      row.started_at,

    completedAt:
      row.completed_at,

    updatedAt:
      row.updated_at,
  };
}

function selectJob(
  id: string,
) {
  return fromRow(
    db()
      .prepare(`
        SELECT *
        FROM qwen_cluster_jobs
        WHERE id = ?
      `)
      .get(id) as
        JobRow
        | undefined,
  );
}

export function createQwenDurableJob(
  input: {
      id?: string;
    ownerKey?: string | null;
    requestKind?: string;
    path: QwenDurableJobPath;
    payload:
      Record<string, unknown>;

    requiredContextTokens: number;

    allowedNodes?:
      readonly QwenClusterNode[];

    model?: string | null;

    modelByNode?:
      Partial<
        Record<
          QwenClusterNode,
          string
        >
      >;

    keepAlive?:
      string
      | number
      | null;

    executionTimeoutMs?: number;
    leaseTtlSeconds?: number | null;
  },
) {
    const requestedId =
      String(
        input.id
        || "",
      ).trim();

    if (
      requestedId
      && !/^[A-Za-z0-9._:-]{1,200}$/.test(
        requestedId,
      )
    ) {
      throw new Error(
        "Invalid durable Qwen job id.",
      );
    }

    const id =
      requestedId
      || `qwen_${crypto.randomUUID()}`;

  const timestamp =
    nowIso();

  const allowedNodes =
    Array.from(
      new Set(
        (
          input.allowedNodes
          || [
            "slr",
            "shawn",
          ]
        ).filter(
          (node) =>
            node === "slr"
            || node === "shawn",
        ),
      ),
    );

  db()
    .prepare(`
      INSERT INTO qwen_cluster_jobs (
        id,
        owner_key,
        request_kind,
        path,
        payload_json,
        required_context_tokens,
        allowed_nodes_json,
        model,
        model_by_node_json,
        keep_alive_json,
        execution_timeout_ms,
        lease_ttl_seconds,
        status,
        status_message,
        assigned_node,
        attempts,
        response_status,
        response_status_text,
        response_headers_json,
        response_body,
        error,
        created_at,
        claimed_at,
        started_at,
        completed_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, 'queued',
        'Waiting for first available Qwen GPU',
        NULL, 0,
        NULL, NULL, NULL, NULL, NULL,
        ?, NULL, NULL, NULL, ?
      )
    `)
    .run(
      id,
      String(
        input.ownerKey
        || "",
      ).trim() || null,

      String(
        input.requestKind
        || "qwen",
      ).trim() || "qwen",

      input.path,

      JSON.stringify(
        input.payload || {},
      ),

      Math.max(
        1,
        Math.floor(
          Number(
            input.requiredContextTokens,
          ) || 1,
        ),
      ),

      JSON.stringify(
        allowedNodes,
      ),

      String(
        input.model
        || "",
      ).trim() || null,

      JSON.stringify(
        input.modelByNode || {},
      ),

      JSON.stringify(
        input.keepAlive
        ?? null,
      ),

      Math.max(
        1_000,
        Math.floor(
          Number(
            input.executionTimeoutMs,
          ) || 180_000,
        ),
      ),

      input.leaseTtlSeconds == null
        ? null
        : Math.max(
            1,
            Math.floor(
              Number(
                input.leaseTtlSeconds,
              ) || 1,
            ),
          ),

      timestamp,
      timestamp,
    );

  return selectJob(
    id,
  )!;
}


function stableQwenIdentityJson(
  value: unknown,
): string {
  if (Array.isArray(value)) {
    return `[${value
      .map(
        stableQwenIdentityJson,
      )
      .join(",")}]`;
  }

  if (
    value
    && typeof value === "object"
  ) {
    const record =
      value as
        Record<string, unknown>;

    return `{${Object
      .keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableQwenIdentityJson(record[key])}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(
    value,
  );
}

function normalizedQwenOwnerKey(
  value:
    string
    | null
    | undefined,
) {
  return String(
    value
    || "",
  ).trim() || null;
}

function verifyDeterministicQwenJobIdentity(
  existing: QwenDurableJob,
  input:
    Parameters<
      typeof createQwenDurableJob
    >[0],
) {
  const expectedOwnerKey =
    normalizedQwenOwnerKey(
      input.ownerKey,
    );

  const expectedRequestKind =
    String(
      input.requestKind
      || "qwen",
    ).trim() || "qwen";

  const expectedContext =
    Math.max(
      1,
      Math.floor(
        Number(
          input.requiredContextTokens,
        ) || 1,
      ),
    );

  const expectedAllowedNodes =
    Array.from(
      new Set(
        (
          input.allowedNodes
          || [
            "slr",
            "shawn",
          ]
        ).filter(
          (node) =>
            node === "slr"
            || node === "shawn",
        ),
      ),
    );

  const expectedModel =
    String(
      input.model
      || "",
    ).trim() || null;

  const expectedExecutionTimeout =
    Math.max(
      1_000,
      Math.floor(
        Number(
          input.executionTimeoutMs,
        ) || 180_000,
      ),
    );

  const expectedLeaseTtl =
    input.leaseTtlSeconds == null
      ? null
      : Math.max(
          1,
          Math.floor(
            Number(
              input.leaseTtlSeconds,
            ) || 1,
          ),
        );

  const collision =
    existing.ownerKey
      !== expectedOwnerKey
    || existing.requestKind
      !== expectedRequestKind
    || existing.path
      !== input.path
    || stableQwenIdentityJson(
        existing.payload,
      )
      !== stableQwenIdentityJson(
        input.payload || {},
      )
    || existing.requiredContextTokens
      !== expectedContext
    || stableQwenIdentityJson(
        existing.allowedNodes,
      )
      !== stableQwenIdentityJson(
        expectedAllowedNodes,
      )
    || existing.model
      !== expectedModel
    || stableQwenIdentityJson(
        existing.modelByNode,
      )
      !== stableQwenIdentityJson(
        input.modelByNode || {},
      )
    || stableQwenIdentityJson(
        existing.keepAlive,
      )
      !== stableQwenIdentityJson(
        input.keepAlive ?? null,
      )
    || existing.executionTimeoutMs
      !== expectedExecutionTimeout
    || existing.leaseTtlSeconds
      !== expectedLeaseTtl;

  if (collision) {
    throw new Error(
      `Durable Qwen job id collision for ${existing.id}.`,
    );
  }

  return existing;
}

/*
 * OTG_QWEN_DETERMINISTIC_CHILD_JOB_V1
 *
 * Higher-level durable operations can assign a stable child-job ID.
 *
 * Re-ensuring that same exact request returns the existing row.
 * Reusing the ID for a different inference request is rejected.
 */
export function ensureQwenDurableJob(
  input:
    Parameters<
      typeof createQwenDurableJob
    >[0]
    & {
      id: string;
    },
) {
  const requestedId =
    String(
      input.id
      || "",
    ).trim();

  if (!requestedId) {
    throw new Error(
      "A deterministic durable Qwen job id is required.",
    );
  }

  if (
    !/^[A-Za-z0-9._:-]{1,200}$/.test(
      requestedId,
    )
  ) {
    throw new Error(
      "Invalid durable Qwen job id.",
    );
  }

  const existing =
    selectJob(
      requestedId,
    );

  if (existing) {
    return verifyDeterministicQwenJobIdentity(
      existing,
      input,
    );
  }

  try {
    return createQwenDurableJob({
      ...input,
      id:
        requestedId,
    });
  } catch (error) {
    /*
     * Another operation tick may have inserted the deterministic
     * child between our SELECT and INSERT.
     */
    const raced =
      selectJob(
        requestedId,
      );

    if (raced) {
      return verifyDeterministicQwenJobIdentity(
        raced,
        input,
      );
    }

    throw error;
  }
}

export function getQwenDurableJob(
  id: string,
) {
  return selectJob(
    id,
  );
}

export function listQueuedQwenDurableJobs(
  limit = 20,
) {
  return (
    db()
      .prepare(`
        SELECT *
        FROM qwen_cluster_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?
      `)
      .all(
        Math.max(
          1,
          Math.min(
            100,
            limit,
          ),
        ),
      ) as JobRow[]
  )
    .map(fromRow)
    .filter(Boolean) as
      QwenDurableJob[];
}

export function claimQwenDurableJob(
  id: string,
) {
  const timestamp =
    nowIso();

  const transaction =
    db().transaction(() => {
      const result =
        db()
          .prepare(`
            UPDATE qwen_cluster_jobs
            SET
              status = 'claimed',
              status_message = 'Claiming Qwen GPU',
              claimed_at = ?,
              updated_at = ?,
              attempts = attempts + 1,
              error = NULL
            WHERE id = ?
              AND status = 'queued'
              AND assigned_node IS NULL
          `)
          .run(
            timestamp,
            timestamp,
            id,
          );

      return result.changes === 1
        ? selectJob(id)
        : null;
    });

  return transaction.immediate() as QwenDurableJob | null;
}

export function requeueQwenDurableJobBeforeExecution(
  id: string,
  message =
    "Waiting for first available Qwen GPU",
) {
  const timestamp =
    nowIso();

  const result =
    db()
      .prepare(`
        UPDATE qwen_cluster_jobs
        SET
          status = 'queued',
          status_message = ?,
          assigned_node = NULL,
          claimed_at = NULL,
          updated_at = ?,
          error = NULL
        WHERE id = ?
          AND status = 'claimed'
          AND assigned_node IS NULL
          AND started_at IS NULL
      `)
      .run(
        message,
        timestamp,
        id,
      );

  return result.changes === 1
    ? selectJob(id)
    : null;
}

export function markQwenDurableJobRunning(
  id: string,
  node: QwenClusterNode,
) {
  const timestamp =
    nowIso();

  const result =
    db()
      .prepare(`
        UPDATE qwen_cluster_jobs
        SET
          status = 'running',
          status_message = ?,
          assigned_node = ?,
          started_at = COALESCE(
            started_at,
            ?
          ),
          updated_at = ?
        WHERE id = ?
          AND status = 'claimed'
          AND assigned_node IS NULL
      `)
      .run(
        node === "slr"
          ? "Running Qwen on RTX 5060 Ti"
          : "Running Qwen on RTX 3090",
        node,
        timestamp,
        timestamp,
        id,
      );

  return result.changes === 1
    ? selectJob(id)
    : null;
}

export function completeQwenDurableJob(
  input: {
    id: string;
    responseStatus: number;
    responseStatusText?: string;
    responseHeaders?:
      Record<string, string>;
    responseBody: string;
  },
) {
  const timestamp =
    nowIso();

  const result =
    db()
      .prepare(`
        UPDATE qwen_cluster_jobs
        SET
          status = 'completed',
          status_message = 'Qwen request complete',
          response_status = ?,
          response_status_text = ?,
          response_headers_json = ?,
          response_body = ?,
          completed_at = ?,
          updated_at = ?
        WHERE id = ?
          AND status IN (
            'claimed',
            'running'
          )
      `)
      .run(
        input.responseStatus,
        String(
          input.responseStatusText
          || "",
        ),
        JSON.stringify(
          input.responseHeaders
          || {},
        ),
        input.responseBody,
        timestamp,
        timestamp,
        input.id,
      );

  return result.changes === 1
    ? selectJob(
        input.id,
      )
    : null;
}

export function failQwenDurableJob(
  id: string,
  error: string,
) {
  const timestamp =
    nowIso();

  db()
    .prepare(`
      UPDATE qwen_cluster_jobs
      SET
        status = 'failed',
        status_message = 'Qwen request failed',
        error = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
        AND status != 'completed'
    `)
    .run(
      error,
      timestamp,
      timestamp,
      id,
    );

  return selectJob(
    id,
  );
}


/*
 * OTG_QWEN_RESTART_RECOVERY_V1
 *
 * Process-restart rules:
 *
 * queued:
 *   already durable; leave queued.
 *
 * claimed + no assigned node + no started_at:
 *   model execution never crossed the durable running boundary,
 *   so it is safe to return to the queue.
 *
 * running or otherwise ambiguous claimed:
 *   model execution may already have reached Ollama.
 *   Never automatically execute it again.
 */
export function recoverQwenDurableJobsAfterProcessRestart() {
  const timestamp =
    nowIso();

  const transaction =
    db().transaction(() => {
      const requeued =
        db()
          .prepare(`
            UPDATE qwen_cluster_jobs
            SET
              status = 'queued',
              status_message =
                'Recovered after server restart; waiting for first available Qwen GPU',
              assigned_node = NULL,
              claimed_at = NULL,
              updated_at = ?,
              error = NULL
            WHERE status = 'claimed'
              AND assigned_node IS NULL
              AND started_at IS NULL
          `)
          .run(
            timestamp,
          );

      /*
       * Anything still claimed after the safe requeue above is
       * abnormal/ambiguous. Running work is inherently ambiguous
       * after process death because Ollama may have received it.
       */
      const ambiguousError =
        "The server restarted after Qwen model execution may have started. Automatic retry is disabled to prevent duplicate inference.";

      const failedAmbiguous =
        db()
          .prepare(`
            UPDATE qwen_cluster_jobs
            SET
              status = 'failed',
              status_message =
                'Qwen request interrupted after execution may have started',
              error = ?,
              completed_at =
                COALESCE(
                  completed_at,
                  ?
                ),
              updated_at = ?
            WHERE status IN (
              'claimed',
              'running'
            )
          `)
          .run(
            ambiguousError,
            timestamp,
            timestamp,
          );

      const queuedRow =
        db()
          .prepare(`
            SELECT COUNT(*) AS count
            FROM qwen_cluster_jobs
            WHERE status = 'queued'
          `)
          .get() as {
            count?: number;
          };

      return {
        requeued:
          Number(
            requeued.changes
            || 0,
          ),

        failedAmbiguous:
          Number(
            failedAmbiguous.changes
            || 0,
          ),

        queued:
          Math.max(
            0,
            Math.floor(
              Number(
                queuedRow?.count
                || 0,
              ),
            ),
          ),
      };
    });

  return transaction.immediate() as {
    requeued: number;
    failedAmbiguous: number;
    queued: number;
  };
}


export function clearQwenDurableJobsForTests() {
  db()
    .prepare(`
      DELETE FROM qwen_cluster_jobs
    `)
    .run();
}
