import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import {
  addOpenAICreditEvent,
  buildOpenAIBillingSnapshot,
  syncOpenAIOfficialBilling,
  updateOpenAIBillingSettings,
  type OpenAIBillingFilters,
} from "@/lib/openai/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parseDate(value: string | null) {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function filtersFromRequest(request: NextRequest): OpenAIBillingFilters {
  const params = request.nextUrl.searchParams;
  return {
    environment: params.get("environment") || undefined,
    user: params.get("user") || undefined,
    feature: params.get("feature") || undefined,
    apiProject: params.get("apiProject") || undefined,
    apiKeyId: params.get("apiKeyId") || undefined,
    model: params.get("model") || undefined,
    start: parseDate(params.get("start")),
    end: parseDate(params.get("end")),
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return noStore({ ok: false, error: admin.error }, admin.status);

  return noStore(buildOpenAIBillingSnapshot(filtersFromRequest(request)));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return noStore({ ok: false, error: admin.error }, admin.status);

  const body = await request.json().catch(() => null);
  const action = String(body?.action || "");

  try {
    if (action === "credit") {
      const amountUsd = Number(body?.amountUsd);
      if (!Number.isFinite(amountUsd)) return noStore({ ok: false, error: "Amount is required." }, 400);
      const event = addOpenAICreditEvent({
        type: String(body?.type || "purchase"),
        amountUsd,
        effectiveAt: body?.effectiveAt ? Date.parse(String(body.effectiveAt)) : undefined,
        note: String(body?.note || ""),
        verifiedBalanceUsd: body?.verifiedBalanceUsd === "" || body?.verifiedBalanceUsd == null ? null : Number(body.verifiedBalanceUsd),
      });
      return noStore({ ok: true, event, snapshot: buildOpenAIBillingSnapshot() });
    }

    if (action === "settings") {
      const warnings = Array.isArray(body?.lowBalanceWarningsUsd)
        ? body.lowBalanceWarningsUsd.map(Number)
        : undefined;
      const settings = updateOpenAIBillingSettings({
        lowBalanceWarningsUsd: warnings,
      });
      return noStore({ ok: true, settings, snapshot: buildOpenAIBillingSnapshot() });
    }

    if (action === "sync") {
      if (!String(process.env.OPENAI_ADMIN_API_KEY || "").trim()) {
        return noStore({
          ok: false,
          error: "OPENAI_ADMIN_API_KEY is not configured for official OpenAI billing sync.",
          snapshot: buildOpenAIBillingSnapshot(),
        }, 200);
      }
      const result = await syncOpenAIOfficialBilling(Number(body?.days || 30));
      return noStore({ ...result, snapshot: buildOpenAIBillingSnapshot() }, result.ok ? 200 : 502);
    }

    return noStore({ ok: false, error: "Unknown OpenAI billing action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI billing update failed.";
    return noStore({ ok: false, error: message }, 500);
  }
}

