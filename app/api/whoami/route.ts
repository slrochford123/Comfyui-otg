import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { authCookieOptions, cookieName } from "@/lib/auth/cookies";
import { signSession, verifySession } from "@/lib/auth/jwt";

// Alias endpoint used by the UI/router as the single source of truth.
// Keep this in sync with /api/auth/me.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const store = await cookies();
    const token = store.get(cookieName())?.value;

    if (!token) {
      return NextResponse.json(
        { ok: false, user: null },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const payload = await verifySession(token);

    const sub = String(payload.sub || "");
    const sid = String((payload as any).sid || "");
    const email = String((payload as any).email ?? payload.sub ?? "");
    const username = (payload as any).username ?? null;
    const tier = (payload as any).tier ?? null;

    const refreshedToken = await signSession({
      sub,
      email,
      username,
      tier,
      sid,
    });

    const res = NextResponse.json(
      { ok: true, user: { email, username, tier } },
      { headers: { "Cache-Control": "no-store" } }
    );

    res.cookies.set(cookieName(), refreshedToken, authCookieOptions(req));
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, user: null },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}