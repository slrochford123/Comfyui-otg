import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

function getDataRoot() {
  // Prefer OTG_DATA_DIR, fallback to ./data
  return process.env.OTG_DATA_DIR
    ? path.resolve(process.env.OTG_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

function resolveAudioPath(audioId: string) {
  // Same path used by extract route
  return path.join(getDataRoot(), "voices", "audio", `${audioId}.wav`);
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await ctx.params;

  const audioPath = resolveAudioPath(audioId);
  if (!fs.existsSync(audioPath)) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  const stat = fs.statSync(audioPath);

  const file = fs.readFileSync(audioPath);
  return new NextResponse(file, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
}