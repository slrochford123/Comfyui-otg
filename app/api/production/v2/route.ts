import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import { type ProductionV2, type ProductionV2Model } from "@/lib/production/v2";
import { productionV2Store } from "@/lib/production/v2Store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

function failure(error: unknown, fallback: string) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const mode = String(req.nextUrl.searchParams.get("mode") || "list").trim().toLowerCase();
    const productionId = String(req.nextUrl.searchParams.get("productionId") || "").trim();

    if (mode === "load") {
      if (!productionId) return noStore({ ok: false, error: "productionId is required" }, { status: 400 });
      const production = productionV2Store.load(ownerKey, productionId);
      return production
        ? noStore({ ok: true, production })
        : noStore({ ok: false, error: "Production not found" }, { status: 404 });
    }

    if (mode === "active") {
      return noStore({ ok: true, production: productionV2Store.getActive(ownerKey) });
    }

    const drafts = productionV2Store.list(ownerKey, "draft");
    const completed = productionV2Store.list(ownerKey, "completed");
    return noStore({
      ok: true,
      items: [...drafts, ...completed].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      drafts,
      completed,
      activeProduction: productionV2Store.getActive(ownerKey),
    });
  } catch (error) {
    return failure(error, "Production V2 request failed");
  }
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    const { ownerKey } = await getOwnerContext(req);
    const action = String(body?.action || "").trim().toLowerCase();

    if (action === "create") {
      const name = String(body?.name || "").trim();
      const defaultModel = body?.defaultModel as ProductionV2Model;
      if (!name) return noStore({ ok: false, error: "Production name is required" }, { status: 400 });
      if (defaultModel !== "minimax-h3" && defaultModel !== "ltx-2.5") {
        return noStore({ ok: false, error: "defaultModel must be minimax-h3 or ltx-2.5" }, { status: 400 });
      }
      const production = productionV2Store.create(ownerKey, name, defaultModel);
      return noStore({ ok: true, production, summary: productionV2Store.summarize(production) }, { status: 201 });
    }

    if (action === "save") {
      const production = body?.production as ProductionV2 | undefined;
      if (!production || typeof production !== "object" || Array.isArray(production)) {
        return noStore({ ok: false, error: "production payload is required" }, { status: 400 });
      }
      const saved = productionV2Store.save(ownerKey, production);
      return noStore({ ok: true, production: saved, summary: productionV2Store.summarize(saved) });
    }

    if (action === "activate") {
      const productionId = String(body?.productionId || "").trim();
      const production = productionV2Store.setActive(ownerKey, productionId || null);
      return noStore({ ok: true, production });
    }

    if (action === "delete") {
      const productionId = String(body?.productionId || "").trim();
      if (!productionId) return noStore({ ok: false, error: "productionId is required" }, { status: 400 });
      const result = productionV2Store.remove(ownerKey, productionId);
      return noStore({
        ok: true,
        ...result,
        drafts: productionV2Store.list(ownerKey, "draft"),
        completed: productionV2Store.list(ownerKey, "completed"),
      });
    }

    if (action === "complete") {
      const productionId = String(body?.productionId || "").trim();
      if (!productionId) return noStore({ ok: false, error: "productionId is required" }, { status: 400 });
      const production = productionV2Store.complete(ownerKey, productionId);
      return noStore({ ok: true, production, summary: productionV2Store.summarize(production) });
    }

    return noStore({ ok: false, error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return failure(error, "Production V2 write failed");
  }
}
