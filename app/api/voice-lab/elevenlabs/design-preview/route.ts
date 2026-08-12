/* OTG_ELEVENLABS_PREVIEW_BACKEND_P1 */
import { NextRequest, NextResponse } from "next/server";
import { createElevenLabsDesignPreview } from "@/lib/elevenlabsVoiceDesign";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Missing JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "JSON body must be an object." }, { status: 400 });
    }

    const input = body as {
      voiceDescription?: unknown;
      sampleText?: unknown;
      seed?: unknown;
      loudness?: unknown;
      guidanceScale?: unknown;
      quality?: unknown;
      shouldEnhance?: unknown;
    };

    const voiceDescription = typeof input.voiceDescription === "string" ? input.voiceDescription : "";
    const sampleText = typeof input.sampleText === "string" ? input.sampleText : "";

    if (!voiceDescription.trim()) {
      return NextResponse.json({ ok: false, error: "Missing required field: voiceDescription" }, { status: 400 });
    }

    if (!sampleText.trim()) {
      return NextResponse.json({ ok: false, error: "Missing required field: sampleText" }, { status: 400 });
    }

    const result = await createElevenLabsDesignPreview({
      voiceDescription,
      sampleText,
      seed: typeof input.seed === "number" || typeof input.seed === "string" ? Number(input.seed) : null,
      loudness: typeof input.loudness === "number" || typeof input.loudness === "string" ? Number(input.loudness) : null,
      guidanceScale: typeof input.guidanceScale === "number" || typeof input.guidanceScale === "string" ? Number(input.guidanceScale) : null,
      quality: typeof input.quality === "number" || typeof input.quality === "string" ? Number(input.quality) : null,
      shouldEnhance: Boolean(input.shouldEnhance),
    });

    return NextResponse.json({
      ok: true,
      provider: "elevenlabs_experimental",
      savedToElevenLabs: false,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ElevenLabs design-preview error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}