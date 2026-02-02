import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

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

export async function POST() {
  // Require a valid logged-in session
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await verifySession(token);
  } catch {
    // Clear stale cookie
    const res = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    res.cookies.set(cookieName(), "", { path: "/", maxAge: 0 });
    return res;
  }

  const username = String(payload?.username || "").trim();
  const email = String(payload?.email || payload?.sub || "").trim().toLowerCase();

  if (!username) {
    return NextResponse.json({ ok: false, error: "User profile missing username" }, { status: 400 });
  }

  // 1) Delete user record
  try {
    ensureMigrations();
    db.prepare("DELETE FROM users WHERE LOWER(username)=? OR LOWER(email)=?").run(username.toLowerCase(), email);
  } catch {
    // even if DB delete fails, still attempt to remove files and log out
  }

  // 2) Delete user files (gallery + favorites) best-effort
  try {
    // New location (OTG_DATA_DIR)
    rmrf(path.join(OTG_USER_OUTPUT_ROOT, username));
    rmrf(path.join(OTG_DATA_ROOT, "user_favorites", username));

    // Legacy locations (CWD-based)
    rmrf(path.join(process.cwd(), "data", "user_galleries", username));
    rmrf(path.join(process.cwd(), "data", "user_favorites", username));
  } catch {
    // ignore
  }

  // 3) Clear auth cookie
  const res = NextResponse.json(
    { ok: true, deleted: { username } },
    { headers: { "Cache-Control": "no-store" } }
  );
  res.cookies.set(cookieName(), "", { path: "/", maxAge: 0 });
  return res;
}
