import { NextRequest } from "next/server";
import {
  QWEN_CLUSTER_MODEL,
  qwenClusterFetch,
} from "@/lib/workers/qwenClusterRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnhanceLevel = "short" | "medium" | "long";
type EnhanceMode = "image" | "video";

type GenerateEnhanceContext = {
  mediaMode: EnhanceMode;
  imageOperation: string;
  videoGenerationType: string;
  workflowId: string;
  workflowLabel: string;
  selectedStyleId: string;
  styleLabel: string;
  stylePrompt: string;
};

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTrailingPunctuation(value: string) {
  return value
    .replace(/\s+([,;:.!?])$/u, "$1")
    // remove accidental duplicated trailing punctuation; a prompt ending in a comma will not become ',,' when context is added
    .replace(/([,;:])(?:\s*\1)+$/u, "$1")
    .trim();
}

function normalizePromptInput(value: unknown) {
  return normalizeTrailingPunctuation(cleanText(value));
}

function normalizeGeneratedPrompt(value: unknown) {
  return normalizeTrailingPunctuation(
    cleanText(value).replace(/^["'`]+|["'`]+$/g, ""),
  );
}

function normalizeLevel(value: unknown): EnhanceLevel {
  const raw = cleanText(value).toLowerCase();
  if (["small", "short", "light", "quick"].includes(raw)) return "short";
  if (
    ["large", "long", "cinematic", "dramatic", "intense"].includes(raw)
  ) {
    return "long";
  }
  return "medium";
}

function normalizeMode(value: unknown, workflowId: string): EnhanceMode {
  const raw = cleanText(value).toLowerCase();
  if (raw === "image" || raw === "photo" || raw === "picture") return "image";
  if (raw === "video" || raw === "movie" || raw === "animate") return "video";

  const wf = workflowId.toLowerCase();
  if (
    wf.includes("video") ||
    wf.includes("ltx") ||
    wf.includes("animate")
  ) {
    return "video";
  }

  return "image";
}

function buildGenerateContext(body: any): GenerateEnhanceContext {
  const workflowId = cleanText(
    body.workflowId || body.preset || body.workflow || "",
  );
  const styleLabel = cleanText(
    body.styleLabel || body.style || body.presetLabel || body.stylePreset || "",
  );
  const stylePrompt = cleanText(
    body.stylePrompt || body.styleDescription || body.styleText || "",
  );

  return {
    mediaMode: normalizeMode(
      body.mediaMode || body.generateMediaMode || body.mode || body.mediaType,
      workflowId,
    ),
    imageOperation: cleanText(body.imageOperation || body.operation || ""),
    videoGenerationType: cleanText(
      body.videoGenerationType || body.videoMode || "",
    ),
    workflowId,
    workflowLabel: cleanText(
      body.workflowLabel || body.presetLabel || body.workflowName || "",
    ),
    selectedStyleId: cleanText(body.selectedStyleId || body.styleId || ""),
    styleLabel,
    stylePrompt,
  };
}

function instructionForLevel(level: EnhanceLevel, mode: EnhanceMode) {
  if (level === "short") {
    return [
      "SHORT purpose: clean and lightly improve the user's idea.",
      "Use one or two concise sentences, or equivalent compact prompt phrasing.",
      "Preserve intent and add only a few useful scene-specific details.",
      "Short must not be a keyword dump or a generic suffix.",
    ].join("\n");
  }

  if (level === "medium") {
    return [
      "MEDIUM purpose: create a strong production-ready generation prompt.",
      "Cover the subject, action, environment, lighting, composition, and mood.",
      "Mention camera or framing only when it naturally helps the scene.",
      "Medium must be materially richer than Short.",
    ].join("\n");
  }

  if (mode === "video") {
    return [
      "LONG purpose: create a detailed cinematic generation prompt while staying faithful to the original idea.",
      "Develop the subject, action, environment, atmosphere, lighting, composition, depth, textures, camera, framing, video motion, and temporal direction.",
      "Long must be substantially richer than Medium without meaningless padding.",
    ].join("\n");
  }

  return [
    "LONG purpose: create a detailed cinematic generation prompt while staying faithful to the original idea.",
    "Develop the subject, action, environment, atmosphere, lighting, composition, depth, textures, camera, and framing.",
    "Do not add motion language unless the user explicitly asks for motion.",
    "Long must be substantially richer than Medium without meaningless padding.",
  ].join("\n");
}

function instructionForMode(mode: EnhanceMode) {
  if (mode === "image") {
    return [
      "IMAGE context:",
      "Focus on composition, subject appearance, environment, lighting, framing, depth, material detail, and mood.",
      "Do not add video-only language to image prompts unless the user explicitly asks for motion.",
    ].join("\n");
  }

  return [
    "VIDEO context:",
    "Include motion, camera movement, action progression, and temporal behavior when those details support the user's request.",
    "Keep continuity practical and avoid inventing major new story facts.",
  ].join("\n");
}

function contextLines(context: GenerateEnhanceContext) {
  const operation =
    context.mediaMode === "video"
      ? context.videoGenerationType || "create"
      : context.imageOperation || "create";

  return [
    `mediaMode: ${context.mediaMode}`,
    `operation: ${operation}`,
    `imageOperation: ${context.imageOperation || "none"}`,
    `videoGenerationType: ${context.videoGenerationType || "none"}`,
    `workflowId: ${context.workflowId || "not specified"}`,
    `workflowLabel: ${context.workflowLabel || "not specified"}`,
    `selectedStyleId: ${context.selectedStyleId || "none"}`,
    `styleLabel: ${context.styleLabel || "none"}`,
    `stylePrompt: ${context.stylePrompt || "none"}`,
  ].join("\n");
}

function buildQwenEnhancePrompt(
  prompt: string,
  level: EnhanceLevel,
  context: GenerateEnhanceContext,
) {
  return [
    "/no_think",
    "",
    "You enhance prompts for the Generate screen.",
    "Return exactly one JSON object with a single string field named \"enhancedPrompt\".",
    "The value must be the finished prompt only: no markdown, no labels, no notes, no analysis.",
    "Preserve the user's subject, action, identity, dialogue, and core intent.",
    "Do not add unrelated characters, locations, lore, or major story facts.",
    "Use the selected style only when one is present in the Generate context.",
    "Avoid generic filler phrases and do not append canned quality tags.",
    "",
    instructionForLevel(level, context.mediaMode),
    "",
    instructionForMode(context.mediaMode),
    "",
    "Original user prompt:",
    prompt,
    "",
    "Requested enhancement level:",
    level,
    "",
    "Generate context:",
    contextLines(context),
    "",
    "Enhanced prompt JSON only:",
  ].join("\n");
}

function numPredictForLevel(level: EnhanceLevel) {
  if (level === "short") return 90;
  if (level === "medium") return 180;
  return 320;
}

function temperatureForLevel(level: EnhanceLevel) {
  if (level === "short") return 0.25;
  if (level === "medium") return 0.35;
  return 0.42;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractEnhancedPrompt(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";

  const parsed = parseJsonObject(raw);
  if (parsed) {
    return normalizeGeneratedPrompt(
      parsed.enhancedPrompt || parsed.prompt || parsed.result || "",
    );
  }

  return normalizeGeneratedPrompt(
    raw.replace(/^(?:enhanced\s+prompt|prompt)\s*:\s*/i, ""),
  );
}

async function qwenGenerateEnhancement(
  prompt: string,
  level: EnhanceLevel,
  context: GenerateEnhanceContext,
) {
  const response = await qwenClusterFetch(
    "/api/generate",
    {
      stream: false,
      think: false,
      prompt: buildQwenEnhancePrompt(prompt, level, context),
      format: {
        type: "object",
        properties: {
          enhancedPrompt: {
            type: "string",
            description:
              "A finished Generate prompt matching the requested enhancement level.",
          },
        },
        required: ["enhancedPrompt"],
        additionalProperties: false,
      },
      options: {
        temperature: temperatureForLevel(level),
        top_p: 0.85,
        repeat_penalty: 1.08,
        num_predict: numPredictForLevel(level),
        num_ctx: 4096,
      },
    },
    {
      model: QWEN_CLUSTER_MODEL,
      keepAlive: process.env.PROMPT_ENHANCE_KEEP_ALIVE || 0,
      timeoutMs: Math.max(
        5_000,
        Number(process.env.PROMPT_ENHANCE_TIMEOUT_MS || 45_000),
      ),
      waitMs: 5_000,
      leaseTtlSeconds: 90,
    },
  );

  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Prompt enhancer returned invalid JSON: ${raw.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || `Prompt enhancer failed with status ${response.status}.`,
    );
  }

  const enhancedPrompt = extractEnhancedPrompt(payload?.response);
  if (!enhancedPrompt) {
    throw new Error(
      "Prompt enhancer returned no text. The original prompt was preserved.",
    );
  }

  return enhancedPrompt;
}

async function parseIncoming(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return body || {};
  }

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    return Object.fromEntries(fd.entries());
  }

  const text = await req.text().catch(() => "");
  return { prompt: text };
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: unknown })?.status || 502);
  return Number.isFinite(status) && status >= 400 && status <= 599
    ? status
    : 502;
}

