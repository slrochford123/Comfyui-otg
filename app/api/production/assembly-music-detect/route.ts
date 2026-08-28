import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveFfprobePath() {
  return String(process.env.FFPROBE_PATH || process.env.OTG_FFPROBE_PATH || "ffprobe");
}

function runCommand(command: string, args: string[], timeoutMs = 120_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed with exit ${code}: ${stderr || stdout}`));
    });
  });
}

async function probeDurationSeconds(filePath: string) {
  const { stdout } = await runCommand(resolveFfprobePath(), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  const duration = Number(String(stdout || "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("ffprobe did not return a valid duration.");
  }

  return duration;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const videoPath = String(body?.videoPath || "").trim();
    const fallbackDurationSeconds = Number(body?.fallbackDurationSeconds || body?.rowsDurationSeconds || 0);

    if (videoPath && path.isAbsolute(videoPath) && fs.existsSync(videoPath)) {
      const durationSeconds = await probeDurationSeconds(videoPath);
      return NextResponse.json({
        ok: true,
        source: "ffprobe",
        durationSeconds,
        roundedDurationSeconds: Math.max(1, Math.ceil(durationSeconds)),
      });
    }

    if (Number.isFinite(fallbackDurationSeconds) && fallbackDurationSeconds > 0) {
      return NextResponse.json({
        ok: true,
        source: "timeline_rows",
        durationSeconds: fallbackDurationSeconds,
        roundedDurationSeconds: Math.max(1, Math.ceil(fallbackDurationSeconds)),
      });
    }

    return NextResponse.json(
      { ok: false, error: "No assembled video path or fallback timeline duration was available." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Timeline detection failed." },
      { status: 500 },
    );
  }
}
