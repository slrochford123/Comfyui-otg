import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { deleteAsset, listAssets, saveAsset, type AssetRecordInput } from "@/lib/assets/store";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

function failure(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "Asset request failed" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    return noStore({ ok: true, items: listAssets(ownerKey) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    const { ownerKey } = await getOwnerContext(req);
    const action = String(body?.action || "save").trim().toLowerCase();
    if (action === "save") {
      const asset = saveAsset(ownerKey, (body?.asset || body) as AssetRecordInput);
      return noStore({ ok: true, asset, items: listAssets(ownerKey) }, { status: body?.asset ? 200 : 201 });
    }
    if (action === "delete") {
      const assetId = String(body?.assetId || "").trim();
      if (!assetId) return noStore({ ok: false, error: "assetId is required" }, { status: 400 });
      return noStore({ ok: true, ...deleteAsset(ownerKey, assetId), items: listAssets(ownerKey) });
    }
    return noStore({ ok: false, error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
