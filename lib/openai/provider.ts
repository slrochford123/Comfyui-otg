import { readLedgerUsage, reserveOpenAIUsage, settleOpenAIUsage, finishUnsettledOpenAIUsage, ConversationCreditInsufficient, noteConversationProvider, conversationCreditStatus, markOpenAIResponse, readUncertainConversationRequest } from "@/lib/openai/usageLedger";
import {RequestError} from "@/lib/requestError";
import { conversationalAccount, conversationFeature, conversationPolicyEnabled, conversationRequestKey, isConversationalUseCase, recordConversationRoute } from "./conversationAccount";
import { conversationCostNanos, conversationPriceVersion, conversationReserveNanos } from "./conversationPricing";
import { local3060Enabled, LOCAL_MODEL } from "@/lib/workers/local3060";
import { OpenAIGlobalBudgetReached, type ConversationFallbackReason } from "./usageLedger";
import { productionBudgetEnabled } from "./budgetDay";

import OpenAI, { toFile } from "openai";

export type OpenAIUseCase =
  | "h3-director"
  | "story-helper"
  | "story-write"
  | "prompt-enhance"
  | "vision-description"
  | "transcribe"
  | "story-image";

export type OpenAIUsageRecord = {
  ts: number;
  ownerKey: string;
  projectId?: string;
  useCase: OpenAIUseCase;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  audioSeconds: number;
  approximateCostUsd: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  accountId?: string;
  priceVersion?: string;
  feature?: string;
};

type Routing = {provider:"openai"|"local3060";model:string;fallbackReason?:ConversationFallbackReason};
export type RoutedTextStream = AsyncGenerator<OpenAITextStreamEvent> & { routing?:Routing };
type TextRequest = {
  ownerKey:string; accountId?:string; requestKey?:string; projectId?:string;feature?:string;
  useCase:Exclude<OpenAIUseCase,"transcribe" | "story-image">; model:string; instructions:string; input:any;
  maxOutputTokens?:number; timeoutMs?:number; signal?:AbortSignal; maxRetries?:number; store?:boolean;
  responseSchema?:{name:string;schema:Record<string,unknown>};tools?:Array<Record<string,unknown>>;
  localVariant?:{instructions:string;input:any};
};

export type OpenAITextStreamEvent =
  | { type: "status"; phase: "queued" | "generating" }
  | { type: "delta"; delta: string }
  | {
      type: "done";
      text: string;
      toolCalls?: Array<{ name: string; arguments: string; call_id: string }>;
      usage: ReturnType<typeof usageFromResponse>;
    };

const DEFAULT_MODEL_PRICING: Record<string, {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  audioUsdPerMinute?: number;
}> = {
  "gpt-4.1-mini": { inputUsdPer1M: 0.40, outputUsdPer1M: 1.60 },
  "gpt-6-luna": { inputUsdPer1M: 0.10, outputUsdPer1M: 0.50 },
  "gpt-6.1-sol": { inputUsdPer1M: 2.00, outputUsdPer1M: 10.00 },
  "gpt-transcribe": { inputUsdPer1M: 0, outputUsdPer1M: 0, audioUsdPerMinute: 0.0045 },
};

let client: OpenAI | null = null;
export function readOpenAIUsageRecords(): OpenAIUsageRecord[] { return readLedgerUsage(); }

function numberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function boolFromEnv(name: string) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function openAIEnabled() {
  return Boolean(String(process.env.OPENAI_API_KEY || "").trim()) &&
    !boolFromEnv("OPENAI_KILL_SWITCH");
}

export function openAIModels() {
  return {
    h3: String(process.env.OPENAI_H3_MODEL || "gpt-6-luna").trim() || "gpt-6-luna",
    story:
      String(process.env.OPENAI_STORY_MODEL || "gpt-6.1-sol").trim() ||
      "gpt-6.1-sol",
    transcribe:
      String(process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe").trim() ||
      "gpt-transcribe",
  };
}

export function getOpenAIClient() {
  if (!openAIEnabled()) {
    throw new Error("OpenAI is not configured or is disabled.");
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0, // Ambiguous billable requests are not silently replayed.
    });
  }
  return client;
}

