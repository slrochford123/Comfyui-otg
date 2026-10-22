import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import OpenAI, { toFile } from "openai";

export type OpenAIUseCase =
  | "h3-director"
  | "story-helper"
  | "story-write"
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

type UsageSummary = {
  records: OpenAIUsageRecord[];
};

type RateWindow = {
  startedAt: number;
  count: number;
};

const DEFAULT_MODEL_PRICING: Record<string, {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  audioUsdPerMinute?: number;
}> = {
  "gpt-6-luna": { inputUsdPer1M: 0.10, outputUsdPer1M: 0.50 },
  "gpt-6.1-sol": { inputUsdPer1M: 2.00, outputUsdPer1M: 10.00 },
  "gpt-transcribe": { inputUsdPer1M: 0, outputUsdPer1M: 0, audioUsdPerMinute: 0.0045 },
};

let client: OpenAI | null = null;
const rateWindows = new Map<string, RateWindow>();

function dataRoot() {
  return (
    String(process.env.OTG_DATA_DIR || "").trim() ||
    String(process.env.OTG_DATA_ROOT || "").trim() ||
    path.join(os.homedir(), "AI", "runtime", "test", "data")
  );
}

function usagePath() {
  const dir = path.join(dataRoot(), "openai");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "usage.json");
}

function readUsage(): UsageSummary {
  try {
    const parsed = JSON.parse(fs.readFileSync(usagePath(), "utf8"));
    return {
      records: Array.isArray(parsed?.records) ? parsed.records : [],
    };
  } catch {
    return { records: [] };
  }
}

export function readOpenAIUsageRecords(): OpenAIUsageRecord[] {
  return readUsage().records;
}

function writeUsage(summary: UsageSummary) {
  fs.writeFileSync(
    usagePath(),
    JSON.stringify(
      {
        records: summary.records.slice(-5000),
      },
      null,
      2,
    ),
  );
}

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
    });
  }
  return client;
}

export function assertOpenAIAuthorized(ownerKey: string, useCase: OpenAIUseCase) {
  if (!openAIEnabled()) {
    throw new Error("OpenAI is not configured or is disabled.");
  }

  const now = Date.now();
  const key = `${ownerKey}:${useCase}`;
  const windowMs = numberFromEnv("OPENAI_RATE_WINDOW_MS", 60_000);
  const maxRequests = numberFromEnv("OPENAI_RATE_LIMIT_PER_MINUTE", 12);
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt > windowMs) {
    rateWindows.set(key, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > maxRequests) {
      const error = new Error("OpenAI rate limit reached. Please wait and retry.");
      (error as any).status = 429;
      throw error;
    }
  }

  const summary = readUsage();
  const since = now - 24 * 60 * 60 * 1000;
  const userTotal = summary.records
    .filter((record) => record.ownerKey === ownerKey && record.ts >= since)
    .reduce((sum, record) => sum + record.approximateCostUsd, 0);
  const globalTotal = summary.records
    .filter((record) => record.ts >= since)
    .reduce((sum, record) => sum + record.approximateCostUsd, 0);

  const userLimit = numberFromEnv("OPENAI_DAILY_USER_COST_LIMIT_USD", 2);
  const globalLimit = numberFromEnv("OPENAI_DAILY_GLOBAL_COST_LIMIT_USD", 20);
  if (userLimit > 0 && userTotal >= userLimit) {
    const error = new Error("Daily OpenAI cost limit reached for this user.");
    (error as any).status = 429;
    throw error;
  }
  if (globalLimit > 0 && globalTotal >= globalLimit) {
    const error = new Error("Daily OpenAI global cost limit reached.");
    (error as any).status = 429;
    throw error;
  }
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
          : { inputUsdPer1M: 0, outputUsdPer1M: 0, audioUsdPerMinute: 0 });
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

function recordUsage(record: OpenAIUsageRecord) {
  const summary = readUsage();
  summary.records.push(record);
  writeUsage(summary);
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
}) {
  assertOpenAIAuthorized(args.ownerKey, args.useCase);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 90_000);

  try {
    const response: any = await getClient().responses.create(
      {
        model: args.model,
        instructions: args.instructions,
        input: args.input,
        max_output_tokens: args.maxOutputTokens || 900,
      } as any,
      { signal: controller.signal } as any,
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
    });
    return { text, usage };
  } finally {
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
}): Promise<AsyncGenerator<OpenAITextStreamEvent>> {
  if (args.signal?.aborted) {
    const error = new Error("OpenAI streaming cancelled before starting.");
    error.name = "AbortError";
    throw error;
  }
  assertOpenAIAuthorized(args.ownerKey, args.useCase);
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
      } as any,
      { signal: controller.signal } as any,
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
              });
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
        });
        yield { type: "done", text: finalText, usage };
      } finally {
        cleanup();
        if (!controller.signal.aborted) controller.abort();
      }
    }

    return events();
  } catch (error) {
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
  assertOpenAIAuthorized(args.ownerKey, "transcribe");
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
      { signal: controller.signal } as any,
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
    });
    return { text, usage };
  } finally {
    clearTimeout(timer);
  }
}

