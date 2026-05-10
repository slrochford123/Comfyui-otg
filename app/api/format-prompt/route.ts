import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type FormatMode = "video_t2v" | "video_i2v";

type PromptFormatResponse = {
  compiled_prompt?: string;
  shot?: string;
  scene?: string;
  action_sequence?: string;
  character_details?: string;
  camera_movement?: string;
  audio?: string;
  dialogue?: string;
  visible_identity_anchors?: string;
  wardrobe_props?: string;
  framing_composition?: string;
  lighting_environment?: string;
  motion_plan?: string;
  camera_plan?: string;
  continuity_locks?: string;
};

const T2V_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shot: { type: "string" },
    scene: { type: "string" },
    action_sequence: { type: "string" },
    character_details: { type: "string" },
    camera_movement: { type: "string" },
    audio: { type: "string" },
    dialogue: { type: "string" },
    compiled_prompt: { type: "string" },
  },
  required: ["compiled_prompt"],
};

const I2V_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    visible_identity_anchors: { type: "string" },
    wardrobe_props: { type: "string" },
    framing_composition: { type: "string" },
    lighting_environment: { type: "string" },
    motion_plan: { type: "string" },
    camera_plan: { type: "string" },
    continuity_locks: { type: "string" },
    audio: { type: "string" },
    dialogue: { type: "string" },
    compiled_prompt: { type: "string" },
  },
  required: ["compiled_prompt"],
};

function pickTextModel() {
  return (
    process.env.OLLAMA_FORMAT_MODEL ||
    process.env.OLLAMA_ENHANCE_MODEL ||
    process.env.OLLAMA_TEXT_MODEL ||
    process.env.OLLAMA_MODEL ||
    "closex/neuraldaredevil-8b-abliterated:Q6_K"
  );
}

function pickVisionModel() {
  return (
    process.env.OLLAMA_FORMAT_VISION_MODEL ||
    process.env.OLLAMA_VISION_MODEL ||
    process.env.OLLAMA_CHAT_MODEL ||
    "huihui_ai/qwen3-vl-abliterated:30b-a3b-instruct"
  );
}

function parseIntEnv(name: string): number | null {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function truthyEnv(name: string) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function cleanOutput(s: string) {
  return String(s || "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .replace(/\r/g, "")
    .trim();
}

function normalizeMode(value: unknown, hasImage: boolean, workflowId?: string): FormatMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "video_t2v" || raw === "video_i2v") return raw;
  const combined = `${workflowId || ""}`.toLowerCase();
  if (
    hasImage ||
    combined.includes("from image") ||
    combined.includes("from images") ||
    combined.includes("from picture") ||
    combined.includes("from pictures") ||
    combined.includes("starter image") ||
    combined.includes("image to video") ||
    combined.includes("i2v")
  ) {
    return "video_i2v";
  }
  return "video_t2v";
}

function normalizeSentence(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s+\?/g, "?")
    .replace(/\s+\!/g, "!")
    .trim();
}

