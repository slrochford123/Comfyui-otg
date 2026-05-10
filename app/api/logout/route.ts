import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { clearAuthCookieOptions, cookieName } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const name = cookieName();

  try {
    const store = await cookies();
    const token = store.get(name)?.value;

    if (token) {
      const { verifySession } = await import("@/lib/auth/jwt");
      const payload = await verifySession(token);

      const userId = String(payload.sub || "");
      const sid = String((payload as any).sid || "");

      if (userId && sid) {
        const { db, ensureMigrations } = await import("@/lib/auth/db");
        ensureMigrations();

        db.prepare(
          "UPDATE users SET current_session_id = NULL, current_session_issued_at = NULL WHERE id = ? AND current_session_id = ?"
        ).run(userId, sid);
      }
    }
  } catch {
    // Logout must still clear browser cookies even if DB/session verification fails.
  }

  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

  const namesToClear = new Set([name, "otg_session", "otg_session_test", `${name}_test`]);
  for (const n of namesToClear) {
    res.cookies.set(n, "", clearAuthCookieOptions(req));
  }

  return res;
}