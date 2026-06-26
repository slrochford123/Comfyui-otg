import { cookies } from "next/headers";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import fs from "node:fs";
import path from "node:path";

// Primary admin for this install (matches /api/admin/_requireAdmin)
const HARD_CODED_ADMINS = ["slrochford123@protonmail.com", "slrochford123"];

const ADMIN_IDENTIFIERS = (process.env.ADMIN_IDENTIFIERS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export type ComfyTarget = { id: string; label: string; baseUrl: string };

function parseTargetsFromEnv(): ComfyTarget[] {
  const filePathRaw = (process.env.OTG_COMFY_TARGETS_FILE || "").trim();
  let raw = (process.env.OTG_COMFY_TARGETS || "").trim();

  // Prefer a JSON file to avoid dotenv newline/quoting pitfalls.
  if (filePathRaw) {
    try {
      const p = path.isAbsolute(filePathRaw) ? filePathRaw : path.join(process.cwd(), filePathRaw);
      raw = fs.readFileSync(p, "utf-8").trim();
    } catch {
      // fall back to OTG_COMFY_TARGETS
    }
  }

  if (!raw) return [];

  // dotenv sometimes wraps JSON in quotes; unwrap one matching pair.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: ComfyTarget[] = [];
    for (const x of arr) {
      const id = String(x?.id || "").trim();
      const label = String(x?.label || id).trim();
      const baseUrl = String(x?.baseUrl || "").trim();
      if (!id || !baseUrl) continue;
      out.push({ id, label, baseUrl });
    }
    return out;
  } catch {
    return [];
  }
}

export function comfyTargets(): ComfyTarget[] {
  return parseTargetsFromEnv();
}

// Back-compat export for routes/components that expect this name
export function getComfyTargets(): ComfyTarget[] {
  return comfyTargets();
}

// Exported so admin-only routes can gate access consistently.
export async function isAdminSession(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token) return false;

  try {
    const payload: any = await verifySession(token);
    const email = String(payload?.email || "").toLowerCase();
    const username = String(payload?.username || "").toLowerCase();
    const allowList = new Set([...HARD_CODED_ADMINS, ...ADMIN_IDENTIFIERS]);
    return allowList.has(email) || (!!username && allowList.has(username));
  } catch {
    return false;
  }
}

export const COMFY_TARGET_COOKIE = "otg_comfy_target";

export async function resolveComfyBaseUrl(): Promise<{ baseUrl: string; targetId: string | null }> {
  const fallback = (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").trim();
  const targets = comfyTargets();

  // Non-admins never override
  const admin = await isAdminSession();
  if (!admin) return { baseUrl: fallback, targetId: null };

  const store = await cookies();
  const selected = (store.get(COMFY_TARGET_COOKIE)?.value || "").trim();
  if (!selected) return { baseUrl: fallback, targetId: null };

  const found = targets.find((t) => t.id === selected);
  if (!found) return { baseUrl: fallback, targetId: null };

  return { baseUrl: found.baseUrl, targetId: found.id };
}


function normalizeUrlValue(v: string): string {
  return (v || "").trim().replace(/\/+$/, "");
}

function preferredTestingRenderBaseUrl(): string {
  const explicit = normalizeUrlValue(
    process.env.OTG_RENDER_COMFY_URL ||
      process.env.OTG_TEST_RENDER_COMFY_URL ||
      process.env.OTG_IMAGE_COMFY_BASE_URL ||
      process.env.OTG_VIDEO_COMFY_BASE_URL ||
      process.env.OTG_IMAGE_COMFY_URL ||
      process.env.OTG_VIDEO_COMFY_URL ||
      ""
  );
  if (explicit) return explicit;

  const targets = comfyTargets();
  const preferred =
    targets.find((t) => t.id.toLowerCase() === "5060ti") ||
    targets.find((t) => /:8288$/.test(normalizeUrlValue(t.baseUrl))) ||
    targets.find((t) => /5060/i.test(`${t.id} ${t.label}`));

  if (preferred?.baseUrl) return normalizeUrlValue(preferred.baseUrl);

  return "http://127.0.0.1:8288";
}

export function configuredVoiceComfyBaseUrl(): string {
  const explicit = normalizeUrlValue(
    process.env.OTG_VOICE_COMFY_URL ||
      process.env.OTG_VOICES_COMFY_URL ||
      process.env.OTG_TTS_COMFY_URL ||
      ""
  );
  if (explicit) return explicit;

  const targets = comfyTargets();
  const preferred =
    targets.find((t) => t.id.toLowerCase() === "5060ti") ||
    targets.find((t) => /:8288$/.test(normalizeUrlValue(t.baseUrl))) ||
    targets.find((t) => /5060/i.test(`${t.id} ${t.label}`));
  if (preferred?.baseUrl) return normalizeUrlValue(preferred.baseUrl);

  return "http://127.0.0.1:8288";
}

export async function resolveVoiceComfyBaseUrl(): Promise<{ baseUrl: string; targetId: string | null }> {
  const baseUrl = configuredVoiceComfyBaseUrl();
  const targets = comfyTargets();
  const found = targets.find((t) => normalizeUrlValue(t.baseUrl) === baseUrl);
  return { baseUrl, targetId: found?.id || null };
}


export function configuredImageComfyBaseUrl(): string {
  const explicit = normalizeUrlValue(
    process.env.OTG_IMAGE_COMFY_BASE_URL ||
      process.env.OTG_IMAGE_COMFY_URL ||
      process.env.IMAGE_COMFY_BASE_URL ||
      process.env.COMFY_IMAGE_BASE_URL ||
      process.env.OTG_3060TI_COMFY_URL ||
      ""
  );
  if (explicit) return explicit;

  return preferredTestingRenderBaseUrl();
}
export async function resolveImageComfyBaseUrl(): Promise<{ baseUrl: string; targetId: string | null }> {
  const baseUrl = configuredImageComfyBaseUrl();
  const targets = comfyTargets();
  const found = targets.find((t) => normalizeUrlValue(t.baseUrl) === baseUrl);
  return { baseUrl, targetId: found?.id || null };
}


export function configuredVideoComfyBaseUrl(): string {
  const explicit = normalizeUrlValue(
    process.env.OTG_VIDEO_COMFY_BASE_URL ||
      process.env.OTG_VIDEO_COMFY_URL ||
      process.env.VIDEO_COMFY_BASE_URL ||
      process.env.COMFY_VIDEO_BASE_URL ||
      process.env.COMFY_BASE_URL ||
      process.env.COMFY_URL ||
      ""
  );
  if (explicit) return explicit;

  return preferredTestingRenderBaseUrl();
}


export function isLikelyVideoWorkflowKey(idRaw: unknown, labelRaw?: unknown): boolean {
  const id = String(idRaw || "").trim().toLowerCase();
  const label = String(labelRaw || "").trim().toLowerCase();
  const key = `${id} ${label}`.trim();
  if (!key) return false;

  return (
    key.includes("create a video") ||
    key.includes("video from pictures") ||
    key.includes("extend a video") ||
    key.includes("animate") ||
    key.includes("ltx") ||
    key.includes("vhs_") ||
    key.includes("video")
  );
}