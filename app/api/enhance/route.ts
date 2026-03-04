import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enhanceBasic(prompt: string): string {
  const p = (prompt || "").trim();
  if (!p) return "";
  const extras = [
    "high detail",
    "clean composition",
    "sharp focus",
    "natural lighting",
    "cinematic",
    "photorealistic",
  ];
  const base = p.includes(",") ? p : `${p}, ${extras.join(", ")}`;
  return base.replace(/\s+/g, " ").trim();
}

async function enhanceWithOllama(prompt: string, timeoutMs = 7000): Promise<string> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || process.env.OTG_OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim();
  const model = (process.env.OLLAMA_MODEL || process.env.OTG_OLLAMA_MODEL || "llama3.1").trim();

  const system =
    "Rewrite the user's prompt into a stronger, more specific prompt while STRICTLY preserving the same subject, setting, and key details. " +
    "Do NOT add new characters, new objects, or new locations. Do NOT change identity. " +
    "Keep the original meaning and main nouns. You may reorder, clarify, and add camera/lighting descriptors ONLY if they match the existing scene. " +
    "Output ONLY the enhanced prompt text (no quotes, no markdown, no commentary).";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: `${system}\n\nUSER:\n${prompt.trim()}\n\nENHANCED:`,
        stream: false,
        options: { temperature: 0.2, top_p: 0.9 },
      }),
    });

    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(j?.error || `Ollama HTTP ${r.status}`);

    const out = String(j.response || "").trim();
    if (!out) throw new Error("Ollama returned empty response");
    return out;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    const mode = typeof body?.mode === "string" ? body.mode : "replace";

    const ptxt = (prompt || "").trim();
    if (!ptxt) return Response.json({ ok: false, error: "Missing prompt" }, { status: 400 });

    // Deterministic provider selection:
    // - OTG_ENHANCE_PROVIDER=ollama  => REQUIRE Ollama (no silent fallback)
    // - otherwise => try Ollama only if OTG_ENABLE_OLLAMA_ENHANCE=1, else basic
    const providerSetting = String(process.env.OTG_ENHANCE_PROVIDER || "").trim().toLowerCase();
    const tryOllama = providerSetting === "ollama" || String(process.env.OTG_ENABLE_OLLAMA_ENHANCE || "").trim() === "1";

    if (providerSetting === "ollama") {
      // Must use Ollama, error clearly if it fails
      const enhanced = await enhanceWithOllama(ptxt, 7000);
      return Response.json({ ok: true, mode, provider: "ollama", enhanced, result: enhanced });
    }

    // Optional Ollama, safe fallback
    if (tryOllama) {
      try {
        const enhanced = await enhanceWithOllama(ptxt, 5000);
        return Response.json({ ok: true, mode, provider: "ollama", enhanced, result: enhanced });
      } catch (e: any) {
        const enhanced = enhanceBasic(ptxt);
        return Response.json({
          ok: true,
          mode,
          provider: "basic",
          enhanced,
          result: enhanced,
          note: "Ollama unavailable; fell back to basic",
          ollama_error: String(e?.message || e),
        });
      }
    }

    const enhanced = enhanceBasic(ptxt);
    return Response.json({ ok: true, mode, provider: "basic", enhanced, result: enhanced });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Enhance failed" }, { status: 500 });
  }
}
