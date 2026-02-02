import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { db, ensureMigrations } from "@/lib/auth/db";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Hard-coded admin for your install (requested)
const HARD_CODED_ADMINS = ["slrochford123@protonmail.com", "slrochford123"];

// Optional extra admins via env (comma-separated emails and/or usernames)
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

  return { ok: true as const, status: 200, email, username };
}

export async function GET(_req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  try {
    ensureMigrations();

    const rows = db
      .prepare("SELECT id, email, username, created_at FROM users ORDER BY datetime(created_at) DESC")
      .all() as any[];

    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username ?? null,
      createdAt: r.created_at,
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

    const targetEmail = String(target.email || "").toLowerCase();
    const targetUsername = String(target.username || "").toLowerCase();
    if (HARD_CODED_ADMINS.includes(targetEmail) || (targetUsername && HARD_CODED_ADMINS.includes(targetUsername))) {
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
