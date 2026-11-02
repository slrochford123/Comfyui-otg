import { cookies } from "next/headers";
import { db, ensureMigrations } from "@/lib/auth/db";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { isAdminUserId } from "@/lib/auth/admin";

export type AdminAuthResult =
  | { ok: true; status: 200; id: string; email: string; username: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdmin(): Promise<AdminAuthResult> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token) return { ok: false, status: 401, error: "Not signed in" };
  try {
    const payload = await verifySession(token);
    ensureMigrations();
    const id = String(payload.sub || "");
    if (!isAdminUserId(id)) return { ok: false, status: 403, error: "Not authorized" };
    const user = db.prepare("SELECT email, username FROM users WHERE id=?").get(id) as { email: string; username: string };
    return { ok: true, status: 200, id, email: user.email, username: user.username };
  } catch { return { ok: false, status: 401, error: "Invalid session" }; }
}