function normalizeDialoguePunctuation(text: string) {
  return normalizeSentence(String(text || ""))
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bive\b/gi, "I've")
    .replace(/\bid\b/gi, "I'd")
    .replace(/\bi\b(?=\?)/gi, "I")
    .replace(/\bwhere am\?/gi, "Where am I?")
    .replace(/\bwhere am i\?/gi, "Where am I?")
    .replace(/\bhello\?/gi, "Hello?")
    .replace(/\s*'\s*/g, '"')
    .replace(/\s*"\s*/g, '"')
    .replace(/"{2,}/g, '"')
    .replace(/"([^"]+?)"(?![.,!?])/g, '"$1"')
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

function joinParts(parts: Array<string | null | undefined>, delimiter = " ") {
  return parts
    .map((part) => normalizeSentence(String(part || "")))
    .filter(Boolean)
    .join(delimiter)
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFormattedPrompt(mode: FormatMode, text: string) {
  let cleaned = normalizeDialoguePunctuation(text);

  const internalPatterns = [
    /use the uploaded image as visual grounding[^.]*\.?/gi,
    /use the image as (?:the )?starting visual state[^.]*\.?/gi,
    /use the image as (?:the )?starting point[^.]*\.?/gi,
    /the starter image remains the visual first frame[^.]*\.?/gi,
    /preserve the visible identity, wardrobe, lighting, and portrait framing while[^.]*\.?/gi,
    /preserve the visible identity, wardrobe, lighting, and scene layout[^.]*\.?/gi,
    /preserve the same subject identity, wardrobe, and environment[^.]*\.?/gi,
    /do not mention starter image[^.]*\.?/gi,
    /do not append generic continuity boilerplate[^.]*\.?/gi,
    /return json only[^.]*\.?/gi,
    /schema:[\s\S]*$/i,
    /compiled_prompt[^.]*\.?/gi,
  ];

  for (const pattern of internalPatterns) {
    cleaned = cleaned.replace(pattern, " ");
  }

  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/\.\s+\./g, ". ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();

  if (mode === "video_i2v") {
    cleaned = cleaned
      .replace(/\bsource image\b/gi, "scene")
      .replace(/\bstarter image\b/gi, "scene")
      .replace(/\buploaded image\b/gi, "scene");
  }

  return cleaned;
}

async function parseIncoming(req: NextRequest): Promise<{
  prompt: string;
  workflowId: string;
  styleLabel: string;
  stylePrompt: string;
  mode: FormatMode;
  imageBase64: string | null;
}> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const prompt = String(fd.get("prompt") || "").trim();
    const workflowId = String(fd.get("workflowId") || "").trim();
    const styleLabel = String(fd.get("styleLabel") || "").trim();
    const stylePrompt = String(fd.get("stylePrompt") || "").trim();
    const image = fd.get("image");
    let imageBase64: string | null = null;
    if (image instanceof File && image.size > 0) {
      imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    }
    return {
      prompt,
      workflowId,
      styleLabel,
      stylePrompt,
      mode: normalizeMode(fd.get("mode"), Boolean(imageBase64), workflowId),
      imageBase64,
    };
  }

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const workflowId = typeof body?.workflowId === "string" ? body.workflowId.trim() : "";
  const styleLabel = typeof body?.styleLabel === "string" ? body.styleLabel.trim() : "";
  const stylePrompt = typeof body?.stylePrompt === "string" ? body.stylePrompt.trim() : "";
  const imageBase64 =
    typeof body?.imageBase64 === "string" && body.imageBase64.trim() ? body.imageBase64.trim() : null;

  return {
    prompt,
    workflowId,
    styleLabel,
    stylePrompt,
    mode: normalizeMode(body?.mode, Boolean(imageBase64), workflowId),
    imageBase64,
  };
}

function buildSchemaPrompt(schema: Record<string, unknown>) {
  return JSON.stringify(schema, null, 2);
}

function buildSystemInstruction(mode: FormatMode, styleLabel: string, stylePrompt: string) {
  const styleLines = [
    styleLabel ? `Selected style preset: ${styleLabel}.` : "",
    stylePrompt ? `Use this as style guidance only: ${stylePrompt}` : "",
    "Preserve the selected style but do not repeat the style wrapper verbatim in every sentence.",
    "Do not mix conflicting styles.",
  ]
    .filter(Boolean)
    .join("\n");

  if (mode === "video_i2v") {
    return [
      "You are formatting prompts for LTX 2.3 image-to-video.",
      "Inspect the input image and the user's text prompt.",
      "Extract only visible continuity anchors from the image: identity, clothing, props, framing, lighting, environment, and scene direction.",
      "Use the uploaded image as visual grounding internally only. Do not mention uploaded image, starter image, source image, first frame, or continuity lock language in the final prompt.",
      "Convert visible anchors into natural scene language inside the final prompt.",
      "Do not waste tokens re-describing static visual details that are already obvious unless they are needed for continuity.",
      "Focus the compiled prompt on what happens next: motion, action progression, camera behavior, ambient sound, and continuity.",
      "Write the compiled prompt as one flowing paragraph in present tense.",
      "Aim for roughly 4 to 8 descriptive sentences in the compiled prompt.",
      "Keep the user's intent and requested action central.",
      styleLines,
      "Return JSON matching the requested schema exactly.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "You are formatting prompts for LTX 2.3 text-to-video.",
    "Convert the user's idea into an LTX-ready cinematic prompt.",
    "Build a coherent full scene using subject, environment, lighting, action sequence, character cues, camera movement, and audio when relevant.",
    "Write the compiled prompt as one flowing paragraph in present tense.",
    "Aim for roughly 4 to 8 descriptive sentences in the compiled prompt.",
    "Use camera language naturally and clearly.",
    "Keep the user's core subject, action, and intent.",
    "Do not mention starter image, first frame, source image, continuity lock, uploaded image, or any internal builder instructions.",
    "Do not output meta-explanations or implementation notes. Output only the final usable prompt inside the JSON schema.",
    styleLines,
    "Return JSON matching the requested schema exactly.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserInstruction(prompt: string, mode: FormatMode, schema: Record<string, unknown>) {
  if (mode === "video_i2v") {
    return [
      "The user wants an image-to-video prompt for LTX 2.3.",
      "Use the image as the starting visual state and the user's prompt as the intended motion and action goal.",
      "Describe what changes over time and how the camera behaves.",
      "Do not mention uploaded image, source image, starter image, or first frame in the final compiled prompt.",
      "Return JSON only.",
      "Schema:",
      buildSchemaPrompt(schema),
      "User prompt:",
      prompt,
    ].join("\n\n");
  }

  return [
    "The user wants a text-to-video prompt for LTX 2.3.",
    "Convert the request into a well-structured cinematic prompt body.",
    "Do not mention uploaded image, source image, starter image, or first frame in the final compiled prompt.",
    "Return JSON only.",
    "Schema:",
    buildSchemaPrompt(schema),
    "User prompt:",
    prompt,
  ].join("\n\n");
}

function extractJsonObject(raw: string) {
  const cleaned = cleanOutput(raw);
  if (!cleaned) return "";

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function parseStructuredOutput(raw: string): PromptFormatResponse | null {
  const candidate = extractJsonObject(raw);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? (parsed as PromptFormatResponse) : null;
  } catch {
    return null;
  }
}

function compileFormattedPrompt(mode: FormatMode, structured: PromptFormatResponse | null) {
  const compiled = sanitizeFormattedPrompt(mode, String(structured?.compiled_prompt || ""));
  if (compiled) return compiled;

  if (mode === "video_i2v") {
    return sanitizeFormattedPrompt(
      mode,
      joinParts([
        structured?.visible_identity_anchors,
        structured?.wardrobe_props,
        structured?.framing_composition,
        structured?.lighting_environment,
        structured?.motion_plan,
        structured?.camera_plan,
        structured?.continuity_locks,
        structured?.audio,
        structured?.dialogue,
      ])
    );
  }

  return sanitizeFormattedPrompt(
    mode,
    joinParts([
      structured?.shot,
      structured?.scene,
      structured?.action_sequence,
      structured?.character_details,
      structured?.camera_movement,
      structured?.audio,
      structured?.dialogue,
    ])
  );
}

function heuristicFormatPrompt(prompt: string, mode: FormatMode) {
  const original = normalizeDialoguePunctuation(prompt);
  if (!original) return "";

  if (mode === "video_i2v") {
    return normalizeSentence(
      `${original} Motion develops through clear facial acting, eye movement, breathing, body language, and natural secondary motion. The camera follows with smooth cinematic movement while the scene stays visually consistent and the sound design supports the tension.`
    );
  }

  return normalizeSentence(
    `${original} The scene unfolds in a clear environment with readable lighting, stronger visual staging, and smooth cinematic camera movement. Ambient sound, room tone, and any short spoken dialogue reinforce the action and mood from beginning to end.`
  );
}

function isWeakFormattedPrompt(original: string, formatted: string) {
  const a = normalizeSentence(original).toLowerCase();
  const b = sanitizeFormattedPrompt("video_t2v", formatted).toLowerCase();

  if (!b) return true;
  if (b === a) return true;
  if (b.length < Math.max(80, Math.floor(a.length * 1.08))) return true;
  if (
    /schema|return json|compiled_prompt|uploaded image|source image|starter image|first frame|continuity lock|visual grounding/i.test(
      b
    )
  ) {
    return true;
  }
  return false;
}

function readMessageContent(data: Record<string, unknown> | null) {
  if (!data) return "";

  if (typeof data.response === "string") return data.response;

  const message = data.message;
  if (message && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") return content;
  }

  return "";
}

async function postJsonWithTimeout(url: string, payload: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    return { ok: res.ok, status: res.status, raw, data };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, workflowId, styleLabel, stylePrompt, mode, imageBase64 } = await parseIncoming(req);
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (mode === "video_i2v" && !imageBase64) {
      return NextResponse.json({ error: "Starter image is required for image-to-video formatting." }, { status: 400 });
    }

    const baseUrl = (process.env.OLLAMA_BASE_URL || process.env.OTG_OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const model = mode === "video_i2v" ? pickVisionModel() : pickTextModel();
    const timeoutMs = parseIntEnv("OLLAMA_FORMAT_TIMEOUT_MS") || (mode === "video_i2v" ? 180000 : 120000);
    const numThread = parseIntEnv("OLLAMA_FORMAT_NUM_THREAD") || parseIntEnv("OLLAMA_ENHANCE_NUM_THREAD");
    const keepAliveOff = truthyEnv("OLLAMA_FORMAT_KEEPALIVE_OFF") || truthyEnv("OLLAMA_ENHANCE_KEEPALIVE_OFF");
    const forceCpu = truthyEnv("OLLAMA_FORMAT_FORCE_CPU") || truthyEnv("OLLAMA_ENHANCE_FORCE_CPU");

    const schema = mode === "video_i2v" ? I2V_SCHEMA : T2V_SCHEMA;
    const options: Record<string, unknown> = {
      temperature: 0.15,
      top_p: 0.9,
      repeat_penalty: 1.05,
      num_predict: mode === "video_i2v" ? 700 : 600,
    };
    if (forceCpu) options.num_gpu = 0;
    if (numThread) options.num_thread = numThread;

    const userMessage: Record<string, unknown> = {
      role: "user",
      content: buildUserInstruction(prompt, mode, schema),
    };
    if (imageBase64) {
      userMessage.images = [imageBase64];
    }

    const payload: Record<string, unknown> = {
      model,
      stream: false,
      format: schema,
      messages: [
        { role: "system", content: buildSystemInstruction(mode, styleLabel, stylePrompt) },
        userMessage,
      ],
      options,
    };
    if (keepAliveOff) payload.keep_alive = "0s";

    let rawText = "";
    let structured: PromptFormatResponse | null = null;
    let formattedPrompt = "";

    try {
      const response = await postJsonWithTimeout(`${baseUrl}/api/chat`, payload, timeoutMs);
      if (!response.ok) {
        const message = String(response.data?.error || response.raw || "Create Prompt Format failed");
        throw new Error(message);
      }

      rawText = readMessageContent(response.data);
      structured = parseStructuredOutput(rawText);
      formattedPrompt = compileFormattedPrompt(mode, structured);
    } catch {
      structured = null;
      rawText = "";
      formattedPrompt = "";
    }

    if (isWeakFormattedPrompt(prompt, formattedPrompt)) {
      formattedPrompt = sanitizeFormattedPrompt(mode, heuristicFormatPrompt(prompt, mode));
    }

    if (isWeakFormattedPrompt(prompt, formattedPrompt)) {
      formattedPrompt = sanitizeFormattedPrompt(mode, normalizeDialoguePunctuation(normalizeSentence(prompt)));
    }

    return NextResponse.json(
      {
        ok: true,
        formattedPrompt,
        mode,
        model,
        cpuOnly: forceCpu,
        fallbackUsed: !structured || normalizeSentence(formattedPrompt).toLowerCase() !== normalizeSentence(compileFormattedPrompt(mode, structured)).toLowerCase(),
        structured,
        rawText,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Create Prompt Format timed out." }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Create Prompt Format failed" }, { status: 500 });
  }
}
