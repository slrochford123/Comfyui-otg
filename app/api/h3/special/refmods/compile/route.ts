import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  compileH3RefModsPrompt,
  normalizeH3RefModSlots,
} from "@/lib/h3SpecialModes/refMods";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as {
      prompt?: unknown;
      refMods?: unknown;
    } | null;
    const refMods = normalizeH3RefModSlots(body?.refMods);
    return noStore({
      ok: true,
      compiledPrompt: compileH3RefModsPrompt({
        prompt: String(body?.prompt || ""),
        refMods,
      }),
      refMods,
    });
  } catch (error) {
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "Could not compile Ref Mods prompt.",
    }, { status: 400 });
  }
}