export async function POST(req: NextRequest): Promise<Response> {
  let originalPrompt = "";

  try {
    const body: any = await parseIncoming(req);
    originalPrompt = normalizePromptInput(
      body.prompt || body.userPrompt || body.input || body.text,
    );
    if (!originalPrompt) {
      return Response.json(
        { ok: false, error: "Missing prompt.", originalPrompt },
        { status: 400 },
      );
    }

    const level = normalizeLevel(
      body.enhanceLevel || body.level || body.size || body.amount,
    );
    const context = buildGenerateContext(body);
    const enhancedPrompt = await qwenGenerateEnhancement(
      originalPrompt,
      level,
      context,
    );

    return Response.json({
      ok: true,
      enhancedPrompt,
      prompt: enhancedPrompt,
      originalPrompt,
      level,
      size: level,
      mode: context.mediaMode,
      mediaMode: context.mediaMode,
      imageOperation: context.imageOperation,
      videoGenerationType: context.videoGenerationType,
      workflowId: context.workflowId,
      workflowLabel: context.workflowLabel,
      selectedStyleId: context.selectedStyleId,
      styleLabel: context.styleLabel,
      stylePrompt: context.stylePrompt,
      provider: "qwenCluster",
      model: QWEN_CLUSTER_MODEL,
    });
  } catch (error) {
    const baseMessage =
      error instanceof Error ? error.message : "Prompt enhancement failed.";
    const message = baseMessage.includes("The original prompt was preserved.")
      ? baseMessage
      : `${baseMessage} The original prompt was preserved.`;

    return Response.json(
      {
        ok: false,
        error: message,
        originalPrompt,
        prompt: originalPrompt,
      },
      { status: errorStatus(error) },
    );
  }
}
