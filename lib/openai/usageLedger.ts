import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { RequestError } from "@/lib/requestError";
import type { OpenAIUsageRecord } from "@/lib/openai/provider";

function withLedger<T>(fn: (db: Database.Database) => T): T {
  const root = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || path.join(os.homedir(), "AI/runtime/test/data");
  const dir = path.join(root, "openai");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "usage.sqlite");
  const db = new Database(file);
  try {
    fs.chmodSync(file, 0o600);
    db.pragma("busy_timeout = 5000"); db.pragma("journal_mode = WAL"); db.pragma("synchronous = FULL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, owner TEXT NOT NULL, cost REAL NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_owner_time ON usage_records(owner, ts);
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, owner TEXT NOT NULL, use_case TEXT NOT NULL, cost REAL NOT NULL, status TEXT NOT NULL, provider_id TEXT);
      CREATE INDEX IF NOT EXISTS reservation_owner_time ON reservations(owner, ts);
    `);
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM ledger_meta WHERE key='legacy_import'").get()) return;
      const legacy = path.join(dir, "usage.json");
      if (fs.existsSync(legacy)) {
        // A corrupt or unreadable ledger must block spending, not reset it.
        const parsed = JSON.parse(fs.readFileSync(legacy, "utf8"));
        if (!Array.isArray(parsed?.records)) throw new Error("Invalid legacy OpenAI usage ledger; repair required before spending.");
        const insert = db.prepare("INSERT OR IGNORE INTO usage_records VALUES (?, ?, ?, ?, ?)");
        parsed.records.forEach((record: OpenAIUsageRecord, index: number) => {
          if (!record || typeof record.ownerKey !== "string" || !Number.isFinite(record.ts) || !Number.isFinite(record.approximateCostUsd) || record.approximateCostUsd < 0) throw new Error("Invalid legacy OpenAI usage record; repair required before spending.");
          const json = JSON.stringify(record);
          insert.run("legacy-" + createHash("sha256").update(index + ":" + json).digest("hex"), record.ts, record.ownerKey, record.approximateCostUsd, json);
        });
      }
      db.prepare("INSERT INTO ledger_meta VALUES ('legacy_import', ?)").run(new Date().toISOString());
    }).immediate();
    return fn(db);
  } finally { db.close(); }
}

export function readLedgerUsage(): OpenAIUsageRecord[] {
  return withLedger(db => (db.prepare("SELECT record FROM usage_records ORDER BY ts, id").all() as Array<{ record: string }>).map(row => JSON.parse(row.record)));
}

export function reserveOpenAIUsage(args: { ownerKey: string; useCase: string; reservedUsd: number; userLimit: number; globalLimit: number; maxRequests: number; windowMs: number }) {
  if (!args.ownerKey || !Number.isFinite(args.reservedUsd) || args.reservedUsd < 0) throw new RequestError("Invalid OpenAI request budget.", 400);
  return withLedger(db => db.transaction(() => {
    const now = Date.now(), since = now - 86400000;
    const requests = db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE owner=? AND use_case=? AND ts>=?").get(args.ownerKey, args.useCase, now - args.windowMs) as { count: number };
    if (requests.count >= args.maxRequests) throw new RequestError("OpenAI rate limit reached. Please wait and retry.", 429);
    const totals = db.prepare(`SELECT SUM(cost) AS total, SUM(CASE WHEN owner=? THEN cost ELSE 0 END) AS own FROM (
      SELECT owner,cost FROM usage_records WHERE ts>=? UNION ALL
      SELECT owner,cost FROM reservations WHERE ts>=? AND status IN ('pending','unknown')
    )`).get(args.ownerKey, since, since) as { total: number | null; own: number | null };
    if (args.userLimit > 0 && Number(totals.own || 0) + args.reservedUsd > args.userLimit) throw new RequestError("Daily OpenAI cost limit reached for this user, including in-flight requests.", 429);
    if (args.globalLimit > 0 && Number(totals.total || 0) + args.reservedUsd > args.globalLimit) throw new RequestError("Daily OpenAI global cost limit reached, including in-flight requests.", 429);
    const id = randomUUID();
    db.prepare("INSERT INTO reservations (id,ts,owner,use_case,cost,status) VALUES (?,?,?,?,?,'pending')").run(id, now, args.ownerKey, args.useCase, args.reservedUsd);
    return id;
  }).immediate());
}

export function settleOpenAIUsage(id: string, record: OpenAIUsageRecord, providerId?: string) {
  if (!Number.isFinite(record.approximateCostUsd) || record.approximateCostUsd < 0) throw new Error("Invalid OpenAI usage cost.");
  withLedger(db => db.transaction(() => {
    const reservation = db.prepare("SELECT owner FROM reservations WHERE id=?").get(id) as { owner: string } | undefined;
    if (!reservation || reservation.owner !== record.ownerKey) throw new Error("OpenAI reservation owner mismatch.");
    db.prepare("INSERT OR IGNORE INTO usage_records VALUES (?,?,?,?,?)").run(id, record.ts, record.ownerKey, record.approximateCostUsd, JSON.stringify({ ...record, requestId: id, providerRequestId: providerId }));
    db.prepare("UPDATE reservations SET status='settled', provider_id=? WHERE id=?").run(providerId || null, id);
  }).immediate());
}

export function finishUnsettledOpenAIUsage(id: string, definitelyRejected = false) {
  withLedger(db => db.prepare("UPDATE reservations SET status=? WHERE id=? AND status='pending'").run(definitelyRejected ? "rejected" : "unknown", id));
}

export function readOpenAIReservationSummary() {
  return withLedger(db => db.prepare("SELECT status, COUNT(*) AS requests, SUM(cost) AS reservedUsd FROM reservations WHERE ts>=? AND status IN ('pending','unknown') GROUP BY status").all(Date.now() - 86400000) as Array<{status: "pending" | "unknown"; requests: number; reservedUsd: number}>);
}
