import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { isAdminUserId } from "@/lib/auth/admin";
import { NextRequest, NextResponse } from "next/server";

import { db, ensureMigrations } from "@/lib/auth/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  try {
    ensureMigrations();

    const rows = db
      .prepare("SELECT id, email, username, created_at, current_session_issued_at FROM users ORDER BY datetime(created_at) DESC")
      .all() as any[];

    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username ?? null,
      createdAt: r.created_at,
      lastSignInAt: r.current_session_issued_at || null,
      role: isAdminUserId(r.id) ? "Admin" : "Standard",
      status: "Registered",
      protected: isAdminUserId(r.id),
    }));

    return NextResponse.json({ ok: true, count: users.length, users }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Failed to load users", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  try {
    ensureMigrations();

    const body = await req.json().catch(() => ({} as any));
    const id = String(body?.id || "").trim();

    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing user id." }, { status: 400 });
    }

    // prevent deleting the hard-coded admin account (avoid lockout)
    const target = db.prepare("SELECT id, email, username FROM users WHERE id = ?").get(id) as any;
    if (!target) {
      return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
    }

    if (isAdminUserId(target.id) || target.id === admin.id) {
      return NextResponse.json(
        { ok: false, error: "Refusing to delete the primary admin account." },
        { status: 400 }
      );
    }

    const info = db.prepare("DELETE FROM users WHERE id = ?").run(id);

    return NextResponse.json({ ok: true, deleted: info?.changes ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Failed to delete user", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
