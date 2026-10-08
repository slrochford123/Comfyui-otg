import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { validateH3RefModsRequest } from "@/lib/h3SpecialModes/refMods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET() {
  return noStore({ ok: true, job: null });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as {
      config?: unknown;
    } | null;
    const config = body?.config && typeof body.config === "object"
      ? body.config as Record<string, unknown>
      : {};
    const request = validateH3RefModsRequest(config);
    return noStore({
      ok: false,
      error: "H3 Ref Mods generation is quarantined until the dedicated RefMod T2V API workflow is available and validated.",
      compiledPrompt: request.compiledPrompt,
    }, { status: 501 });
  } catch (error) {
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "H3 Ref Mods generation request failed.",
    }, { status: 400 });
  }
}