export function assertOpenAIAuthorized(ownerKey: string, useCase: OpenAIUseCase, reservedUsd = 0.25, allowance?:Parameters<typeof reserveOpenAIUsage>[0]["allowance"]) {
  if (!openAIEnabled()) throw new Error("OpenAI is not configured or is disabled.");
  return reserveOpenAIUsage({
    ownerKey, useCase, reservedUsd,allowance,
    windowMs: numberFromEnv("OPENAI_RATE_WINDOW_MS", 60000),
    maxRequests: numberFromEnv("OPENAI_RATE_LIMIT_PER_MINUTE", 12),
    userLimit: allowance ? 0 : numberFromEnv("OPENAI_DAILY_USER_COST_LIMIT_USD", 2),
    globalLimit: numberFromEnv("OPENAI_DAILY_GLOBAL_COST_LIMIT_USD", 20),
  });
}

async function reserveTextRequest(args: TextRequest): Promise<{id:string;allowance:boolean}|{id:null;reason:ConversationFallbackReason}> {
  // Deliberately conservative byte-based upper estimate, not a token count claim.
  const inputBytes = Buffer.byteLength(JSON.stringify([args.instructions,args.input,args.tools,args.responseSchema]));
  if (inputBytes > 8 * 1024 * 1024) throw new Error("OpenAI input exceeds the application request limit.");
  if (conversationPolicyEnabled() && isConversationalUseCase(args.useCase)) {
    const account = await conversationalAccount(args.ownerKey,args.accountId);
    const nanos = conversationReserveNanos(args.model,inputBytes,args.maxOutputTokens||900);
    try {
      if (!openAIEnabled()&&!account.admin&&nanos>(conversationCreditStatus(account).availableNanos||0))
        throw new ConversationCreditInsufficient();
      const requested=conversationRequestKey(args.requestKey);
      if(requested&&!/^[\w.-]{8,120}$/.test(requested))throw new Error("Invalid conversational idempotency key.");
      const feature = conversationFeature(args.feature) || args.useCase;
      const id = assertOpenAIAuthorized(args.ownerKey,args.useCase,nanos/1e9,{account,nanos,model:args.model,feature,
        priceVersion:conversationPriceVersion,requestKey:requested?args.useCase+":"+requested:undefined});
      noteConversationProvider(account,feature,"openai");
      recordConversationRoute("openai",args.model);
      return {id,allowance:true};
    } catch (error) {
      const reason = error instanceof ConversationCreditInsufficient ? "allowance" :
        productionBudgetEnabled() && error instanceof OpenAIGlobalBudgetReached ? "global-budget" : null;
      if (!reason || !local3060Enabled()) throw error;
      noteConversationProvider(account,conversationFeature(args.feature)||args.useCase,"local3060",reason);
      recordConversationRoute("local3060",LOCAL_MODEL);
      return {id:null,reason};
    }
  }
  const estimate = tokenCost(args.model, inputBytes + 4096, args.maxOutputTokens || 900);
  return {id:assertOpenAIAuthorized(args.ownerKey,args.useCase,Math.max(numberFromEnv("OPENAI_REQUEST_RESERVE_USD",0.25),estimate)),allowance:false};
}

async function fallbackStream(args: TextRequest, reason: ConversationFallbackReason):Promise<RoutedTextStream> {
  const {createLocalAssistantStream} = await import("@/lib/workers/assistantProvider");
  const stream=await createLocalAssistantStream({...args,...args.localVariant});
  stream.routing={provider:"local3060",model:LOCAL_MODEL,fallbackReason:reason};
  return stream;
}

function definitelyRejected(error: unknown) {
  const status = (error as { status?: number })?.status;
  return [400, 401, 403, 404, 422, 429].includes(Number(status));
}

function pricingForModel(model: string) {
  const normalized = model.toLowerCase();
  return DEFAULT_MODEL_PRICING[normalized] ||
    (normalized.includes("luna")
      ? DEFAULT_MODEL_PRICING["gpt-6-luna"]
      : normalized.includes("sol")
        ? DEFAULT_MODEL_PRICING["gpt-6.1-sol"]
        : normalized.includes("transcribe")
          ? DEFAULT_MODEL_PRICING["gpt-transcribe"]
          : { inputUsdPer1M: numberFromEnv("OPENAI_UNKNOWN_INPUT_USD_PER_1M", 20), outputUsdPer1M: numberFromEnv("OPENAI_UNKNOWN_OUTPUT_USD_PER_1M", 100), audioUsdPerMinute: 0 });
}

