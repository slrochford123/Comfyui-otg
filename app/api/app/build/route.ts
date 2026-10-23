import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { readBuildIdentity } from "@/lib/buildIdentityServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try { await requireSessionUser(request); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers }); }
  return NextResponse.json(readBuildIdentity(), { headers });
}
