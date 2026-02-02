import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx: any = await getOwnerContext(req as any);

    // OwnerContext varies by build; compute a stable scope key.
    const scopeKey =
      (ctx && (ctx.ownerKey || ctx.username || ctx.userId || ctx.deviceId)) ? String(ctx.ownerKey || ctx.username || ctx.userId || ctx.deviceId) : "local";

    const state = readState(scopeKey);
    return NextResponse.json({ ok: true, ...state, scopeKey });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "unknown_error" }, { status: 500 });
  }
}