function tokenCost(model: string, inputTokens: number, outputTokens: number) {
  const normalized = model.toLowerCase();
  const defaults = pricingForModel(model);
  const configured = openAIModels();
  const prefix = normalized === configured.h3.toLowerCase() ||
    normalized.includes("luna") ||
    normalized.includes("h3")
    ? "OPENAI_H3"
    : normalized === configured.transcribe.toLowerCase() ||
      normalized.includes("transcribe")
      ? "OPENAI_TRANSCRIBE"
      : "OPENAI_STORY";
  const inputPerMillion = numberFromEnv(`${prefix}_INPUT_USD_PER_1M`, defaults.inputUsdPer1M);
  const outputPerMillion = numberFromEnv(`${prefix}_OUTPUT_USD_PER_1M`, defaults.outputUsdPer1M);
  return (
    (inputTokens / 1_000_000) * inputPerMillion +
    (outputTokens / 1_000_000) * outputPerMillion
  );
}

function audioCost(model: string, audioSeconds: number) {
  const perMinute = numberFromEnv(
    "OPENAI_TRANSCRIBE_USD_PER_MINUTE",
    pricingForModel(model).audioUsdPerMinute || 0,
  );
  return (audioSeconds / 60) * perMinute;
}

export function estimateOpenAIUsageCost(record: Pick<OpenAIUsageRecord, "model" | "inputTokens" | "outputTokens" | "audioSeconds" | "approximateCostUsd">) {
  if ("priceVersion" in record && record.priceVersion) return record.approximateCostUsd;
  const recorded = Number(record.approximateCostUsd || 0) || 0;
  const estimated = tokenCost(record.model, record.inputTokens, record.outputTokens) +
    audioCost(record.model, record.audioSeconds);
  if (recorded > 0 && estimated <= 0) return recorded;
  return estimated;
}

function recordUsage(record: OpenAIUsageRecord, reservationId: string, providerId?: string) {
  settleOpenAIUsage(reservationId, record, providerId);
}

function usageFromResponse(response: any) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens || usage.inputTokens || 0) || 0;
  const outputTokens = Number(usage.output_tokens || usage.outputTokens || 0) || 0;
  const totalTokens =
    Number(usage.total_tokens || usage.totalTokens || inputTokens + outputTokens) || 0;
  const details=usage.input_tokens_details;
  return { inputTokens, outputTokens, totalTokens,...(details?{cachedInputTokens:Number(details.cached_tokens)||0,cacheWriteTokens:Number(details.cache_write_tokens)||0}:{}) };
}

function recordTextUsage(args:TextRequest,response:any,reservationId:string,allowance:boolean) {
  const usage=usageFromResponse(response);
  if (response?.usage || !allowance) recordUsage({ts:Date.now(),ownerKey:args.ownerKey,projectId:args.projectId,useCase:args.useCase,
    feature:allowance?conversationFeature(args.feature):undefined,
    model:allowance?(response.model||args.model):args.model,...usage,audioSeconds:0,
    approximateCostUsd:allowance?conversationCostNanos(response.model||args.model,usage)/1e9:tokenCost(args.model,usage.inputTokens,usage.outputTokens)},
  reservationId,response.id||response._request_id);
  return usage;
}

/** Admin-only callers can reconcile an interrupted stored response without replaying generation. */
export async function reconcileConversationUsage(id:string, actor:string) {
  const hold=readUncertainConversationRequest(id);
  if(!hold?.providerId||!/^resp_[\w-]+$/.test(hold.providerId))
    throw new RequestError("No stored OpenAI response ID is available for this hold.",409);
  const response=await getOpenAIClient().responses.retrieve(hold.providerId,{},{signal:AbortSignal.timeout(10_000)});
  if(response.id!==hold.providerId||!response.usage||!["completed","incomplete","failed","cancelled"].includes(String(response.status)))
    throw new RequestError("OpenAI has no terminal usage record for this response yet.",409);
  const usage=usageFromResponse(response);
  const model=response.model||hold.model;
  settleOpenAIUsage(id,{ts:Date.now(),ownerKey:hold.owner,useCase:hold.useCase,feature:hold.feature||undefined,model,...usage,audioSeconds:0,
    approximateCostUsd:conversationCostNanos(model,usage)/1e9},hold.providerId,actor);
}

