import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { parseH3TargetBackend } from "@/lib/h3GpuRouting";
import { inspectH3SmartReferences, ownedH3SmartCapabilities } from "@/lib/h3SmartReferencesServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const reply = (v: unknown, status = 200) => NextResponse.json(v, {status, headers: {"Cache-Control": "private, no-store"}});
  let owner;
  try { owner=await requireSessionUser(req); } catch { return reply({error: "Sign in to check H3 reference capabilities."}, 401); }
  try { const backend = parseH3TargetBackend(req.nextUrl.searchParams.get("backend")) || "rtx3090"; return reply({ok: true, capabilities: ownedH3SmartCapabilities(await inspectH3SmartReferences(backend),owner.ownerKey)}); }
  catch (error) { return reply({ok: false, error: error instanceof Error ? error.message : "Could not check H3 references."}, 400); }
}
