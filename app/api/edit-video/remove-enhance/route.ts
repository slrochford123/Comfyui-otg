import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RemoveEnhanceRequest = {
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

async function runDemucs(args: string[], cwd: string): Promise<void> {
  const result = await runCmd("demucs", args, { cwd, timeoutMs: 20 * 60 * 1000 });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "demucs failed.");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const tempDir = path.join(os.tmpdir(), `otg-remove-enhance-${randomUUID()}`);

  try {
    const { videoPath } = (await req.json()) as RemoveEnhanceRequest;
    const input = assertVideoPath(videoPath);
    const output = input.replace(/\.mp4$/i, "_clean_enhanced.mp4");
    const audio = path.join(tempDir, "source.wav");
    const enhanced = path.join(tempDir, "enhanced.wav");
    const vocals = path.join(tempDir, "separated", "mdx_extra_q", "source", "vocals.mp3");

    await fs.mkdir(tempDir, { recursive: true });
    await runFfmpeg(["-y", "-i", input, "-q:a", "0", "-map", "a", audio]);
    await runDemucs(["-n", "mdx_extra_q", "--mp3", audio], tempDir);
    await runFfmpeg([
      "-y",
      "-i",
      vocals,
      "-af",
      "loudnorm,aresample=48000,highpass=f=80,lowpass=f=12000",
      enhanced,
    ]);
    await runFfmpeg(["-y", "-i", input, "-i", enhanced, "-c:v", "copy", "-map", "0:v:0", "-map", "1:a:0", output]);

    return NextResponse.json({ ok: true, output });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to remove and enhance audio." },
      { status: 500 },
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
