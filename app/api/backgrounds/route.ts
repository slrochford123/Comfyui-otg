import { NextRequest, NextResponse } from "next/server";

import {
  deleteBackground,
  listBackgrounds,
  saveBackground,
} from "@/lib/backgrounds/store";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    return noStore({
      ok: true,
      items: listBackgrounds(owner.ownerKey),
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return noStore({ ok: false, error: error?.message || "Could not list backgrounds." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "save").trim().toLowerCase();

    if (action === "delete") {
      const id = String(body?.id || "").trim();
      if (!id) return noStore({ ok: false, error: "Background id is required." }, { status: 400 });

      const deleted = deleteBackground(owner.ownerKey, id);
      return noStore({
        ok: true,
        deleted,
        items: listBackgrounds(owner.ownerKey),
      });
    }

    if (action !== "save" && action !== "create") {
      return noStore({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const background = saveBackground(owner.ownerKey, body?.background || body);
    return noStore({
      ok: true,
      background,
      items: listBackgrounds(owner.ownerKey),
    }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return noStore({ ok: false, error: error?.message || "Could not save background." }, { status: 500 });
  }
}