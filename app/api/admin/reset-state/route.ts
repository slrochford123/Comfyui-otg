import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { NextRequest, NextResponse } from "next/server";

import { db, ensureMigrations } from "@/lib/auth/db";
import { resetState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  try {
    ensureMigrations();
    const body = await req.json().catch(() => ({} as any));
    const id = String(body?.id || "").trim();
    const usernameIn = String(body?.username || "").trim();

    let username = usernameIn;
    if (id) {
      const row = db.prepare("SELECT username FROM users WHERE id = ?").get(id) as any;
      if (!row) return NextResponse.json({ ok: false, error: "Target user not found." }, { status: 404 });
      username = String(row?.username || "").trim();
      if (usernameIn && usernameIn !== username) {
        return NextResponse.json({ ok: false, error: "Target user identity mismatch." }, { status: 400 });
      }
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
