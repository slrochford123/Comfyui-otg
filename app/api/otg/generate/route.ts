import { NextResponse } from "next/server";
import { withOwner } from "@/lib/routeSecurity";
export const runtime = "nodejs";
/** Superseded by the owner-scoped durable submission route; never accept raw graphs here. */
export const POST = withOwner(async () => NextResponse.json({
  ok: false, error: "This legacy submission endpoint has been retired. Submit through the current generator.",
  replacement: "/api/comfy",
}, { status: 410 }));
