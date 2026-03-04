import path from "node:path";
import { spawn } from "node:child_process";

export type CmdResult = { code: number; stdout: string; stderr: string };

export function resolveFfmpegPath(): string {
  const p = (process.env.FFMPEG_PATH || "").trim();
  return p.length ? p : "ffmpeg";
}

export function resolveFfprobePath(): string {
  const p = (process.env.FFPROBE_PATH || "").trim();
  if (p.length) return p;

  // Common case on Windows: ffprobe.exe lives next to ffmpeg.exe.
  const ff = (process.env.FFMPEG_PATH || "").trim();
  if (ff && /ffmpeg(\.exe)?$/i.test(ff)) {
    const dir = path.dirname(ff);
    const candidate = path.join(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    return candidate;
  }

  return "ffprobe";
}

export async function runCmd(bin: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<CmdResult> {
  const timeoutMs = opts?.timeoutMs ?? 0;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts?.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const to = timeoutMs
      ? setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${bin}`));
        }, timeoutMs)
      : null;

    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => {
      if (to) clearTimeout(to);
      reject(e);
    });
    child.on("close", (code) => {
      if (to) clearTimeout(to);
      resolve({ code: typeof code === "number" ? code : -1, stdout, stderr });
    });
  });
}

export async function probeDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const ffprobe = resolveFfprobePath();
    const r = await runCmd(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    if (r.code !== 0) return null;
    const s = (r.stdout || "").trim();
    const d = Number(s);
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}
