import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type EnhanceMode = "background" | "scene" | "descriptor";
type EnhanceSize = "small" | "medium" | "large";

function cleanOutput(s: string) {
  return (s || "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

async function detectTextModel(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { cache: "no-store" as any });
    if (!res.ok) return null;
    const data = await res.json();
    const models: string[] = data?.models?.map((m: any) => m?.name).filter(Boolean) ?? [];
    if (!models.length) return null;

    // Prefer non-vision models for text enhancement.
    const preferred = models.find((m) => !/vision|vl|llava/i.test(m) && /qwen|llama|mistral|phi|gemma/i.test(m));
    return preferred ?? models.find((m) => !/vision|vl|llava/i.test(m)) ?? models[0];
  } catch {
    return null;
  }
}

function buildPrompt(mode: EnhanceMode, text: string, size: EnhanceSize, context?: string) {
  const ctx = (context || "").trim();
  const ctxBlock = ctx ? `\nContext: ${ctx}\n` : "\n";

  const sizeInstr =
    size === "small"
      ? "Make it compact. Keep it under ~220 characters when possible. "
      : size === "large"
        ? "Make it richly detailed but still usable as a single prompt. "
        : "";

  if (mode === "background") {
    return (
      "Rewrite the following background/location prompt for cinematic AI generation. " +
      "Keep the same setting and intent. Make it vivid but compact. " +
      sizeInstr +
      "Return ONLY the improved prompt text (no markdown, no quotes, no commentary)." +
      ctxBlock +
      `Prompt: ${text}`
    );
  }

  if (mode === "descriptor") {
    return (
      "Rewrite the following character descriptor for identity/face-lock prompting. " +
      "Keep all true attributes. Remove duplicates. Use comma-separated traits. " +
      sizeInstr +
      "Return ONLY the improved descriptor (no markdown, no quotes, no commentary)." +
      ctxBlock +
      `Descriptor: ${text}`
    );
  }

  // scene
  return (
    "Rewrite the following scene-action prompt for cinematic AI generation. " +
    "Preserve meaning and continuity. Make it specific (actions, emotion, camera-friendly). " +
    sizeInstr +
    "Do NOT add new characters or change identity. " +
    "Return ONLY the improved prompt text (no markdown, no quotes, no commentary)." +
    ctxBlock +
    `Scene: ${text}`
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request must be JSON" }, { status: 415 });
    }

    const text = (body as any).text;
    const mode = ((body as any).mode || "scene") as EnhanceMode;
    const context = (body as any).context as string | undefined;
    const size = (((body as any).size || "medium") as EnhanceSize) || "medium";

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    if (!(["background", "scene", "descriptor"] as const).includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    if (!(["small", "medium", "large"] as const).includes(size)) {
      return NextResponse.json({ error: "Invalid size" }, { status: 400 });
    }

    const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model =
      process.env.OLLAMA_TEXT_MODEL ||
      process.env.OLLAMA_MODEL ||
      (await detectTextModel(baseUrl)) ||
      "llama3.2";

    const prompt = buildPrompt(mode, text.trim(), size, context);

    const payload = {
      model,
      stream: false,
      prompt,
      options: {
        temperature: 0.3,
        top_p: 0.9,
        repeat_penalty: 1.15,
        num_predict: size === "small" ? 140 : size === "large" ? 420 : 240,
      },
    };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await r.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: `Ollama returned non-JSON: ${raw.slice(0, 200)}` }, { status: 502 });
    }

    if (!r.ok) {
      return NextResponse.json({ error: data?.error || raw }, { status: 502 });
    }

    const enhanced = cleanOutput((data?.response ?? "").toString());
    if (!enhanced) {
      return NextResponse.json({ error: "Empty enhancement response" }, { status: 500 });
    }

    return NextResponse.json({ enhanced });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
