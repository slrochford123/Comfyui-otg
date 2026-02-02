import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { db, ensureMigrations } from "@/lib/auth/db";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { resetState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Hard-coded admin for your install (requested)
const HARD_CODED_ADMINS = ["slrochford123@protonmail.com", "slrochford123"];
const ADMIN_IDENTIFIERS = (process.env.ADMIN_IDENTIFIERS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function requireAdmin() {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token) return { ok: false as const, status: 401, error: "Not signed in" };

  let payload: any;
  try {
    ensureMigrations();
    payload = await verifySession(token);
  } catch {
    return { ok: false as const, status: 401, error: "Invalid session" };
  }

  const email = String(payload?.email || "").toLowerCase();
  const username = String(payload?.username || "").toLowerCase();
  const allowList = new Set([...HARD_CODED_ADMINS, ...ADMIN_IDENTIFIERS]);
  const allowed = allowList.has(email) || (username && allowList.has(username));

  if (!allowed) return { ok: false as const, status: 403, error: "Not authorized" };

  return { ok: true as const, status: 200 };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  try {
    ensureMigrations();
    const body = await req.json().catch(() => ({} as any));
    const id = String(body?.id || "").trim();
    const usernameIn = String(body?.username || "").trim();

    let username = usernameIn;
    if (!username && id) {
      const row = db.prepare("SELECT username FROM users WHERE id = ?").get(id) as any;
      username = String(row?.username || "").trim();
    }

    if (!username) {
      return NextResponse.json({ ok: false, error: "Target user must have a username." }, { status: 400 });
    }

    const next = resetState(username);
    return NextResponse.json({ ok: true, username, status: next.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Reset failed", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
