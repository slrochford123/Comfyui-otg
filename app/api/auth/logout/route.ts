import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cookieName } from "@/lib/auth/cookies";
import { db, ensureMigrations } from "@/lib/auth/db";
import { verifySession } from "@/lib/auth/jwt";
export async function POST() {

  const store = await cookies();
  const token = store.get(cookieName())?.value || "";

  try {
    if (token) {
      const payload: any = await verifySession(token);
      const userId = String(payload?.sub || "");
      const sid = String(payload?.sid || "");
      if (userId && sid) {
        ensureMigrations();
        db.prepare("UPDATE users SET current_session_id = NULL, current_session_issued_at = NULL WHERE id = ? AND current_session_id = ?").run(userId, sid);
      }
    }
  } catch {
    // ignore
  }

  store.set(cookieName(), "", { path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true });
}
