import { NextRequest } from "next/server";
import { QWEN_CLUSTER_MODEL } from "@/lib/workers/qwenClusterRouter";
import { qwenDurableFetch } from "@/lib/workers/qwenDurableFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ASSET_PROMPT_ENHANCE_QWEN_MODEL = "qwen3.5:4b";

const ASSET_PROMPT_ENHANCE_QWEN_MODEL =
  String(process.env.ASSET_PROMPT_ENHANCE_QWEN_MODEL || "").trim() ||
  DEFAULT_ASSET_PROMPT_ENHANCE_QWEN_MODEL;

type EnhanceLevel = "short" | "medium" | "long";
type EnhanceMode = "image" | "video";
type EnhanceContextType = "generate" | "asset";

type GenerateEnhanceContext = {
  contextType: EnhanceContextType;
  mediaMode: EnhanceMode;
  durationSeconds: number;
  imageOperation: string;
  videoGenerationType: string;
  workflowId: string;
  workflowLabel: string;
  selectedStyleId: string;
  styleLabel: string;
  stylePrompt: string;
  assetName: string;
  assetModelLabel: string;
  assetArtStyle: string;

  /*
   * OTG_PRODUCTION_V2_VISION_AWARE_ENHANCE_R12C_V1
   *
   * Production V2 may provide factual, role-labelled visual
   * observations. Other Enhance Prompt callers leave this blank
   * and retain their existing behavior.
   */
  visualContext: string;
};

function promptEnhanceModelForContext(
  context: GenerateEnhanceContext,
) {
  return context.contextType === "asset"
    ? ASSET_PROMPT_ENHANCE_QWEN_MODEL
    : QWEN_CLUSTER_MODEL;
}

function promptEnhanceKeepAliveForContext(
  context: GenerateEnhanceContext,
) {
  if (context.contextType === "asset") {
    // Asset Qwen must release VRAM immediately after enhancement.
    // The cluster GPU lease ends when the request completes, so retaining
    // the model afterward would leave untracked VRAM resident on a GPU that
    // may immediately be leased to ComfyUI.
    return 0;
  }

  // Preserve the pre-Asset Generate-screen behavior exactly.
  return process.env.PROMPT_ENHANCE_KEEP_ALIVE || 0;
}

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultiline(value: unknown) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
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

function normalizeContextType(value: unknown): EnhanceContextType {
  const raw = cleanText(value).toLowerCase();
  if (
    [
      "asset",
      "assets",
      "asset-gallery",
      "production-asset",
    ].includes(raw)
  ) {
    return "asset";
  }

  return "generate";
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
    contextType: normalizeContextType(
      body.contextType || body.promptContext || body.surface || "",
    ),
    mediaMode: normalizeMode(
      body.mediaMode || body.generateMediaMode || body.mode || body.mediaType,
      workflowId,
    ),
    durationSeconds: Math.max(
      0,
      Number(
        body.durationSeconds
        || body.duration
        || 0,
      ) || 0,
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
    assetName: cleanText(body.assetName || body.name || ""),
    assetModelLabel: cleanText(
      body.assetModelLabel || body.modelLabel || body.imageModelLabel || "",
    ),
    assetArtStyle: cleanText(body.assetArtStyle || body.artStyle || ""),

    visualContext:
      cleanMultiline(
        body.visualContext
        || "",
      ).slice(
        0,
        24_000,
      ),
  };
}

