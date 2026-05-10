import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { db, ensureMigrations } from "@/lib/auth/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function validatePassword(password: string) {
  if (password.length < 10) return "New password must be at least 10 characters.";
  if (password.length > 128) return "New password must be 128 characters or fewer.";
  if (!/[A-Z]/.test(password)) return "New password must include at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "New password must include at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "New password must include at least one number.";
  return "";
}

export async function POST(req: Request) {
  try {
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
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");
    const confirmPassword = String(body?.confirmPassword || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json({ ok: false, error: "Current password, new password, and confirmation are required." }, { status: 400 });
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ ok: false, error: "New password and confirmation do not match." }, { status: 400 });
    }

    const validationError = validatePassword(newPassword);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    ensureMigrations();

    const userId = String(payload?.sub || "").trim();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const user = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(userId) as
      | { id: string; password_hash: string }
      | undefined;

    if (!user?.password_hash) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const currentOk = await bcrypt.compare(currentPassword, user.password_hash);
    if (!currentOk) {
      return NextResponse.json({ ok: false, error: "Current password is incorrect." }, { status: 401 });
    }

    const samePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (samePassword) {
      return NextResponse.json({ ok: false, error: "New password must be different from the current password." }, { status: 400 });
    }

    const nextHash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(nextHash, user.id);

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Password update failed." }, { status: 500 });
  }
}
