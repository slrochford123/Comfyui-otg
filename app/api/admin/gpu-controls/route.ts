import { execFile } from "node:child_process";
import fs from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const execFileAsync = promisify(execFile);
const HELPER = "/usr/local/sbin/otg-gpu-control";
const ACTIONS = new Set(["free", "reset"] as const);
const GPU_CONTROL_ENV_KEYS = [
  "OTG_GPU_CONTROLS_ENABLED",
  "OTG_GPU_CONTROLS_HOSTNAME",
  "OTG_GPU_CONTROLS_ALLOWED_ORIGINS",
] as const;

type Action = "status" | "free" | "reset";

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

let gpuEnvLoaded = false;

function parseEnvValue(raw: string) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadGpuControlEnv() {
  if (gpuEnvLoaded) return;
  gpuEnvLoaded = true;

  const roots = [
    process.env.OTG_WORK_REPO,
    process.cwd(),
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const root of roots) {
    const file = path.join(root, ".env.local");
    let contents = "";
    try {
      contents = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!GPU_CONTROL_ENV_KEYS.includes(key as (typeof GPU_CONTROL_ENV_KEYS)[number])) continue;
      if (!process.env[key] || String(process.env[key]).trim().length === 0) {
        process.env[key] = parseEnvValue(trimmed.slice(eq + 1));
      }
    }
  }
}

function isConfigured() {
  loadGpuControlEnv();
  // The web app must run on the same explicitly designated host as these local
  // systemd units. Never silently fall back to another machine (e.g., PROD 5060).
  const target = String(process.env.OTG_GPU_CONTROLS_HOSTNAME || "").trim();
  const origins = String(process.env.OTG_GPU_CONTROLS_ALLOWED_ORIGINS || "")
    .split(",").map((part) => part.trim()).filter(Boolean);
  return process.env.OTG_GPU_CONTROLS_ENABLED === "1" &&
    Boolean(target && target === hostname() && origins.length);
}

function parseOutput(stdout: string) {
  const fields: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  const numeric = (key: string): number | null => {
    const value = Number(fields[key]);
    return fields[key] && Number.isFinite(value) && value >= 0 ? value : null;
  };
  return {
    host: fields.HOST || hostname(),
    services: {
      comfy8188: { state: fields.SERVICE_8188 || "unknown", http: fields.HTTP_8188 || "unknown" },
      h38189: { state: fields.SERVICE_8189 || "unknown", http: fields.HTTP_8189 || "unknown" },
    },
    gpu: {
      name: fields.GPU_NAME || "Unavailable",
      usedMiB: numeric("GPU_USED_MIB"),
      totalMiB: numeric("GPU_TOTAL_MIB"),
    },
  };
}

async function invoke(action: Action) {
  const { stdout, stderr } = await execFileAsync(
    "/usr/bin/sudo",
    ["-n", HELPER, action],
    {
      shell: false,
      timeout: action === "reset" ? 160_000 : 20_000,
      maxBuffer: 24 * 1024,
      encoding: "utf8",
    },
  );
  if (stderr.trim()) console.warn("[otg-gpu-controls] helper stderr", stderr.slice(0, 800));
  return parseOutput(stdout);
}

async function authenticate() {
  const admin = await requireAdmin();
  if (!admin.ok) return { admin: null, error: response({ ok: false, error: admin.error }, admin.status) };
  return { admin, error: null };
}

function configurationError() {
  return response({ ok: false, error: "GPU controls not configured for this server." }, 503);
}

export async function GET() {
  const { error } = await authenticate();
  if (error) return error;
  if (!isConfigured()) return configurationError();
  try {
    const status = await invoke("status");
    return response({ ok: true, status });
  } catch (error) {
    console.error("[otg-gpu-controls] status failed", error);
    return response({ ok: false, error: "Unable to read GPU or ComfyUI status; check the installed helper and sudoers." }, 503);
  }
}

export async function POST(request: NextRequest) {
  const { admin, error } = await authenticate();
  if (error) return error;
  if (!isConfigured()) return configurationError();

  // Cookie-authenticated destructive actions: require an explicit origin
  // allowlist and a custom header that cross-origin forms cannot send.
  const origin = request.headers.get("origin") || "";
  const allowedOrigins = String(process.env.OTG_GPU_CONTROLS_ALLOWED_ORIGINS || "")
    .split(",").map((part) => part.trim()).filter(Boolean);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || !allowedOrigins.includes(origin) ||
      request.headers.get("x-otg-gpu-control") !== "1" ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
      (fetchSite !== null && !["same-origin", "none"].includes(fetchSite))) {
    return response({ ok: false, error: "Request origin verification failed." }, 403);
  }

  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "free" && action !== "reset" || !ACTIONS.has(action)) {
    return response({ ok: false, error: "Unrecognized GPU operation." }, 400);
  }

  const event = { operator: admin?.email || admin?.username || "unknown", action, host: hostname(), time: new Date().toISOString() };
  console.info("[otg-gpu-controls] requested", event);
  try {
    const status = await invoke(action);
    console.info("[otg-gpu-controls] completed", event);
    return response({ ok: true, action, status });
  } catch (e) {
    console.error("[otg-gpu-controls] failed", { ...event, error: e instanceof Error ? e.message : String(e) });
    return response({ ok: false, error: "ComfyUI operation failed or timed out. Inspect server logs and service status." }, 503);
  }
}
