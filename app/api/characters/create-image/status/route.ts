import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext } from "@/lib/ownerKey";
import {
  isCharacterCreateRequestId,
  readCharacterCreateRequest,
} from "@/lib/characters/characterCreateRequestStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await getOwnerContext(request);
    const requestId = String(request.nextUrl.searchParams.get("requestId") || "").trim();
    if (!isCharacterCreateRequestId(requestId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid Character create request id." },
        { status: 400 },
      );
    }

    const record = readCharacterCreateRequest(requestId);
    if (!record) {
      return NextResponse.json(
        { ok: false, error: "Character create request not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: true, request: record },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const message = error?.message || String(error);
    const status = /session|auth|unauthor/i.test(message) ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
