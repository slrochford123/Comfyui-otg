import { readLedgerUsage, reserveOpenAIUsage, settleOpenAIUsage, finishUnsettledOpenAIUsage } from "@/lib/openai/usageLedger";

import OpenAI, { toFile } from "openai";

export type OpenAIUseCase =
  | "h3-director"
  | "story-helper"
  | "story-write"
  | "prompt-enhance"
  | "vision-description"
  | "transcribe";

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
};

export type OpenAITextStreamEvent =
  | { type: "delta"; delta: string }
  | {
      type: "done";
      text: string;
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

function getClient() {
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

export function assertOpenAIAuthorized(ownerKey: string, useCase: OpenAIUseCase, reservedUsd = 0.25) {
  if (!openAIEnabled()) throw new Error("OpenAI is not configured or is disabled.");
  return reserveOpenAIUsage({
    ownerKey, useCase, reservedUsd,
    windowMs: numberFromEnv("OPENAI_RATE_WINDOW_MS", 60000),
    maxRequests: numberFromEnv("OPENAI_RATE_LIMIT_PER_MINUTE", 12),
    userLimit: numberFromEnv("OPENAI_DAILY_USER_COST_LIMIT_USD", 2),
    globalLimit: numberFromEnv("OPENAI_DAILY_GLOBAL_COST_LIMIT_USD", 20),
  });
}

function reserveTextRequest(args: { ownerKey: string; useCase: OpenAIUseCase; model: string; instructions: string; input: unknown; maxOutputTokens?: number }) {
  // Deliberately conservative byte-based upper estimate, not a token count claim.
  const inputBytes = Buffer.byteLength(args.instructions) + Buffer.byteLength(JSON.stringify(args.input) || "");
  if (inputBytes > 8 * 1024 * 1024) throw new Error("OpenAI input exceeds the application request limit.");
  const estimate = tokenCost(args.model, inputBytes + 4096, args.maxOutputTokens || 900);
  return assertOpenAIAuthorized(args.ownerKey, args.useCase, Math.max(numberFromEnv("OPENAI_REQUEST_RESERVE_USD", 0.25), estimate));
}

function definitelyRejected(error: unknown) {
  const status = (error as { status?: number })?.status;
  return [400, 401, 403, 404, 422].includes(Number(status));
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
  return { inputTokens, outputTokens, totalTokens };
}

export async function createOpenAIText(args: {
  ownerKey: string;
  projectId?: string;
  useCase: Exclude<OpenAIUseCase, "transcribe">;
  model: string;
  instructions: string;
  input: any;
  maxOutputTokens?: number;
  timeoutMs?: number;
  responseSchema?: { name: string; schema: Record<string, unknown> };
  store?: boolean;
  maxRetries?: number;
}) {
  const reservationId = reserveTextRequest(args);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 90_000);

  try {
    const response: any = await getClient().responses.create(
      {
        model: args.model,
        instructions: args.instructions,
        input: args.input,
        max_output_tokens: args.maxOutputTokens || 900,
        ...(args.responseSchema ? { text: { format: { type: "json_schema", name: args.responseSchema.name, strict: true, schema: args.responseSchema.schema } } } : {}),
        ...(args.store !== undefined ? { store: args.store } : {}),
      } as any,
      { signal: controller.signal, maxRetries: Math.max(0, Math.min(1, args.maxRetries ?? 0)), headers: { "X-Client-Request-Id": reservationId } } as any,
    );

    const text = String(response.output_text || "").trim();
    const usage = usageFromResponse(response);
    recordUsage({
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

export async function createOpenAITextStream(args: {
  ownerKey: string;
  projectId?: string;
  useCase: Exclude<OpenAIUseCase, "transcribe">;
  model: string;
  instructions: string;
  input: any;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  responseSchema?: { name: string; schema: Record<string, unknown> };
}): Promise<AsyncGenerator<OpenAITextStreamEvent>> {
  if (args.signal?.aborted) {
    const error = new Error("OpenAI streaming cancelled before starting.");
    error.name = "AbortError";
    throw error;
  }
  const reservationId = reserveTextRequest(args);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  args.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 90_000);

  const cleanup = () => {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", abortFromCaller);
  };

  try {
    const upstream: any = await getClient().responses.create(
      {
        model: args.model,
        instructions: args.instructions,
        input: args.input,
        max_output_tokens: args.maxOutputTokens || 900,
        stream: true,
        ...(args.responseSchema ? { text: { format: { type: "json_schema", name: args.responseSchema.name, strict: true, schema: args.responseSchema.schema } } } : {}),
      } as any,
      { signal: controller.signal, maxRetries: Math.max(0, Math.min(1, args.maxRetries ?? 0)), headers: { "X-Client-Request-Id": reservationId } } as any,
    );

    async function* events(): AsyncGenerator<OpenAITextStreamEvent> {
      let text = "";
      let completedResponse: any = null;
      try {
        for await (const event of upstream) {
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
            if (event.response?.usage) {
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
        recordUsage({
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
        yield { type: "done", text: finalText, usage };
      } finally {
        finishUnsettledOpenAIUsage(reservationId);
        cleanup();
        if (!controller.signal.aborted) controller.abort();
      }
    }

    return events();
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
  language?: string;
  audioSeconds?: number;
  timeoutMs?: number;
}) {
  const model = openAIModels().transcribe;
  const reservationId = assertOpenAIAuthorized(args.ownerKey, "transcribe", Math.max(0.25, audioCost(model, Math.max(0, Number(args.audioSeconds || 0)))));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 120_000);

  try {
    const file = await toFile(args.audio, args.fileName, {
      type: args.mimeType || "audio/webm",
    });
    const response: any = await getClient().audio.transcriptions.create(
      {
        file,
        model,
        prompt: args.prompt || undefined,
        languages: args.language ? [args.language] : undefined,
      } as any,
      { signal: controller.signal, maxRetries: 0, headers: { "X-Client-Request-Id": reservationId } } as any,
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

