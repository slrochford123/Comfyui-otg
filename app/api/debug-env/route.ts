import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
export const runtime = "nodejs";
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  // No credentials, raw paths, shared gallery names, or recursive disk scan.
  return NextResponse.json({ ok: true, runtime, environment: process.env.OTG_ENV || "unknown",
    configured: { data: Boolean(process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT),
      comfy: Boolean(process.env.COMFY_BASE_URL || process.env.COMFY_URL),
      openai: Boolean(process.env.OPENAI_API_KEY) } },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