export async function createOpenAIText(args: TextRequest):Promise<{text:string;usage:{inputTokens:number;outputTokens:number;totalTokens:number;cachedInputTokens?:number;cacheWriteTokens?:number}} & Routing> {
  const route=await reserveTextRequest(args);
  if (route.id === null) {
    const stream=await fallbackStream(args,route.reason);
    for await (const event of stream) if (event.type==="done") return {text:event.text,usage:event.usage,...stream.routing!};
    throw new Error("Local AI ended without a complete response.");
  }
  const {id:reservationId,allowance}=route;
  const controller = new AbortController();
  const abort=()=>controller.abort();
  if(args.signal?.aborted)controller.abort();
  args.signal?.addEventListener("abort",abort,{once:true});
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 90_000);

  try {
    const response: any = await getOpenAIClient().responses.create(
      {
        model: args.model,
        instructions: args.instructions,
        input: args.input,
        max_output_tokens: args.maxOutputTokens || 900,
        ...(allowance ? {service_tier:"default"} : {}),
        ...(args.responseSchema ? { text: { format: { type: "json_schema", name: args.responseSchema.name, strict: true, schema: args.responseSchema.schema } } } : {}),
        ...(args.store !== undefined ? { store: args.store } : {}),
      } as any,
      { signal: controller.signal, maxRetries: allowance?0:Math.max(0, Math.min(1, args.maxRetries ?? 0)), headers: { "X-Client-Request-Id": reservationId } } as any,
    );

    const text = String(response.output_text || "").trim();
    const usage = recordTextUsage(args,response,reservationId,allowance);
    return {text,usage,provider:"openai",model:response.model||args.model};
  } catch (error) {
    finishUnsettledOpenAIUsage(reservationId, definitelyRejected(error));
    throw error;
  } finally {
    finishUnsettledOpenAIUsage(reservationId);
    clearTimeout(timer);
    args.signal?.removeEventListener("abort",abort);
  }
}

export async function createOpenAITextStream(args: TextRequest): Promise<RoutedTextStream> {
  if (args.signal?.aborted) {
    const error = new Error("OpenAI streaming cancelled before starting.");
    error.name = "AbortError";
    throw error;
  }
  const route=await reserveTextRequest(args);
  if (route.id === null) return fallbackStream(args,route.reason);
  const {id:reservationId,allowance}=route;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  args.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 90_000);

  const cleanup = () => {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", abortFromCaller);
  };

  try {
    const upstream: any = await getOpenAIClient().responses.create(
      {
        model: args.model,
        instructions: args.instructions,
        input: args.input,
        max_output_tokens: args.maxOutputTokens || 900,
        stream: true,
        ...(allowance ? {service_tier:"default"} : {}),
        ...(args.tools?.length ? { tools: args.tools, parallel_tool_calls: false } : {}),
        ...(args.responseSchema ? { text: { format: { type: "json_schema", name: args.responseSchema.name, strict: true, schema: args.responseSchema.schema } } } : {}),
      } as any,
      { signal: controller.signal, maxRetries: allowance?0:Math.max(0, Math.min(1, args.maxRetries ?? 0)), headers: { "X-Client-Request-Id": reservationId } } as any,
    );

    async function* events(): AsyncGenerator<OpenAITextStreamEvent> {
      let text = "";
      let completedResponse: any = null;
      try {
        for await (const event of upstream) {
          if(allowance&&event?.type==="response.created"&&event.response?.id)markOpenAIResponse(reservationId,event.response.id);
          if (allowance && event?.response?.usage && ["response.completed","response.incomplete","response.failed"].includes(event.type))
            recordTextUsage(args,event.response,reservationId,true);
          if (controller.signal.aborted) {
            const error = new Error("OpenAI streaming cancelled.");
            error.name = "AbortError";
            throw error;
          }
          if (event?.type === "response.output_text.delta") {
            const delta = String(event.delta || "");
            if (delta) {
              text += delta;
              if (controller.signal.aborted) {
                const error = new Error("OpenAI streaming cancelled.");
                error.name = "AbortError";
                throw error;
              }
              yield { type: "delta", delta };
            }
          } else if (event?.type === "response.completed") {
            completedResponse = event.response;
          } else if (
            event?.type === "response.failed" ||
            event?.type === "response.incomplete"
          ) {
            // Record usage reported by OpenAI even when generation fails.
            if (event.response?.usage && !allowance) {
              const failedUsage = usageFromResponse(event.response);
              recordUsage({
                ts: Date.now(),
                ownerKey: args.ownerKey,
                projectId: args.projectId,
                useCase: args.useCase,
                model: args.model,
                ...failedUsage,
                audioSeconds: 0,
                approximateCostUsd: tokenCost(
                  args.model,
                  failedUsage.inputTokens,
                  failedUsage.outputTokens,
                ),
              }, reservationId, event.response?.id);
            }
            if (allowance && event.type === "response.incomplete" && text.trim()) {
              completedResponse=event.response;
              break;
            }
            throw new Error(
              String(
                event.type === "response.incomplete"
                  ? event.response?.incomplete_details?.reason ||
                    "OpenAI response incomplete."
                  : event.response?.error?.message ||
                    "OpenAI response failed.",
              ),
            );
          } else if (event?.type === "error") {
            throw new Error(String(event.error?.message || event.message || "OpenAI stream failed."));
          }
        }

        if (!completedResponse) {
          throw new Error("OpenAI stream ended before completion.");
        }

        const finalText = String(completedResponse.output_text || text).trim();
        const usage = usageFromResponse(completedResponse);
        if (!allowance) recordUsage({
          ts: Date.now(),
          ownerKey: args.ownerKey,
          projectId: args.projectId,
          useCase: args.useCase,
          model: args.model,
          ...usage,
          audioSeconds: 0,
          approximateCostUsd: tokenCost(
            args.model,
            usage.inputTokens,
            usage.outputTokens,
          ),
        }, reservationId, completedResponse.id || completedResponse._request_id);
        const toolCalls = (completedResponse.output || []).filter((item: any) => item.type === "function_call")
          .map((item: any) => ({name:String(item.name),arguments:String(item.arguments),call_id:String(item.call_id)}));
        yield { type: "done", text: finalText, usage, ...(args.tools?.length ? {toolCalls} : {}) };
      } finally {
        finishUnsettledOpenAIUsage(reservationId);
        cleanup();
        if (!controller.signal.aborted) controller.abort();
      }
    }

    return Object.assign(events(),{routing:{provider:"openai" as const,model:args.model}});
  } catch (error) {
    finishUnsettledOpenAIUsage(reservationId, definitelyRejected(error));
    cleanup();
    throw error;
  }
}

