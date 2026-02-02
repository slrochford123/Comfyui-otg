import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { resetState } from "@/lib/contentState";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function isAdminRequest(req: NextRequest): Promise<boolean> {
  try {
    const token = req.cookies.get(cookieName())?.value || "";
    if (!token) return false;
    const payload: any = await verifySession(token);
    const email = String(payload?.email || "").toLowerCase();
    const username = String(payload?.username || "").toLowerCase();
    return email === "slrochford123@protonmail.com" || username === "slrochford123";
  } catch {
    return false;
  }
}

// Admin-only unlock: clears ONLY the lock state, does NOT delete gallery files.
export async function POST(req: NextRequest) {
  // Must be admin
  const adminOk = await isAdminRequest(req);
  if (!adminOk) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let ownerKey: string;
  try {
    ({ ownerKey } = await getOwnerContext(req));
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Auth failed" }, { status: 500 });
  }

  const next = resetState(ownerKey);

  return NextResponse.json(
    { ok: true, ownerKey, status: next.status, clearedGallery: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}
