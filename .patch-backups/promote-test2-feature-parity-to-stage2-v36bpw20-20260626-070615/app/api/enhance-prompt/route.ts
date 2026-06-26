import { NextRequest, NextResponse } from "next/server";
import { assertAllowedWorkerTargetUrl } from "@/lib/runtime/workerTargetPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type EnhanceSize = "small" | "medium" | "large";
type EnhanceMode = "image" | "video";

function normalizeSize(value: unknown): EnhanceSize {
  const raw = String(value || "medium").trim().toLowerCase();
  if (raw === "small" || raw === "medium" || raw === "large") return raw;
  return "medium";
}

function pickModel() {
  return (
    process.env.OLLAMA_ENHANCE_MODEL ||
    process.env.OLLAMA_TEXT_MODEL ||
    process.env.OLLAMA_MODEL ||
    "closex/neuraldaredevil-8b-abliterated:Q6_K"
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

function looksLikeVideoWorkflow(workflowId?: string) {
  const v = String(workflowId || "").toLowerCase();
  return v.includes("video") || v.includes("ltx") || v.includes("animate") || v.includes("skyreels") || v.includes("wan");
}

function normalizeMode(value: unknown, workflowId?: string): EnhanceMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "image" || raw === "video") return raw;
  return looksLikeVideoWorkflow(workflowId) ? "video" : "image";
}

