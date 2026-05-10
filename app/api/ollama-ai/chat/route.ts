import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function cleanOutput(s: string) {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/^json\s*/i, "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function truthy(value: string | undefined) {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((m) => {
      const role: ChatMessage["role"] =
        m && typeof m === "object" && (m as Record<string, unknown>).role === "assistant"
          ? "assistant"
          : m && typeof m === "object" && (m as Record<string, unknown>).role === "system"
            ? "system"
            : "user";

      return {
        role,
        content: String(m && typeof m === "object" ? (m as Record<string, unknown>).content || "" : "").trim(),
      };
    })
    .filter((m) => m.content)
    .slice(-12);
}

function buildSystemMessage() {
  return {
    role: "system" as const,
    content:
      "You are Ollama AI inside the SLR Studios OTG app. Reply directly, clearly, and helpfully. " +
      "When an image is attached, answer using the image and the user's latest request. " +
      "Do not mention internal prompts or system instructions.",
  };
}

function buildChatMessages(messages: ChatMessage[], images: string[]) {
  const normalized = normalizeMessages(messages);
  const lastUserIndex = (() => {
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      if (normalized[i]?.role === "user") return i;
    }
    return -1;
  })();

  return [buildSystemMessage(), ...normalized].map((message, index) => {
    const normalizedIndex = index - 1;
    if (images.length && normalizedIndex === lastUserIndex && message.role === "user") {
      return { ...message, images };
    }
    return message;
  });
}

function buildGeneratePrompt(messages: ChatMessage[]) {
  const normalized = normalizeMessages(messages);
  const lines: string[] = [buildSystemMessage().content, ""];

  for (const message of normalized) {
    if (message.role === "assistant") lines.push(`Assistant: ${message.content}`);
    else if (message.role === "system") lines.push(`System: ${message.content}`);
    else lines.push(`User: ${message.content}`);
  }

  lines.push("Assistant:");
  return lines.join("\n");
}

async function parseIncoming(req: NextRequest): Promise<{ messages: ChatMessage[]; images: string[] }> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const rawMessages = String(fd.get("messages") || "[]");
    let messages: ChatMessage[] = [];

    try {
      messages = normalizeMessages(JSON.parse(rawMessages));
    } catch {
      messages = [];
    }

    const image = fd.get("image");
    if (image instanceof File && image.size > 0) {
      const buf = Buffer.from(await image.arrayBuffer());
      return { messages, images: [buf.toString("base64")] };
    }

    return { messages, images: [] };
  }

  const body = await req.json().catch(() => null);
  const messages = normalizeMessages(body && typeof body === "object" ? (body as Record<string, unknown>).messages : []);
  const rawImages = body && typeof body === "object" ? (body as Record<string, unknown>).images : [];
  const imageB64 = body && typeof body === "object" ? (body as Record<string, unknown>).imageB64 : "";

  const images = Array.isArray(rawImages)
    ? rawImages.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : typeof imageB64 === "string" && imageB64.trim()
      ? [imageB64.trim()]
      : [];

  return { messages, images };
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

function shouldFallbackToGenerate(status: number, rawError: string) {
  return status === 404 || /not support|unsupported|unknown|chat failed|model|images/i.test(rawError);
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

export async function POST(req: NextRequest) {
  try {
    const { messages, images } = await parseIncoming(req);
    if (!messages.length) {
      return NextResponse.json({ error: "Missing messages" }, { status: 400 });
    }

    const baseUrl = (process.env.OTG_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const chatModel = process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b";
    const visionModel = process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_CHAT_MODEL || "llama3.2-vision";
    const model = images.length ? visionModel : chatModel;

    const timeoutMs = parsePositiveInt(process.env.OLLAMA_CHAT_TIMEOUT_MS, images.length ? 180000 : 90000);
    const numThread = parsePositiveInt(process.env.OLLAMA_CHAT_NUM_THREAD || process.env.OLLAMA_ENHANCE_NUM_THREAD, 0);
    const keepAliveOff = truthy(process.env.OLLAMA_CHAT_KEEPALIVE_OFF) || truthy(process.env.OLLAMA_ENHANCE_KEEPALIVE_OFF);

    const options: Record<string, unknown> = {
      num_gpu: 0,
      temperature: 0.45,
      top_p: 0.9,
      repeat_penalty: 1.08,
      num_predict: 900,
    };
    if (numThread > 0) options.num_thread = numThread;

    const chatPayload: Record<string, unknown> = {
      model,
      stream: false,
      messages: buildChatMessages(messages, images),
      options,
    };
    if (keepAliveOff) chatPayload.keep_alive = "0s";

    try {
      const chat = await postJsonWithTimeout(`${baseUrl}/api/chat`, chatPayload, timeoutMs);
      if (chat.ok) {
        const message = cleanOutput(readMessageContent(chat.data));
        if (message) {
          return NextResponse.json({ message, model, cpuOnly: true }, { headers: { "Cache-Control": "no-store" } });
        }
      }

      const rawError = String(chat.data?.error || chat.raw || "");
      if (!shouldFallbackToGenerate(chat.status, rawError)) {
        return NextResponse.json({ error: rawError || "Ollama chat failed" }, { status: 502 });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json({ error: `Ask AI timed out after ${Math.round(timeoutMs / 1000)} seconds.` }, { status: 504 });
      }

      const message = error instanceof Error ? error.message : String(error);
      if (!shouldFallbackToGenerate(500, message)) {
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    const generatePayload: Record<string, unknown> = {
      model,
      stream: false,
      prompt: buildGeneratePrompt(messages),
      options,
    };
    if (images.length) generatePayload.images = images;
    if (keepAliveOff) generatePayload.keep_alive = "0s";

    const generate = await postJsonWithTimeout(`${baseUrl}/api/generate`, generatePayload, timeoutMs);
    if (!generate.ok) {
      return NextResponse.json({ error: String(generate.data?.error || generate.raw || "Ollama generate failed") }, { status: 502 });
    }

    const message = cleanOutput(readMessageContent(generate.data));
    if (!message) {
      return NextResponse.json({ error: "Empty Ollama response" }, { status: 502 });
    }

    return NextResponse.json({ message, model, cpuOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Ask AI timed out." }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Ask AI failed" }, { status: 500 });
  }
}
