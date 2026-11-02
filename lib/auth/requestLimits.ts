import { createHash } from "node:crypto";
import { db, ensureMigrations } from "@/lib/auth/db";
import { RequestError } from "@/lib/requestError";

/** Durable, bounded windows survive process restarts and concurrent requests. */
export function enforceRequestLimit(scope: string, identity: string, max: number, windowMs: number) {
  ensureMigrations();
  const bucket = scope + ":" + createHash("sha256").update(identity).digest("hex");
  const now = Date.now();
  const count = db.transaction(() => {
    const row = db.prepare("SELECT window_start, attempts FROM request_limits WHERE bucket = ?").get(bucket) as { window_start: number; attempts: number } | undefined;
    const start = row && now - row.window_start < windowMs ? row.window_start : now;
    const attempts = start === row?.window_start ? row.attempts + 1 : 1;
    db.prepare("INSERT INTO request_limits (bucket, window_start, attempts) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start, attempts=excluded.attempts").run(bucket, start, attempts);
    db.prepare("DELETE FROM request_limits WHERE window_start < ?").run(now - 86400000);
    return attempts;
  }).immediate();
  if (count > max) throw new RequestError("Too many attempts. Please wait before trying again.", 429);
}
