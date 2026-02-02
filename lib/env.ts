import fs from "node:fs";
import path from "node:path";

/**
 * Best-effort env loader.
 * Fixes cases where OTG is launched from a different CWD (tray/pm2/service)
 * and OTG_DATA_DIR is not actually present in process.env.
 *
 * We ONLY fill missing env vars (do not override existing process.env values).
 */
let loaded = false;

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    // strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function tryLoad(p: string): Record<string, string> | null {
  try {
    if (!fs.existsSync(p)) return null;
    const txt = fs.readFileSync(p, "utf-8");
    return parseEnvFile(txt);
  } catch {
    return null;
  }
}

export function ensureEnvLoaded() {
  if (loaded) return;
  loaded = true;

  // Only load if OTG_DATA_DIR missing (the root cause we want to fix).
  if (process.env.OTG_DATA_DIR && process.env.OTG_DATA_DIR.trim().length > 0) return;

  const candidates: string[] = [];

  // 1) CWD
  candidates.push(path.resolve(process.cwd(), ".env.local"));
  candidates.push(path.resolve(process.cwd(), ".env"));

  // 2) One level up (common in monorepo / inferred root situations)
  candidates.push(path.resolve(process.cwd(), "..", ".env.local"));
  candidates.push(path.resolve(process.cwd(), "..", ".env"));

  // 3) Alongside the running script (best effort)
  try {
    const dir = path.dirname(process.argv[1] || "");
    if (dir) {
      candidates.push(path.resolve(dir, ".env.local"));
      candidates.push(path.resolve(dir, ".env"));
      candidates.push(path.resolve(dir, "..", ".env.local"));
      candidates.push(path.resolve(dir, "..", ".env"));
    }
  } catch {}

  for (const p of candidates) {
    const env = tryLoad(p);
    if (!env) continue;
    // only set keys that are missing
    for (const [k, v] of Object.entries(env)) {
      if (!process.env[k] || String(process.env[k]).trim().length === 0) {
        process.env[k] = v;
      }
    }
    // If we managed to load OTG_DATA_DIR, stop.
    if (process.env.OTG_DATA_DIR && process.env.OTG_DATA_DIR.trim().length > 0) return;
  }
}
