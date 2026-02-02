import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
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

    const email = (payload as any).email ?? payload.sub;
    const username = (payload as any).username ?? null;
    const tier = (payload as any).tier ?? null;

    return NextResponse.json(
      { ok: true, user: { email, username, tier } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { ok: false, user: null },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
