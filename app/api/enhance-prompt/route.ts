import { NextRequest } from "next/server";

export const runtime = "nodejs";

type EnhanceLevel = "short" | "medium" | "cinematic";
type EnhanceMode = "image" | "video";

const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLevel(value: unknown): EnhanceLevel {
  const raw = cleanText(value).toLowerCase();
  if (["small", "short", "light", "quick"].includes(raw)) return "short";
  if (["large", "long", "cinematic", "dramatic", "intense"].includes(raw)) return "cinematic";
  return "medium";
}

function normalizeMode(value: unknown, workflowId?: string): EnhanceMode {
  const raw = cleanText(value).toLowerCase();
  if (raw === "video" || raw === "animate") return "video";
  const wf = cleanText(workflowId).toLowerCase();
  if (wf.includes("video") || wf.includes("ltx") || wf.includes("animate")) return "video";
  return "image";
}

function shouldUseOllama() {
  return cleanText(process.env.OLLAMA_PROMPT_ENHANCE_PROVIDER).toLowerCase() === "ollama";
}

function modelForLevel(level: EnhanceLevel) {
  const fastDefault = "qwen2.5:0.5b";
  if (level === "short") {
    return process.env.OLLAMA_PROMPT_ENHANCE_MODEL_SHORT || process.env.OLLAMA_PROMPT_ENHANCE_MODEL || fastDefault;
  }
  if (level === "medium") {
    return process.env.OLLAMA_PROMPT_ENHANCE_MODEL_MEDIUM || process.env.OLLAMA_PROMPT_ENHANCE_MODEL || fastDefault;
  }
  return process.env.OLLAMA_PROMPT_ENHANCE_MODEL_CINEMATIC || process.env.OLLAMA_PROMPT_ENHANCE_MODEL || fastDefault;
}

function numPredictForLevel(level: EnhanceLevel) {
  if (level === "short") return 50;
  if (level === "cinematic") return 120;
  return 85;
}

function stylePhrase(styleLabel: string, stylePrompt: string) {
  const raw = cleanText(styleLabel || stylePrompt);
  if (!raw) return "polished cinematic visual style";
  return raw.toLowerCase().includes("style") ? raw : `${raw} style`;
}

function instructionForLevel(level: EnhanceLevel, mode: EnhanceMode, styleLabel: string, stylePrompt: string) {
  const target = mode === "video" ? "AI video generation" : "AI image generation";
  const styleLine = styleLabel || stylePrompt
    ? `Selected visual style: ${styleLabel || "custom"}. Style details: ${stylePrompt || "match the selected style."}`
    : "No specific style was provided; infer a polished cinematic visual style.";

  const lengthRule =
    level === "short"
      ? "SHORT enhancement: one sentence, 25 to 45 words. Add only essential visual details."
      : level === "medium"
        ? "MEDIUM enhancement: one or two sentences, 55 to 90 words. Add environment, lighting, camera, mood, and style details."
        : "CINEMATIC enhancement: one detailed paragraph, 100 to 150 words. Add dramatic composition, lighting, atmosphere, materials, camera language, emotion, and production-quality detail.";

  return [
    `You are a fast visual prompt enhancer for ${target}.`,
    "Rewrite the user's prompt into one improved generation prompt.",
    "Keep the original subject, action, identity, and intent.",
    "Do not add unrelated characters or story events.",
    "Match the selected style exactly.",
    "Do not explain, do not add bullets, do not quote the prompt, and do not include labels.",
    styleLine,
    lengthRule,
    mode === "video"
      ? "For video, include motion, timing, camera movement, and continuity-friendly visual detail."
      : "For image, include composition, lighting, material, atmosphere, and image-quality detail.",
  ].join("\n");
}

function buildUserPrompt(prompt: string, level: EnhanceLevel, mode: EnhanceMode, styleLabel: string, stylePrompt: string, workflowId: string) {
  return `${instructionForLevel(level, mode, styleLabel, stylePrompt)}

Original prompt:
${prompt}

Workflow/context:
${workflowId || "not specified"}

Enhanced prompt only:`;
}

