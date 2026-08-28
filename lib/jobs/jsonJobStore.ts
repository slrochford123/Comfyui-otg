import fs from 'node:fs';
import path from 'node:path';
import type { JobKind, JobRecord, JobStatus } from './types';
import { createJobId, nowIso } from './types';

export type JobCreateInput = {
  ownerKey: string;
  deviceId?: string | null;
  kind: JobKind;
  title?: string | null;
  backend?: string | null;
  requestPayload?: unknown;
};

export type JobUpdateInput = Partial<Pick<JobRecord, 'status' | 'backend' | 'promptId' | 'outputPaths' | 'error' | 'requestPayload'>> & {
  incrementAttempts?: boolean;
};

export class JsonJobStore {
  constructor(private readonly root = process.env.OTG_DATA_DIR || path.join(process.cwd(), 'data')) {}

  private get dir() {
    return path.join(this.root, 'jobs');
  }

  private get logPath() {
    return path.join(this.dir, 'jobs.jsonl');
  }

  private ensure() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private append(record: JobRecord) {
    this.ensure();
    fs.appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf8');
  }

  list(ownerKey?: string): JobRecord[] {
    if (!fs.existsSync(this.logPath)) return [];
    const latest = new Map<string, JobRecord>();
    for (const line of fs.readFileSync(this.logPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as JobRecord;
        if (!ownerKey || record.ownerKey === ownerKey) latest.set(record.id, record);
      } catch {
        // tolerate old or partial lines
      }
    }
    return Array.from(latest.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string, ownerKey?: string) {
    return this.list(ownerKey).find((job) => job.id === id) || null;
  }

  create(input: JobCreateInput) {
    const ts = nowIso();
    const record: JobRecord = {
      id: createJobId(input.kind),
      ownerKey: input.ownerKey,
      deviceId: input.deviceId ?? null,
      kind: input.kind,
      status: 'queued',
      title: input.title ?? null,
      backend: input.backend ?? null,
      requestPayload: input.requestPayload,
      outputPaths: [],
      error: null,
      attempts: 0,
      createdAt: ts,
      updatedAt: ts,
      startedAt: null,
      finishedAt: null,
    };
    this.append(record);
    return record;
  }

  update(id: string, ownerKey: string, patch: JobUpdateInput) {
    const current = this.get(id, ownerKey);
    if (!current) return null;
    const status = patch.status || current.status;
    const ts = nowIso();
    const next: JobRecord = {
      ...current,
      ...patch,
      status,
      attempts: patch.incrementAttempts ? current.attempts + 1 : current.attempts,
      updatedAt: ts,
      startedAt: status === 'running' && !current.startedAt ? ts : current.startedAt,
      finishedAt: isTerminal(status) ? ts : current.finishedAt,
    };
    delete (next as any).incrementAttempts;
    this.append(next);
    return next;
  }
}

export function isTerminal(status: JobStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export const defaultJobStore = new JsonJobStore();
