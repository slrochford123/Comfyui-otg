import { limitedJson } from "@/lib/limitedRequestBody";
import { RequestError } from "@/lib/requestError";
import { enforceRequestLimit } from "@/lib/auth/requestLimits";
import { isReservedAdminIdentifier } from "@/lib/auth/admin";
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

    const body = await limitedJson(req, 16 * 1024);
    const identifier = body?.identifier ?? body?.email;
    const password = body?.password;

    if (typeof identifier !== "string" || typeof password !== "string" || !identifier || !password || identifier.length > 254 || Buffer.byteLength(password) > 72) {
      return NextResponse.json({ ok: false, error: "Email/username and password required." }, { status: 400 });
    }

    const idNorm = normalizeIdentifier(identifier);
    const looksEmail = idNorm.includes("@");
    enforceRequestLimit("login", idNorm, 12, 15 * 60 * 1000);

    let user = (looksEmail
      ? db.prepare("SELECT id, email, username, password_hash FROM users WHERE LOWER(email) = ?").get(idNorm)
      : db.prepare("SELECT id, email, username, password_hash FROM users WHERE LOWER(username) = ?").get(idNorm)
    ) as { id: string; email: string; username?: string | null; password_hash: string } | undefined;

    if (!user) {
      // TEST-SITE ONLY: if OTG_ALLOW_ANY_USER=true, auto-provision a user on first login.
      // Keep this enabled only for TEST data directories.
      const allowAny = String(process.env.OTG_ALLOW_ANY_USER || "").toLowerCase() === "true";

      if (allowAny && process.env.OTG_ENV === "test" && !isReservedAdminIdentifier(idNorm)) {
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
    const issuedAt = new Date().toISOString();

    db.prepare("UPDATE users SET current_session_id = ?, current_session_issued_at = ? WHERE id = ?").run(
      sid,
      issuedAt,
      user.id
    );
    db.prepare("INSERT INTO user_sessions (session_id, user_id, issued_at) VALUES (?, ?, ?)").run(
      sid,
      user.id,
      issuedAt,
    );
    db.prepare(`
      DELETE FROM user_sessions
      WHERE user_id = ? AND session_id NOT IN (
        SELECT session_id FROM user_sessions
        WHERE user_id = ? ORDER BY issued_at DESC LIMIT 8
      )
    `).run(user.id, user.id);

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
    return NextResponse.json({ ok: false, error: e instanceof RequestError ? e.message : "Login failed." }, { status: e instanceof RequestError ? e.status : 500, headers: e instanceof RequestError && e.status === 429 ? { "Retry-After": "900" } : {} });
  }
}