function heuristicEnhancePrompt(prompt: string, level: EnhanceLevel, mode: EnhanceMode, styleLabel: string, stylePrompt: string) {
  const base = cleanText(prompt).replace(/[. ]+$/, "");
  const style = stylePhrase(styleLabel, stylePrompt);
  const modeDetails = mode === "video"
    ? "smooth motion, coherent character movement, controlled camera movement, temporal consistency"
    : "strong composition, sharp focal clarity, polished render quality";

  if (level === "short") {
    return `${base}, ${style}, clear subject focus, expressive action, refined lighting, vivid atmosphere, ${modeDetails}.`;
  }

  if (level === "medium") {
    return `${base}, reimagined in ${style}, with stronger visual storytelling, expressive character action, clear silhouette, cinematic framing, atmospheric depth, refined lighting, detailed textures, believable environment design, vivid color harmony, and ${modeDetails}.`;
  }

  return `${base}, transformed into a dramatic ${style} scene with a clear focal subject, expressive pose and emotion, rich environmental storytelling, layered atmosphere, cinematic depth, carefully shaped lighting, detailed materials and textures, dynamic composition, premium production design, vivid color harmony, immersive scale, and ${modeDetails}.`;
}

async function ollamaGenerate(payload: Record<string, unknown>, timeoutMs: number) {
  const base = (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || DEFAULT_OLLAMA_BASE).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Ollama returned non-JSON: ${text.slice(0, 180)}`);
    }
    if (!response.ok) {
      throw new Error(json?.error || `Ollama failed with ${response.status}`);
    }
    return cleanText(json?.response || "");
  } finally {
    clearTimeout(timer);
  }
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

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body: any = await parseIncoming(req);
    const prompt = cleanText(body.prompt || body.userPrompt || body.input || body.text);
    if (!prompt) {
      return Response.json({ ok: false, error: "Missing prompt." }, { status: 400 });
    }

    const workflowId = cleanText(body.workflowId || body.preset || body.workflow || "");
    const styleLabel = cleanText(body.styleLabel || body.style || body.presetLabel || body.stylePreset || "");
    const stylePrompt = cleanText(body.stylePrompt || body.styleDescription || body.styleText || "");
    const level = normalizeLevel(body.enhanceLevel || body.level || body.size || body.amount);
    const mode = normalizeMode(body.mode || body.mediaType, workflowId);
    const model = modelForLevel(level);
    const timeoutMs = Math.max(800, Math.min(5000, Number(process.env.OLLAMA_PROMPT_ENHANCE_TIMEOUT_MS || 2500)));
    const numPredict = numPredictForLevel(level);

    const enhancedPromptFromFallback = heuristicEnhancePrompt(prompt, level, mode, styleLabel, stylePrompt);

    let enhancedPrompt = enhancedPromptFromFallback;
    let provider = "heuristic";
    let warning = "";

    if (shouldUseOllama()) {
      try {
        const ollamaPrompt = await ollamaGenerate(
          {
            model,
            prompt: buildUserPrompt(prompt, level, mode, styleLabel, stylePrompt, workflowId),
            stream: false,
            keep_alive: process.env.OLLAMA_PROMPT_ENHANCE_KEEP_ALIVE || "30m",
            options: {
              temperature: level === "cinematic" ? 0.62 : level === "medium" ? 0.5 : 0.35,
              top_p: 0.86,
              repeat_penalty: 1.08,
              num_predict: numPredict,
              num_ctx: 1024,
            },
          },
          timeoutMs
        );

        const cleaned = cleanText(ollamaPrompt).replace(/^["'`]+|["'`]+$/g, "").trim();
        if (cleaned && cleaned.length >= Math.max(16, prompt.length * 0.75) && /^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]+$/.test(cleaned)) {
          enhancedPrompt = cleaned;
          provider = `ollama:${model}`;
        } else {
          provider = `ollama:${model}+fallback`;
          warning = "Ollama returned unusable prompt text; used fast enhancer fallback.";
        }
      } catch (error) {
        warning = error instanceof Error ? error.message : "Ollama enhancement failed.";
        provider = "heuristic";
        enhancedPrompt = enhancedPromptFromFallback;
      }
    }

    return Response.json({
      ok: true,
      enhancedPrompt,
      prompt: enhancedPrompt,
      originalPrompt: prompt,
      level,
      size: level,
      mode,
      styleLabel,
      stylePrompt,
      workflowId,
      provider,
      model: provider.startsWith("ollama:") ? model : null,
      warning,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Prompt enhancement failed.",
      },
      { status: 500 }
    );
  }
}

