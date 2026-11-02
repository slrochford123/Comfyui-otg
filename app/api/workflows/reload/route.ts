import { NextRequest, NextResponse } from "next/server";
import { clearWorkflowCache } from "@/lib/workflows";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { assertSameOrigin, RequestError } from "@/lib/routeSecurity";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  try { assertSameOrigin(req); }
  catch (error) { return NextResponse.json({ error: "Request origin is not allowed." }, { status: error instanceof RequestError ? error.status : 403 }); }
  clearWorkflowCache();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function GET() {
  return NextResponse.json({ error: "Use an authenticated administrator POST request." }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
