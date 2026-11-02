import { limitedJson } from "@/lib/limitedRequestBody";
import { RequestError } from "@/lib/requestError";
import { enforceRequestLimit } from "@/lib/auth/requestLimits";
import { isReservedAdminIdentifier } from "@/lib/auth/admin";
import { NextResponse } from "next/server";
import { db, ensureMigrations } from "@/lib/auth/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    ensureMigrations();

    const { email, username, password } = await limitedJson(req, 16 * 1024);
    enforceRequestLimit("signup-total", "all", 60, 60 * 60 * 1000);
    if (typeof email !== "string" || typeof username !== "string" || typeof password !== "string" || !email || !username || !password || email.length > 254 || Buffer.byteLength(password) > 72) {
      return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });
    }

    const e = String(email).trim().toLowerCase();
    const u = String(username).trim().toLowerCase();
    if (isReservedAdminIdentifier(e) || isReservedAdminIdentifier(u)) throw new RequestError("This account identifier is reserved. Contact the administrator.", 409);
    enforceRequestLimit("signup", e, 5, 15 * 60 * 1000);

    if (!/^\S+@\S+\.\S+$/.test(e)) {
      return NextResponse.json({ ok: false, error: "Invalid email." }, { status: 400 });
    }
    if (!/^[a-z0-9_-]{3,24}$/.test(u)) {
      return NextResponse.json({ ok: false, error: "Invalid username." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: "Password too short." }, { status: 400 });
    }

    const exists = db.prepare(
      "SELECT 1 FROM users WHERE LOWER(email)=? OR LOWER(username)=?"
    ).get(e, u);
    if (exists) {
      return NextResponse.json(
        { ok: false, error: "Email or username already exists." },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 12);

    db.prepare(
      "INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, e, u, hash, new Date().toISOString());

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.message || "").includes("UNIQUE")) {
      return NextResponse.json(
        { ok: false, error: "Email or username already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: false, error: e instanceof RequestError ? e.message : "Signup failed." }, { status: e instanceof RequestError ? e.status : 500 });
  }
}
