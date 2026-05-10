import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type CmdResult = { code: number; stdout: string; stderr: string };

function isExecutableFile(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function commonWindowsCandidates(binName: "ffmpeg" | "ffprobe"): string[] {
  const exe = `${binName}.exe`;
  return [
    path.join("C:\\", "ffmpeg", "bin", exe),
    path.join("C:\\", "tools", "ffmpeg", "bin", exe),
    path.join("C:\\", "Program Files", "ffmpeg", "bin", exe),
    path.join("C:\\", "Program Files (x86)", "ffmpeg", "bin", exe),
  ];
}

function resolveBinary(envKeys: string[], fallbackBin: "ffmpeg" | "ffprobe"): string {
  for (const key of envKeys) {
    const raw = (process.env[key] || "").trim();
    if (raw && isExecutableFile(raw)) return raw;
  }

  if (process.platform === "win32") {
    for (const candidate of commonWindowsCandidates(fallbackBin)) {
      if (isExecutableFile(candidate)) return candidate;
    }
  }

  return fallbackBin;
}

export function resolveFfmpegPath(): string {
  return resolveBinary(["OTG_FFMPEG_PATH", "FFMPEG_PATH"], "ffmpeg");
}

export function resolveFfprobePath(): string {
  const explicit = resolveBinary(["OTG_FFPROBE_PATH", "FFPROBE_PATH"], "ffprobe");
  if (explicit !== "ffprobe") return explicit;

  const ffmpeg = resolveFfmpegPath();
  if (ffmpeg !== "ffmpeg" && /ffmpeg(\.exe)?$/i.test(ffmpeg)) {
    const dir = path.dirname(ffmpeg);
    const sibling = path.join(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (isExecutableFile(sibling)) return sibling;
  }

  return explicit;
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
    const r = await runCmd(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeoutMs: 15000 },
    );
    if (r.code !== 0) return null;
    const s = (r.stdout || "").trim();
    const d = Number(s);
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

export async function getFfmpegVersion(): Promise<string | null> {
  try {
    const ffmpeg = resolveFfmpegPath();
    const r = await runCmd(ffmpeg, ["-version"], { timeoutMs: 10000 });
    if (r.code !== 0) return null;
    const first = (r.stdout || "").split(/\r?\n/).find(Boolean) || "";
    return first.trim() || null;
  } catch {
    return null;
  }
}
