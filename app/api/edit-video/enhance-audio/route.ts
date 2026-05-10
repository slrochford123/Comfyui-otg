import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnhanceAudioRequest = {
  videoPath?: string;
};

function assertVideoPath(videoPath: unknown): string {
  if (typeof videoPath !== "string" || !videoPath.trim()) {
    throw new Error("videoPath is required.");
  }
  return videoPath;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const result = await runCmd(resolveFfmpegPath(), args, { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "ffmpeg failed.");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { videoPath } = (await req.json()) as EnhanceAudioRequest;
    const input = assertVideoPath(videoPath);
    const output = input.replace(/\.mp4$/i, "_enhanced.mp4");
    const tempPrefix = path.join(os.tmpdir(), `otg-enhance-${randomUUID()}`);
    const audio = `${tempPrefix}.wav`;
    const enhanced = `${tempPrefix}-enhanced.wav`;

    await runFfmpeg(["-y", "-i", input, "-q:a", "0", "-map", "a", audio]);
    await runFfmpeg([
      "-y",
      "-i",
      audio,
      "-af",
      "loudnorm,aresample=48000,highpass=f=80,lowpass=f=12000",
      enhanced,
    ]);
    await runFfmpeg(["-y", "-i", input, "-i", enhanced, "-c:v", "copy", "-map", "0:v:0", "-map", "1:a:0", output]);

    return NextResponse.json({ ok: true, output });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to enhance audio." },
      { status: 500 },
    );
  }
}
