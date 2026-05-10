import { NextResponse } from "next/server";
import { db, ensureMigrations } from "@/lib/auth/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { signSession } from "@/lib/auth/jwt";
import { authCookieOptions, cookieName } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeIdentifier(v: string) {
  return String(v || "").trim().toLowerCase();
}

function makeSafeUsername(raw: string) {
  const base = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);

  return base.length >= 3 ? base : `user${Math.floor(Math.random() * 100000)}`;
}

export async function POST(req: Request) {
  try {
    ensureMigrations();

    const body = await req.json().catch(() => ({}));
    const identifier = body?.identifier ?? body?.email;
    const password = body?.password;

    if (!identifier || !password) {
      return NextResponse.json({ ok: false, error: "Email/username and password required." }, { status: 400 });
    }

    const idNorm = normalizeIdentifier(identifier);
    const looksEmail = idNorm.includes("@");

    let user = (looksEmail
      ? db.prepare("SELECT id, email, username, password_hash FROM users WHERE LOWER(email) = ?").get(idNorm)
      : db.prepare("SELECT id, email, username, password_hash FROM users WHERE LOWER(username) = ?").get(idNorm)
    ) as { id: string; email: string; username?: string | null; password_hash: string } | undefined;

    if (!user) {
      // TEST-SITE ONLY: if OTG_ALLOW_ANY_USER=true, auto-provision a user on first login.
      // Keep this enabled only for TEST data directories.
      const allowAny = String(process.env.OTG_ALLOW_ANY_USER || "").toLowerCase() === "true";

      if (allowAny) {
        const email = looksEmail ? idNorm : `${makeSafeUsername(idNorm)}@test.local`;
        const username = looksEmail ? makeSafeUsername(idNorm.split("@")[0]) : makeSafeUsername(idNorm);

        const id = crypto.randomUUID();
        const hash = await bcrypt.hash(String(password), 12);

        try {
          db.prepare(
            "INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
          ).run(id, email, username, hash, new Date().toISOString());
        } catch {
          // A race or unique collision can happen in dev. Re-fetch below handles it.
        }

        user = (looksEmail
          ? db.prepare("SELECT id, email, username, password_hash FROM users WHERE LOWER(email) = ?").get(email)
          : db.prepare("SELECT id, email, username, password_hash FROM users WHERE LOWER(username) = ?").get(username)
        ) as { id: string; email: string; username?: string | null; password_hash: string } | undefined;
      }

      if (!user) {
        return NextResponse.json({ ok: false, error: "Invalid email/username or password." }, { status: 401 });
      }
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Invalid email/username or password." }, { status: 401 });
    }

    const sid = crypto.randomUUID();

    db.prepare("UPDATE users SET current_session_id = ?, current_session_issued_at = ? WHERE id = ?").run(
      sid,
      new Date().toISOString(),
      user.id
    );

    const token = await signSession({
      sub: user.id,
      email: user.email,
      username: user.username ?? null,
      sid,
    });

    const res = NextResponse.json({
      ok: true,
      user: {
        email: user.email,
        username: user.username ?? null,
      },
    });

    res.cookies.set(cookieName(), token, authCookieOptions(req));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Login failed." }, { status: 500 });
  }
}