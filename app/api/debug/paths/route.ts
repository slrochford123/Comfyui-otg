import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { getResolvedDataRoot, OTG_DEVICE_OUTPUT_ROOT, OTG_USER_OUTPUT_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx: any = await getOwnerContext(req as any);
    return NextResponse.json({
      ok: true,
      resolvedDataRoot: getResolvedDataRoot(),
      deviceOutputRoot: OTG_DEVICE_OUTPUT_ROOT,
      userOutputRoot: OTG_USER_OUTPUT_ROOT,
      ctx: {
        ownerKey: ctx?.ownerKey,
        username: ctx?.username,
        userId: ctx?.userId,
        deviceId: ctx?.deviceId,
      },
    });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "unknown_error" }, { status: 500 });
  }
}
