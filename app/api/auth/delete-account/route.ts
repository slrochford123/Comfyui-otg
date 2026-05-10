import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { db, ensureMigrations } from "@/lib/auth/db";
import { OTG_DATA_ROOT, OTG_USER_OUTPUT_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function rmrf(p: string) {
  if (!p) return;
  try {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) {
        rmrf(path.join(p, name));
      }
      fs.rmdirSync(p);
    } else {
      fs.unlinkSync(p);
    }
  } catch {
    // best effort
  }
}

export async function POST(req: Request) {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await verifySession(token);
  } catch {
    const res = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    res.cookies.set(cookieName(), "", { path: "/", maxAge: 0 });
    return res;
  }

  const body = await req.json().catch(() => ({}));
  const password = String(body?.password || "");
  const confirmText = String(body?.confirmText || "").trim();

  if (!password || confirmText !== "DELETE") {
    return NextResponse.json({ ok: false, error: "Password and DELETE confirmation are required." }, { status: 400 });
  }

  const userId = String(payload?.sub || "").trim();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  ensureMigrations();

  const user = db.prepare("SELECT id, email, username, password_hash FROM users WHERE id = ?").get(userId) as
    | { id: string; email: string; username?: string | null; password_hash: string }
    | undefined;

  if (!user?.password_hash) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    return NextResponse.json({ ok: false, error: "Password is incorrect." }, { status: 401 });
  }

  const username = String(user.username || payload?.username || "").trim();
  const email = String(user.email || payload?.email || "").trim().toLowerCase();

  if (!username) {
    return NextResponse.json({ ok: false, error: "User profile missing username" }, { status: 400 });
  }

  try {
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  } catch {
    return NextResponse.json({ ok: false, error: "Account delete failed." }, { status: 500 });
  }

  try {
    rmrf(path.join(OTG_USER_OUTPUT_ROOT, username));
    rmrf(path.join(OTG_DATA_ROOT, "user_favorites", username));

    rmrf(path.join(process.cwd(), "data", "user_galleries", username));
    rmrf(path.join(process.cwd(), "data", "user_favorites", username));
  } catch {
    // ignore file cleanup failures after account row was removed
  }

  const res = NextResponse.json(
    { ok: true, deleted: { username, email } },
    { headers: { "Cache-Control": "no-store" } }
  );
  res.cookies.set(cookieName(), "", { path: "/", maxAge: 0 });
  return res;
}
