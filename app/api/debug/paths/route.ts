import { NextResponse } from "next/server";
import fs from "node:fs";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { getResolvedDataRoot, OTG_DEVICE_OUTPUT_ROOT, OTG_USER_OUTPUT_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  return NextResponse.json({ ok: true, exists: {
    data: fs.existsSync(getResolvedDataRoot()),
    deviceOutput: fs.existsSync(OTG_DEVICE_OUTPUT_ROOT),
    userOutput: fs.existsSync(OTG_USER_OUTPUT_ROOT),
  } }, { headers: { "Cache-Control": "private, no-store" } });
}
