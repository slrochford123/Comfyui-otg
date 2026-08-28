import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { collectAdminPerformanceSnapshot } from "@/lib/admin/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  return NextResponse.json(collectAdminPerformanceSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
