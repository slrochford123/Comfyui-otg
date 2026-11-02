import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  return NextResponse.json({ ok: true, supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) },
    { headers: { "Cache-Control": "private, no-store" } });
}
