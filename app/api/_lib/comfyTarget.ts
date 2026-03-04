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
