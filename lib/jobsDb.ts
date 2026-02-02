import { db, ensureMigrations } from "@/lib/auth/db";

export type JobStatus = "submitted" | "running" | "ready" | "error";
export type ArtifactKind = "video" | "image" | "other";
export type ArtifactRole = "primary" | "preview" | "last_frame" | "other";

export type CreateJobArgs = {
  id: string;
  ownerKey: string;
  scope: "user" | "device";
  username: string | null;
  deviceId: string;
  workflowId: string | null;
  title: string | null;
  status: JobStatus;
  promptId: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

export function createJob(args: CreateJobArgs) {
  ensureMigrations();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO jobs (id, owner_key, scope, username, device_id, workflow_id, title, status, prompt_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.id,
    args.ownerKey,
    args.scope,
    args.username,
    args.deviceId,
    args.workflowId,
    args.title,
    args.status,
    args.promptId,
    ts,
    ts
  );
}

export function updateJobStatus(jobId: string, status: JobStatus) {
  ensureMigrations();
  db.prepare(`UPDATE jobs SET status=?, updated_at=? WHERE id=?`).run(status, nowIso(), jobId);
}

export function setJobPromptId(jobId: string, promptId: string) {
  ensureMigrations();
  db.prepare(`UPDATE jobs SET prompt_id=?, updated_at=? WHERE id=?`).run(promptId, nowIso(), jobId);
}

export function upsertArtifact(input: {
  id: string;
  jobId: string;
  ownerKey: string;
  kind: ArtifactKind;
  role: ArtifactRole;
  filename: string;
  relPath: string;
  mime?: string | null;
}) {
  ensureMigrations();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO artifacts (id, job_id, owner_key, kind, role, filename, rel_path, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, filename) DO UPDATE SET
       kind=excluded.kind,
       role=excluded.role,
       rel_path=excluded.rel_path,
       mime=excluded.mime`
  ).run(
    input.id,
    input.jobId,
    input.ownerKey,
    input.kind,
    input.role,
    input.filename,
    input.relPath,
    input.mime ?? null,
    ts
  );
}

export function hasPrimaryArtifact(jobId: string) {
  ensureMigrations();
  const row = db
    .prepare(`SELECT id FROM artifacts WHERE job_id=? AND role='primary' LIMIT 1`)
    .get(jobId) as any;
  return !!row?.id;
}

export function promotePrimaryArtifact(jobId: string, filename: string) {
  ensureMigrations();
  db.prepare(`UPDATE artifacts SET role='other' WHERE job_id=? AND role='primary'`).run(jobId);
  db.prepare(`UPDATE artifacts SET role='primary' WHERE job_id=? AND filename=?`).run(jobId, filename);
}
