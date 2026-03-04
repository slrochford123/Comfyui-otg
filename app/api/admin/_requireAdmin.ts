import { cookies } from "next/headers";

import { ensureMigrations } from "@/lib/auth/db";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

// Primary admin for this install (requested)
const HARD_CODED_ADMINS = ["slrochford123@protonmail.com", "slrochford123"];

// Optional extra admins via env (comma-separated emails and/or usernames)
const ADMIN_IDENTIFIERS = (process.env.ADMIN_IDENTIFIERS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export type AdminAuthResult =
  | { ok: true; status: 200; email: string; username: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdmin(): Promise<AdminAuthResult> {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token) return { ok: false, status: 401, error: "Not signed in" };

  let payload: any;
  try {
    ensureMigrations();
    payload = await verifySession(token);
  } catch {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const email = String(payload?.email || "").toLowerCase();
  const username = String(payload?.username || "").toLowerCase();

  const allowList = new Set([...HARD_CODED_ADMINS, ...ADMIN_IDENTIFIERS]);
  const allowed = allowList.has(email) || (username && allowList.has(username));
  if (!allowed) return { ok: false, status: 403, error: "Not authorized" };

  return { ok: true, status: 200, email, username };
}