function instructionForLevel(
  level: EnhanceLevel,
  mode: EnhanceMode,
  contextType: EnhanceContextType,
) {
  if (contextType === "asset") {
    if (level === "short") {
      return [
        "SMALL asset purpose: restrained cleanup for an individual production asset/object/prop.",
        "Preserve most of the user's wording while improving clarity and adding only a few useful visual details.",
        "Keep this the shortest enhancement.",
      ].join("\n");
    }

    if (level === "medium") {
      return [
        "MEDIUM asset purpose: fuller production-ready image prompt for one individual production asset/object/prop.",
        "Add useful subject, material, silhouette, surface, color, lighting, composition, and continuity detail.",
        "Use moderate expansion and preserve the user's intended asset design.",
      ].join("\n");
    }

    return [
      "LARGE asset purpose: most detailed production prompt for one individual production asset/object/prop while preserving user intent.",
      "Develop detailed visual/material/environment/composition/lighting treatment with no unrelated invention.",
      "Keep the asset readable as one reusable production object and do not turn it into a video or broad story scene.",
    ].join("\n");
  }

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

function instructionForMode(
  mode: EnhanceMode,
) {
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

function instructionForAssetContext() {
  return [
    "Asset context:",
    "Treat the prompt as an individual production asset/object/prop, not as a scene, character sheet, or video prompt.",
    "Focus on shape, proportions, materials, colors, markings, surface detail, clean lighting, and useful production-reference composition.",
    "Keep any environment simple and supportive unless the user's asset request explicitly requires one.",
  ].join("\n");
}

function instructionForProductionV2LtxDuration(
  context: GenerateEnhanceContext,
) {
  if (
    context.videoGenerationType
    !== "ltx-ingredients-image-to-video"
  ) {
    return "";
  }

  const seconds =
    context.durationSeconds === 10
      ? 10
      : 5;

  return [
    "LTX 2.5 Ingredients duration authority:",
    `The requested generated clip is exactly ${seconds} seconds.`,
    seconds === 10
      ? "Use the full ten-second window for coherent temporal progression when it helps the user's action; do not compress it into five-second pacing."
      : "Use compact five-second pacing and avoid inventing unnecessary temporal progression.",
    "Character Cards, the Background Master, Asset references, and any continuation frame remain authoritative for appearance/continuity. The user prompt remains authoritative for action, dialogue, camera, performance, and new events.",
  ].join("\n");
}

function contextLines(context: GenerateEnhanceContext) {
  const operation =
    context.mediaMode === "video"
      ? context.videoGenerationType || "create"
      : context.imageOperation || "create";

  const lines = [
    `contextType: ${context.contextType}`,
    `mediaMode: ${context.mediaMode}`,
    `durationSeconds: ${context.durationSeconds || "not specified"}`,
    `operation: ${operation}`,
    `imageOperation: ${context.imageOperation || "none"}`,
    `videoGenerationType: ${context.videoGenerationType || "none"}`,
    `workflowId: ${context.workflowId || "not specified"}`,
    `workflowLabel: ${context.workflowLabel || "not specified"}`,
    `selectedStyleId: ${context.selectedStyleId || "none"}`,
    `styleLabel: ${context.styleLabel || "none"}`,
    `stylePrompt: ${context.stylePrompt || "none"}`,
  ];

  if (context.contextType === "asset") {
    lines.push(
      `assetName: ${context.assetName || "not specified"}`,
      `assetModelLabel: ${context.assetModelLabel || "not specified"}`,
      `assetArtStyle: ${context.assetArtStyle || context.styleLabel || "not specified"}`,
    );
  }

  return lines.join("\n");
}

function buildQwenEnhancePrompt(
  prompt: string,
  level: EnhanceLevel,
  context: GenerateEnhanceContext,
) {
  const isAsset =
    context.contextType === "asset";
  const ltxDurationInstruction =
    instructionForProductionV2LtxDuration(
      context,
    );

  return [
    "/no_think",
    "",
    isAsset
      ? "You enhance prompts for the Asset Gallery."
      : "You enhance prompts for the Generate screen.",
    "Return exactly one JSON object with a single string field named \"enhancedPrompt\".",
    "The value must be the finished prompt only: no markdown, no labels, no notes, no analysis.",
    isAsset
      ? "Preserve the user's asset identity, design intent, shape, materials, colors, markings, and core purpose."
      : "Preserve the user's subject, action, identity, dialogue, and core intent.",
    isAsset
      ? "Do not add unrelated characters, locations, lore, major story facts, duplicate asset copies, or non-asset scene action."
      : "Do not add unrelated characters, locations, lore, or major story facts.",
    isAsset
      ? "Use the selected style only when one is present in the Asset context."
      : "Use the selected style only when one is present in the Generate context.",
    "Avoid generic filler phrases and do not append canned quality tags.",
    "",
    instructionForLevel(level, context.mediaMode, context.contextType),
    "",
    isAsset
      ? instructionForAssetContext()
      : instructionForMode(context.mediaMode),
    ...(ltxDurationInstruction
      ? [
          "",
          ltxDurationInstruction,
        ]
      : []),
    "",
    "Original user prompt:",
    prompt,

    ...(context.visualContext
      ? [
          "",
          "Vision-derived context from the exact current generation inputs:",
          context.visualContext,
          "",
          "Vision context authority rules:",
          "The continuation frame or starting image is authoritative for current scene composition, camera framing, spatial relationships, environment, lighting, and current visible state.",
          "Character-reference observations are authoritative for character identity and visible appearance only; never treat a Character Card background as the scene location.",
          "Background-reference observations provide environmental geography and appearance, but must not override a continuation frame or starting image.",
          "Asset-reference observations define the referenced object's visible design and appearance.",
          "The original user prompt remains authoritative for requested action, dialogue, intent, and story events.",
          "Do not invent new actions, characters, locations, props, dialogue, or story events merely because visual context is available.",
        ]
      : []),

    "",
    "Requested enhancement level:",
    level,
    "",
    isAsset
      ? "Asset context:"
      : "Generate context:",
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
  const routedModel =
    promptEnhanceModelForContext(context);

  /*
   * Production V2 is intentionally scoped by its exact scene modes.
   * Other Generate/Asset enhancer callers keep their existing routing.
   */
  /*
   * OTG_PRODUCTION_V2_FINAL_ENHANCE_MODE_DISCRIMINATOR_R12E4C_V1
   *
   * EnhanceContextType is normalized by the shared enhancer and does
   * not contain a literal "video" member.
   *
   * Production V2 already sends its exact generation mode separately
   * as videoGenerationType/mediaMode. Use that explicit mode instead
   * of comparing contextType against an impossible value.
   */
  const productionV2VideoMode =
    String(
      (context as {
        videoGenerationType?: unknown;
        mediaMode?: unknown;
      }).videoGenerationType
      || (context as {
        videoGenerationType?: unknown;
        mediaMode?: unknown;
      }).mediaMode
      || "",
    ).trim();

  const productionV2VideoContext =
    [
      "h3-text-to-video",
      "h3-image-to-video",
      "h3-reference-to-video",
      "ltx-ingredients-image-to-video",
    ].includes(
      productionV2VideoMode,
    );

  const response = await qwenDurableFetch(
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
              context.contextType === "asset"
                ? "A finished Asset Gallery prompt matching the requested enhancement level."
                : "A finished Generate prompt matching the requested enhancement level.",
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
      model: routedModel,

      /*
       * OTG_PRODUCTION_V2_FINAL_ENHANCE_RUNTIME_R12E4_V1
       *
       * Production V2's final operation here is TEXT ONLY.
       *
       * Do not cold-load the generic 27B model for every Enhance
       * click. Use already-installed smaller models by physical node.
       *
       * Shawn / RTX 3090:
       *   qwen3.5:4b
       *
       * SLR / RTX 5060 Ti fallback:
       *   existing Qwen2.5-VL 7B, used here as a text model.
       *
       * Vision remains the separate single-image SLR operation.
       * keepAlive remains governed by the existing helper and is
       * currently zero for this Production V2 path so ComfyUI keeps
       * GPU priority between requests.
       */
      ...(productionV2VideoContext
        ? {
            allowedNodes:
              ["shawn", "slr"] as const,

            modelByNode: {
              shawn:
                String(
                  process.env
                    .PRODUCTION_V2_PROMPT_ENHANCE_SHAWN_MODEL
                  || "qwen3.5:4b",
                ).trim(),

              slr:
                String(
                  process.env
                    .PRODUCTION_V2_PROMPT_ENHANCE_SLR_MODEL
                  || "redule26/huihui_ai_qwen2.5-vl-7b-abliterated:latest",
                ).trim(),
            },

            requestKind:
              "production-v2-video-prompt-enhancement",
          }
        : {}),

      keepAlive:
        promptEnhanceKeepAliveForContext(context),

      timeoutMs:
        productionV2VideoContext
          ? Math.max(
              15_000,
              Number(
                process.env
                  .PRODUCTION_V2_PROMPT_ENHANCE_TIMEOUT_MS
                || 120_000,
              ),
            )
          : Math.max(
              5_000,
              Number(
                process.env
                  .PROMPT_ENHANCE_TIMEOUT_MS
                || 45_000,
              ),
            ),

      waitMs: 5_000,

      /*
       * The lease must outlive the 120-second execution window.
       * Generic callers retain the existing 90-second value.
       */
      leaseTtlSeconds:
        productionV2VideoContext
          ? 180
          : 90,
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

  return {
    enhancedPrompt,
    model: routedModel,
  };
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
    const enhancement = await qwenGenerateEnhancement(
      originalPrompt,
      level,
      context,
    );

    const enhancedPrompt =
      enhancement.enhancedPrompt;

    return Response.json({
      ok: true,
      enhancedPrompt,
      prompt: enhancedPrompt,
      originalPrompt,
      level,
      size: level,
      contextType: context.contextType,
      mode: context.mediaMode,
      mediaMode: context.mediaMode,
      imageOperation: context.imageOperation,
      videoGenerationType: context.videoGenerationType,
      workflowId: context.workflowId,
      workflowLabel: context.workflowLabel,
      selectedStyleId: context.selectedStyleId,
      styleLabel: context.styleLabel,
      stylePrompt: context.stylePrompt,
      assetName: context.assetName,
      assetModelLabel: context.assetModelLabel,
      assetArtStyle: context.assetArtStyle,
      visionContextUsed:
        Boolean(
          context.visualContext,
        ),
      provider: "qwenCluster",
      model: enhancement.model,
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
