import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import fs from "node:fs";
import { requireSessionUser, SessionInvalidError } from "@/lib/sessionUser";
import { productionAudioMediaReadable } from "@/lib/productionAudioAccess";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireSessionUser(req);
    const { videoPath } = (await req.json()) as EnhanceAudioRequest;
    const input = assertVideoPath(videoPath);
    if (!await productionAudioMediaReadable(req, input)) return NextResponse.json({ok:false,error:"Source media unavailable for this account."},{status:404});
    const jobId = randomUUID();
    const dir = path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(user.ownerKey), jobId);
    fs.mkdirSync(dir, {recursive:true,mode:0o700});
    const output = path.join(dir,"enhanced.mp4");
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

    return NextResponse.json({ ok: true, output, jobId, fileName:"enhanced.mp4", url:`/api/edit-video/file?jobId=${jobId}&name=enhanced.mp4` });
  } catch (error) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to enhance audio." },
      { status: 500 },
    );
  }
}
