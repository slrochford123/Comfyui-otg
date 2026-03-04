import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { isAdminEmail } from "@/lib/auth/admin";

// Optional extra admins via env (comma-separated emails and/or usernames)
function isAdminIdentifier(username?: string | null): boolean {
  const hard = new Set(["slrochford123@protonmail.com", "slrochford123"]);
  const extra = (process.env.ADMIN_IDENTIFIERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allow = new Set<string>([...hard, ...extra]);
  const u = String(username || "").trim().toLowerCase();
  return !!u && allow.has(u);
}

// Alias endpoint used by the UI/router as the single source of truth.
// Keep this in sync with /api/auth/me.
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

    const admin = isAdminEmail(email) || isAdminIdentifier(username);

    return NextResponse.json(
      { ok: true, user: { email, username, tier, admin } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { ok: false, user: null },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
