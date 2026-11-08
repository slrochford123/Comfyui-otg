import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { openAIAdminConfigured } from "@/lib/openai/adminCredential";
import { conversationPolicyEnabled, getConversationAccount, listConversationAccounts } from "@/lib/openai/conversationAccount";
import { adjustConversationCredit, conversationAdminLedger, conversationCreditStatus, releaseUnbilledConversationHold } from "@/lib/openai/usageLedger";
import { RequestError } from "@/lib/requestError";
import { reconcileConversationUsage } from "@/lib/openai/provider";
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
    end: parseDate(params.get("end")) == null ? undefined : parseDate(params.get("end"))! + 86400000 - 1,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return noStore({ ok: false, error: admin.error }, admin.status);

  if(request.nextUrl.searchParams.get("view")==="allowances"&&conversationPolicyEnabled())
    return noStore({ok:true,accounts:listConversationAccounts().map(account=>({...account,...conversationCreditStatus(account)})),...conversationAdminLedger()});
  return noStore(buildOpenAIBillingSnapshot(filtersFromRequest(request)));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return noStore({ ok: false, error: admin.error }, admin.status);

  const origin = request.headers.get("origin");
  let originHost: string | null = null;
  try { originHost = origin ? new URL(origin).host : null; } catch { return noStore({ ok: false, error: "Invalid origin." }, 403); }
  if (request.headers.get("sec-fetch-site") === "cross-site" || (originHost && originHost !== request.headers.get("host"))) return noStore({ ok: false, error: "Same-origin request required." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return noStore({ ok: false, error: "JSON required." }, 415);
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "");

  try {
    if(action==="conversation-credit" && conversationPolicyEnabled()){
      const account=getConversationAccount(String(body?.accountId||""));
      const balance=adjustConversationCredit({account,actor:admin.id,key:String(body?.key||""),kind:String(body?.kind||""),
        amountUsd:Number(body?.amountUsd),note:String(body?.note||"").trim().slice(0,500)});
      return noStore({ok:true,balance});
    }
    if(action==="conversation-release-unbilled" && conversationPolicyEnabled()){
      releaseUnbilledConversationHold(String(body?.reservation||""),admin.id,String(body?.note||"").trim().slice(0,500));
      return noStore({ok:true});
    }
    if(action==="conversation-reconcile" && conversationPolicyEnabled()){
      await reconcileConversationUsage(String(body?.reservation||""),admin.id);
      return noStore({ok:true});
    }
    if (action === "credit") {
      const amountUsd = Number(body?.amountUsd);
      if (body?.amountUsd == null || String(body.amountUsd).trim() === "" || !Number.isFinite(amountUsd)) return noStore({ ok: false, error: "Amount is required." }, 400);
      if (body?.effectiveAt && !Number.isFinite(Date.parse(String(body.effectiveAt)))) return noStore({ ok: false, error: "Valid date and time required." }, 400);
      if (["starting_balance", "manual_reconciliation"].includes(body?.type) && amountUsd < 0) return noStore({ ok: false, error: "A portal balance cannot be negative." }, 400);
      const event = addOpenAICreditEvent({
        type: String(body?.type || "purchase"),
        amountUsd,
        effectiveAt: body?.effectiveAt ? Date.parse(String(body.effectiveAt)) : undefined,
        note: String(body?.note || ""),
        verifiedBalanceUsd: body?.verifiedBalanceUsd === "" || body?.verifiedBalanceUsd == null ? null : Number(body.verifiedBalanceUsd),
      });
      return noStore({ ok: true, event, snapshot: buildOpenAIBillingSnapshot(filtersFromRequest(request)) });
    }

    if (action === "settings") {
      const warnings = Array.isArray(body?.lowBalanceWarningsUsd)
        ? body.lowBalanceWarningsUsd.map(Number)
        : undefined;
      const settings = updateOpenAIBillingSettings({
        lowBalanceWarningsUsd: warnings,
      });
      return noStore({ ok: true, settings, snapshot: buildOpenAIBillingSnapshot(filtersFromRequest(request)) });
    }

    if (action === "sync") {
      if (!openAIAdminConfigured()) {
        return noStore({
          ok: false,
          error: "OPENAI_ADMIN_API_KEY is not configured for official OpenAI billing sync.",
          snapshot: buildOpenAIBillingSnapshot(),
        }, 200);
      }
      const result = await syncOpenAIOfficialBilling(Number(body?.days || 30));
      return noStore({ ...result, snapshot: buildOpenAIBillingSnapshot(filtersFromRequest(request)) }, result.ok ? 200 : 502);
    }

    return noStore({ ok: false, error: "Unknown OpenAI billing action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI billing update failed.";
    return noStore({ ok: false, error: message }, error instanceof RequestError?error.status:500);
  }
}

