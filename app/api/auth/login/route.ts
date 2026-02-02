import { NextResponse } from "next/server";
import { db, ensureMigrations } from "@/lib/auth/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { signSession } from "@/lib/auth/jwt";
import { cookieName } from "@/lib/auth/cookies";

function isLocalHost(host: string) {
  return host.includes("localhost") || /^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(host);
}

function isHttpsRequest(req: Request) {
  try {
    const u = new URL(req.url);
    if (u.protocol === "https:") return true;
  } catch {}

  const xf = req.headers.get("x-forwarded-proto") || req.headers.get("x-forwarded-protocol");
  if (xf && xf.toLowerCase().includes("https")) return true;

  return false;
}

function normalizeIdentifier(v: string) {
  return String(v || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    ensureMigrations();

    const body = await req.json();
    const identifier = body?.identifier ?? body?.email; // backwards compatible
    const password = body?.password;
    const remember = body?.remember !== false;

    if (!identifier || !password) {
      return NextResponse.json({ ok: false, error: "Email/username and password required." }, { status: 400 });
    }

    const idNorm = normalizeIdentifier(identifier);
    const looksEmail = idNorm.includes("@");

    let user = (looksEmail
      ? db.prepare("SELECT id, email, username, password_hash FROM users WHERE email = ?").get(idNorm)
      : db.prepare("SELECT id, email, username, password_hash FROM users WHERE username = ?").get(idNorm)
    ) as { id: string; email: string; username?: string | null; password_hash: string } | undefined;

    if (!user) {
      // TEST-SITE ONLY: if OTG_ALLOW_ANY_USER=true, auto-provision a user on first login.
      // This is safe because the test site uses its own OTG_DATA_DIR (separate SQLite DB).
      const allowAny = String(process.env.OTG_ALLOW_ANY_USER || "").toLowerCase() === "true";
      if (allowAny) {
        const makeSafeUsername = (raw: string) => {
          const base = String(raw || "")
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")
            .slice(0, 24);
          return base.length >= 3 ? base : `user${Math.floor(Math.random() * 100000)}`;
        };

        const email = looksEmail ? idNorm : `${makeSafeUsername(idNorm)}@test.local`;
        const username = looksEmail ? makeSafeUsername(idNorm.split("@")[0]) : makeSafeUsername(idNorm);

        const id = crypto.randomUUID();
        const hash = await bcrypt.hash(String(password), 12);

        try {
          db.prepare(
            "INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
          ).run(id, email, username, hash, new Date().toISOString());
        } catch {
          // If a race or uniqueness collision happened, we'll fall through and attempt to read again.
        }

        // Re-fetch after creation attempt
        const created = (looksEmail
          ? db.prepare("SELECT id, email, username, password_hash FROM users WHERE email = ?").get(email)
          : db.prepare("SELECT id, email, username, password_hash FROM users WHERE username = ?").get(username)
        ) as { id: string; email: string; username?: string | null; password_hash: string } | undefined;

        if (!created) {
          return NextResponse.json({ ok: false, error: "Invalid email/username or password." }, { status: 401 });
        }

        // Replace user with created record
        user = created;
      } else {
        return NextResponse.json({ ok: false, error: "Invalid email/username or password." }, { status: 401 });
      }
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Invalid email/username or password." }, { status: 401 });
    }

    const sid = crypto.randomUUID();

    db.prepare("UPDATE users SET current_session_id = ?, current_session_issued_at = ? WHERE id = ?").run(
      sid,
      new Date().toISOString(),
      user.id
    );


    const token = await signSession(
      { sub: user.id, email: user.email, username: user.username ?? null, sid },
      remember
    );

    const res = NextResponse.json({ ok: true });

    const host = req.headers.get("host") || "";
    const secure = isHttpsRequest(req) && !isLocalHost(host);

    res.cookies.set(cookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: remember ? 60 * 60 * 24 * 30 : undefined,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Login failed." }, { status: 500 });
  }
}
