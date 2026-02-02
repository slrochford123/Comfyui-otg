import fs from "node:fs";
import path from "node:path";

/**
 * OTG runs on Windows machines where COMFY_OUTPUT_DIR / OTG_DATA_DIR can be
 * accidentally left set as user/system environment variables.
 *
 * Next.js does not override existing env vars with values from .env.local.
 * That means a stale COMFY_OUTPUT_DIR can silently break gallery/preview.
 *
 * This loader force-applies .env.local (if present) over the current process.env
 * for a small allowlist of OTG runtime variables.
 */

let didLoad = false;

function stripQuotes(v: string) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return out;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = stripQuotes(trimmed.slice(eq + 1));
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

/** Apply .env.local values over process.env (override=true behavior). */
export function ensureRuntimeEnvLoaded() {
  if (didLoad) return;
  didLoad = true;

  const envLocal = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envLocal)) return;

  const parsed = parseEnvFile(envLocal);
  const allow = new Set([
    "PORT",
    "OTG_DATA_DIR",
    "OTG_DEVICE_OUTPUT_ROOT",
    "COMFY_BASE_URL",
    "COMFY_OUTPUT_DIR",
    "COMFY_OUTPUT_DIRS",
    "COMFY_WORKFLOWS_DIR",
    "OTG_WORKFLOWS_ROOT",
    "PATH_ALLOWLIST",
    "AUTH_COOKIE_NAME",
    "AUTH_SECRET",
    "OTG_ALLOW_ANY_USER",
    "ADMIN_IDENTIFIERS",
    "ADMIN_EMAILS",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
  ]);

  for (const [k, v] of Object.entries(parsed)) {
    if (!allow.has(k)) continue;
    if (typeof v !== "string") continue;
    // override whatever is in the environment
    process.env[k] = v;
  }
}
