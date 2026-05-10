import { NextResponse } from "next/server";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AudioMixRequest = {
  video?: string;
  music?: string;
};

function requiredPath(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { video, music } = (await req.json()) as AudioMixRequest;
    const videoPath = requiredPath(video, "video");
    const musicPath = requiredPath(music, "music");
    const output = videoPath.replace(/\.mp4$/i, "_mixed.mp4");

    const result = await runCmd(
      resolveFfmpegPath(),
      [
        "-y",
        "-i",
        videoPath,
        "-i",
        musicPath,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2",
        "-c:v",
        "copy",
        output,
      ],
      { timeoutMs: 10 * 60 * 1000 },
    );

    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "ffmpeg failed.");
    }

    return NextResponse.json({ ok: true, output });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mix audio." },
      { status: 500 },
    );
  }
}