function buildInstruction(size: EnhanceSize, workflowId?: string, mode: EnhanceMode = "image", styleLabel?: string, stylePrompt?: string) {
  const sizeLine =
    size === "small"
      ? "Make a light improvement only."
      : size === "large"
        ? "Make a strong improvement with richer visual detail and stronger adjectives."
        : "Make a medium improvement with clearer, richer visual detail.";

  const workflowLine = workflowId ? `Target workflow: ${workflowId}.` : "";
  const styleLine = styleLabel
    ? `Selected style preset: ${styleLabel}. This is a hard visual target. The rewritten body must clearly reinforce that style and must not mix in conflicting styles.`
    : "";
  const styleDirectiveLine = stylePrompt ? `Hard style guidance to weave into the body prompt: ${stylePrompt}` : "";
  const modeLine =
    mode === "video"
      ? "Optimize the rewritten body prompt for LTX 2.3 video generation with clearer subject action, environment continuity, lighting, camera behavior, and short natural audio or dialogue cues when relevant. Keep it readable as one flowing present-tense paragraph."
      : "Optimize the rewritten body prompt for ERNIE-Image-Turbo image generation with clearer subject detail, layout intent, composition, lighting, material description, and stronger instruction-following specificity.";

  return [
    "Rewrite only the user's body prompt so it stays true to the original meaning but becomes more vivid, specific, and useful for AI generation.",
    sizeLine,
    workflowLine,
    modeLine,
    styleLine,
    styleDirectiveLine,
    "Keep the same subject, same core action, and same intent.",
    "Do not invent new story beats, characters, locations, or camera moves unless the original text already implies them.",
    "When a style preset is selected, make the result obviously read as that style through stronger composition, lighting, depth, texture, atmosphere, and finish cues.",
    "Do not prepend or repeat the style wrapper verbatim. Strengthen the body prompt so it fits the chosen style.",
    "Expand concise prompts into one stronger natural-language prompt body.",
    "Return only the rewritten prompt body text.",
    "Do not return analysis, bullet points, labels, markdown, or quotation marks.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPromptPayload(userPrompt: string, size: EnhanceSize, workflowId?: string, mode: EnhanceMode = "image", styleLabel?: string, stylePrompt?: string) {
  return `${buildInstruction(size, workflowId, mode, styleLabel, stylePrompt)}

Original prompt body:
${userPrompt}

Improved prompt body:`;
}

function stripLabels(text: string) {
  return text
    .replace(/^\s*Improved prompt\s*:\s*/i, "")
    .replace(/^\s*Enhanced prompt\s*:\s*/i, "")
    .replace(/^\s*Final prompt\s*:\s*/i, "")
    .trim();
}

function cleanOutput(raw: string) {
  let value = String(raw || "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/\r/g, "")
    .trim();

  const cutMarkers = [
    /^Rewrite the user's AI generation prompt/i,
    /^Keep the same subject/i,
    /^Do not invent new story beats/i,
    /^Return only the rewritten prompt text/i,
    /^Do not return analysis/i,
    /^Original prompt\s*:/i,
  ];

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !cutMarkers.some((re) => re.test(line)));

  value = lines.join(" ").replace(/\s{2,}/g, " ").trim();
  value = stripLabels(value).replace(/^\s*["'`]+|["'`]+\s*$/g, "").trim();
  return value;
}

function normalizeSentence(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function extractStyleBits(stylePrompt?: string) {
  return String(stylePrompt || "")
    .split(",")
    .map((part) => normalizeSentence(part))
    .filter((part) => part.length >= 6)
    .slice(0, 8);
}

function heuristicEnhancePrompt(
  prompt: string,
  workflowId?: string,
  size: EnhanceSize = "medium",
  mode?: EnhanceMode,
  stylePrompt?: string
) {
  const original = normalizeSentence(prompt);
  const isVideo = (mode || normalizeMode(undefined, workflowId)) === "video";
  const styleBits = extractStyleBits(stylePrompt);
  const baseVisualBits = isVideo
    ? ["cinematic motion", "natural movement", "detailed subject", "clear scene composition"]
    : ["high detail", "clear subject", "clean composition", "clear layout intent", "sharp visual focus"];

  const sizeBits =
    size === "small"
      ? [...styleBits.slice(0, 2), baseVisualBits[0], baseVisualBits[2]]
      : size === "large"
        ? [
            ...styleBits.slice(0, 5),
            ...baseVisualBits,
            ...(isVideo
              ? ["dynamic lighting", "immersive atmosphere"]
              : ["rich lighting", "vivid texture"]),
          ]
        : [...styleBits.slice(0, 3), ...baseVisualBits, isVideo ? "atmospheric lighting" : "natural lighting"];

  const desiredBits = Array.from(
    new Set(
      sizeBits
        .map((bit) => normalizeSentence(bit))
        .filter(Boolean)
    )
  );

  const existingLower = original.toLowerCase();
  const missing = desiredBits.filter((bit) => !existingLower.includes(bit.toLowerCase()));
  const suffix = missing.length ? `, ${missing.join(", ")}` : "";

  return `${original}${suffix}`.replace(/\s+,/g, ",").trim();
}

function isWeakEnhancement(original: string, enhanced: string) {
  const a = normalizeSentence(original).toLowerCase();
  const b = normalizeSentence(enhanced).toLowerCase();
  if (!b) return true;
  if (b === a) return true;
  if (b.length < Math.max(12, Math.floor(a.length * 0.8))) return true;
  if (b.includes("original prompt") || b.includes("improved prompt") || b.includes("return only")) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : typeof body?.text === "string" ? body.text.trim() : "";
    const workflowId = typeof body?.workflowId === "string" ? body.workflowId.trim() : "";
    const size = normalizeSize(body?.strength ?? body?.size);
    const mode = normalizeMode(body?.mode, workflowId);
    const styleLabel = typeof body?.styleLabel === "string" ? body.styleLabel.trim() : "";
    const stylePrompt = typeof body?.stylePrompt === "string" ? body.stylePrompt.trim() : "";

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const ollamaBase = assertAllowedWorkerTargetUrl(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || "http://127.0.0.1:11434", "enhance-prompt Ollama worker target");
    const model = pickModel();
    const forceCpu = truthyEnv("OLLAMA_ENHANCE_FORCE_CPU");
    const numThread = parseIntEnv("OLLAMA_ENHANCE_NUM_THREAD");
    const keepAliveOff = truthyEnv("OLLAMA_ENHANCE_KEEPALIVE_OFF");

    const options: Record<string, unknown> = {
      temperature: 0.35,
      top_p: 0.92,
      repeat_penalty: 1.08,
      num_predict: size === "small" ? 96 : size === "large" ? 220 : 160,
    };

    if (forceCpu) options.num_gpu = 0;
    if (numThread) options.num_thread = numThread;

    const payload: Record<string, unknown> = {
      model,
      prompt: buildPromptPayload(prompt, size, workflowId, mode, styleLabel, stylePrompt),
      stream: false,
      options,
    };

    if (keepAliveOff) payload.keep_alive = "0s";

    let enhancedPrompt = "";

    try {
      const response = await fetch(`${ollamaBase.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const data = await response.json().catch(() => ({} as Record<string, unknown>));

      if (!response.ok) {
        const message = typeof data?.error === "string" ? data.error : "Enhance Prompt request failed";
        throw new Error(message);
      }

      const rawText = typeof data?.response === "string" ? data.response : typeof data?.output === "string" ? data.output : "";
      enhancedPrompt = cleanOutput(rawText);
    } catch {
      enhancedPrompt = "";
    }

    if (isWeakEnhancement(prompt, enhancedPrompt)) {
      enhancedPrompt = heuristicEnhancePrompt(prompt, workflowId, size, mode, stylePrompt);
    }

    if (isWeakEnhancement(prompt, enhancedPrompt)) {
      return NextResponse.json({ error: "Enhancer returned invalid text" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      enhancedPrompt,
      model,
      cpuOnly: forceCpu,
      size,
      fallbackUsed:
        normalizeSentence(enhancedPrompt).toLowerCase() ===
        normalizeSentence(heuristicEnhancePrompt(prompt, workflowId, size, mode, stylePrompt)).toLowerCase(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enhance Prompt failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
