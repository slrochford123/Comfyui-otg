/* OTG_ELEVENLABS_PREVIEW_BACKEND_P1 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertInsideElevenLabsPreviewRoot } from "@/lib/elevenlabsVoiceDesign";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const rawPath = req.nextUrl.searchParams.get("path");
    if (!rawPath) {
      return NextResponse.json({ ok: false, error: "Missing required query parameter: path" }, { status: 400 });
    }

    const resolved = assertInsideElevenLabsPreviewRoot(rawPath);
    if (path.extname(resolved).toLowerCase() !== ".mp3") {
      return NextResponse.json({ ok: false, error: "Only ElevenLabs preview MP3 files are allowed." }, { status: 400 });
    }

    const data = await fs.readFile(resolved);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read ElevenLabs preview file.";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}