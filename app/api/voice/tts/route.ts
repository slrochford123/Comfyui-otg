import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      text,
      emotion,
      voice,
      speed = 1,
      emotion_strength = 0.8,
      style_strength = 0.8,
      language = "en",
      seed = "random",
      output_name = "character_tts"
    } = body;

    if (!text || !voice) {
      return NextResponse.json(
        { ok: false, error: "Missing text or voice" },
        { status: 400 }
      );
    }

    const outDir = path.join(process.cwd(), "public", "tts");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const filename = `${output_name}_${Date.now()}.wav`;
    const outputPath = path.join(outDir, filename);

    const ttsUrl = process.env.INDEXTTS2_TTS_URL;

    if (!ttsUrl) {
      return NextResponse.json(
        { ok: false, error: "INDEXTTS2_TTS_URL not set" },
        { status: 500 }
      );
    }

    const res = await fetch(ttsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        emotion,
        voice,
        speed,
        emotion_strength,
        style_strength,
        language,
        seed,
        output_path: outputPath
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { ok: false, error: "IndexTTS2 failed", detail: err },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      file: `/tts/${filename}`
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "TTS route failed" },
      { status: 500 }
    );
  }
}
