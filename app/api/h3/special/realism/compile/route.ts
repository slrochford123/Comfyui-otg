import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  compileH3RealismPrompt,
  validateH3RealismRequest,
} from "@/lib/h3SpecialModes/realism";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

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

function errorResponse(error: unknown) {
  if (error instanceof SessionInvalidError) {
    return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return noStore(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Realism prompt request failed.",
    },
    { status: 400 },
  );
}

export async function POST(req: NextRequest) {
  try {
    await getOwnerContext(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new Error("A valid Realism prompt request is required.");
    }
    const normalized = validateH3RealismRequest(body as Record<string, unknown>);
    const compiledPrompt = compileH3RealismPrompt({
      prompt: normalized.prompt,
      durationSeconds: normalized.durationSeconds,
      orientation: normalized.orientation,
      references: normalized.references,
      loras: normalized.loras,
    });
    return noStore({
      ok: true,
      compiledPrompt,
      references: normalized.references,
      loras: normalized.loras,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