export async function transcribeOpenAIAudio(args: {
  ownerKey: string;
  projectId?: string;
  audio: Buffer;
  fileName: string;
  mimeType: string;
  prompt?: string;
  keywords?: string[];
  language?: string;
  audioSeconds?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}) {
  args.signal?.throwIfAborted();
  const model = openAIModels().transcribe;
  const reservationId = assertOpenAIAuthorized(args.ownerKey, "transcribe", Math.max(0.25, audioCost(model, Math.max(0, Number(args.audioSeconds || 0)))));
  const controller = new AbortController();
  const signal = args.signal ? AbortSignal.any([args.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 120_000);

  try {
    const file = await toFile(args.audio, args.fileName, {
      type: args.mimeType || "audio/webm",
    });
    const response: any = await getOpenAIClient().audio.transcriptions.create(
      {
        file,
        model,
        prompt: args.prompt || undefined,
        keywords: args.keywords?.length ? args.keywords : undefined,
        languages: args.language ? [args.language] : undefined,
      } as any,
      { signal, maxRetries: 0, headers: { "X-Client-Request-Id": reservationId } } as any,
    );
    const text = String(response.text || "").trim();
    const usage = usageFromResponse(response);
    const audioSeconds = Math.max(0, Number(args.audioSeconds || 0) || 0);
    recordUsage({
      ts: Date.now(),
      ownerKey: args.ownerKey,
      projectId: args.projectId,
      useCase: "transcribe",
      model,
      ...usage,
      audioSeconds,
      approximateCostUsd:
        tokenCost(model, usage.inputTokens, usage.outputTokens) +
        audioCost(model, audioSeconds),
    }, reservationId, response.id || response._request_id);
    return { text, usage };
  } catch (error) {
    finishUnsettledOpenAIUsage(reservationId, definitelyRejected(error));
    throw error;
  } finally {
    finishUnsettledOpenAIUsage(reservationId);
    clearTimeout(timer);
  }
}

