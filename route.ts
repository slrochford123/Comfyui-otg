import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const store = await cookies();
  const token = store.get(cookieName())?.value;

  // No cookie at all
  if (!token) {
    return NextResponse.json(
      { ok: false, user: null },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const payload = await verifySession(token);

    const email = (payload as any).email ?? payload.sub;
    const username = (payload as any).username ?? null;
    const tier = (payload as any).tier ?? null;

    return NextResponse.json(
      { ok: true, user: { email, username, tier } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // If the cookie exists but is invalid/stale, clear it.
    // This prevents the app from getting stuck in a loop where every API call returns 401.
    try {
      store.set(cookieName(), "", { path: "/", maxAge: 0 });
    } catch {}
    return NextResponse.json(
      { ok: false, user: null },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
