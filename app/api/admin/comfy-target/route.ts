import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireAdmin } from "../_requireAdmin";
import { COMFY_TARGET_COOKIE, comfyTargets } from "@/app/api/_lib/comfyTarget";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  }

  const targets = comfyTargets();
  const store = await cookies();
  const current = (store.get(COMFY_TARGET_COOKIE)?.value || "").trim() || null;

  return NextResponse.json(
    { ok: true, current, targets },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "").trim();
  const store = await cookies();
  if (!id) {
    store.delete(COMFY_TARGET_COOKIE);
    return NextResponse.json({ ok: true, current: null }, { headers: { "Cache-Control": "no-store" } });
  }
  const targets = comfyTargets();
  const found = targets.find((t) => t.id === id);
  if (!found) {
    return NextResponse.json({ ok: false, error: "Unknown target" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  store.set(COMFY_TARGET_COOKIE, found.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return NextResponse.json({ ok: true, current: found.id }, { headers: { "Cache-Control": "no-store" } });
}
