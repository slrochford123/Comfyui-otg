import { NextResponse } from "next/server";
import { clearWorkflowCache } from "@/lib/workflows";

export const runtime = "nodejs";

export async function POST() {
  clearWorkflowCache();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  // convenience
  clearWorkflowCache();
  return NextResponse.json({ ok: true });
}
