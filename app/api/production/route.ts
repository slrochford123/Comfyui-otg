import { NextRequest, NextResponse } from "next/server";
import { SessionInvalidError } from "@/lib/ownerKey";
import { getSessionUser } from "@/lib/sessionUser";
import {
  deleteProduction,
  getActiveProduction,
  loadProduction,
  listProductions,
  saveProduction,
  summarizeProduction,
  type PersistedProductionState,
} from "@/lib/production/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    const ownerKey = user.ownerKey;
    const mode = (req.nextUrl.searchParams.get("mode") || "list").trim().toLowerCase();
    const productionId = (req.nextUrl.searchParams.get("productionId") || "").trim();

    if (mode === "active") {
      const record = getActiveProduction(ownerKey);
      return NextResponse.json({ ok: true, production: record, summary: summarizeProduction(record) });
    }

    if (mode === "load") {
      if (!productionId) {
        return NextResponse.json({ ok: false, error: "productionId is required" }, { status: 400 });
      }
      const record = loadProduction(ownerKey, productionId);
      if (!record) {
        return NextResponse.json({ ok: false, error: "Production not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, production: record, summary: summarizeProduction(record) });
    }

    return NextResponse.json({ ok: true, items: listProductions(ownerKey) });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Production request failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    const ownerKey = user.ownerKey;
    const body = await req.json().catch(() => null);
    const rawAction = String(body?.action || body?.mode || "").trim().toLowerCase();
    const action = rawAction || (body?.production && typeof body.production === "object" ? "save" : "");

    if (action === "save" || action === "create" || action === "update" || action === "upsert") {
      const input = (body?.production || body?.payload || body?.state || null) as PersistedProductionState | null;
      if (!input || typeof input !== "object") {
        return NextResponse.json({ ok: false, error: "production payload is required" }, { status: 400 });
      }
      const record = saveProduction(ownerKey, input);
      return NextResponse.json({ ok: true, production: record, summary: summarizeProduction(record) });
    }

    if (action === "delete" || action === "remove") {
      const productionId = String(body?.productionId || "").trim();
      if (!productionId) {
        return NextResponse.json({ ok: false, error: "productionId is required" }, { status: 400 });
      }
      const result = deleteProduction(ownerKey, productionId);
      return NextResponse.json({ ok: true, ...result, items: listProductions(ownerKey) });
    }

    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Production write failed" }, { status: 500 });
  }
}
