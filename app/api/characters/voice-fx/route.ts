import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const DEFAULT_DEVICE_ID = "web_characters_builder";
function commandPath(value: string) {
  if (!value) return value;
  if (path.isAbsolute(value)) return path.resolve(value);
  return value;
}

const PYTHON_EXE = commandPath(process.env.OTG_VOICE_FX_PYTHON || "python");
const VOICE_FX_SCRIPT = path.resolve(process.env.OTG_VOICE_FX_SCRIPT || path.join(process.cwd(), "scripts", "process_voice_fx.py"));
const FFMPEG_EXE = process.env.OTG_FFMPEG || "ffmpeg";
const VOICE_FX_TIMEOUT_MS = Math.max(30_000, Number(process.env.OTG_VOICE_FX_TIMEOUT_MS || 5 * 60 * 1000));

function safeSegment(value: unknown, fallback = "item") {
  const text = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return text || fallback;
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function publicAudioUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/data/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return "";
  return "/api/characters/voice-file?path=" + encodeURIComponent(normalized.slice(markerIndex + marker.length));
}

function runVoiceFx(args: {
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      PYTHON_EXE,
      [
        VOICE_FX_SCRIPT,
        "--params-json",
        args.paramsPath,
        "--stdout-log",
        args.stdoutPath,
        "--stderr-log",
        args.stderrPath,
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: "ignore",
      },
    );

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("Voice FX processing timed out."));
    }, VOICE_FX_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      const stderr = await fs.readFile(args.stderrPath, "utf8").catch(() => "");
      const stdout = await fs.readFile(args.stdoutPath, "utf8").catch(() => "");
      reject(new Error(("Voice FX failed with exit code " + code + ".\n" + stderr + "\n" + stdout).trim()));
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body) {
      return Response.json({ ok: false, error: "Missing JSON body." }, { status: 400 });
    }

    const characterId = safeSegment(body.characterId, "character");
    const candidateId = safeSegment(body.candidateId, "candidate");
    const deviceId = safeSegment(request.headers.get("x-otg-device-id") || body.deviceId || DEFAULT_DEVICE_ID, DEFAULT_DEVICE_ID);

    const inputPath = String(body.inputPath || body.input_wav || "").trim();

    if (!inputPath) {
      return Response.json({ ok: false, error: "Missing inputPath." }, { status: 400 });
    }

    const resolvedInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);

    if (!(await fileExists(resolvedInputPath))) {
      return Response.json({ ok: false, error: "Input WAV does not exist.", inputPath: resolvedInputPath }, { status: 404 });
    }

    if (!(await fileExists(VOICE_FX_SCRIPT))) {
      return Response.json({ ok: false, error: "Voice FX script is missing.", script: VOICE_FX_SCRIPT }, { status: 500 });
    }

    const outDir = path.join(process.cwd(), "data", "characters", deviceId, "voice-fx", characterId);
    const logsDir = path.join(outDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });

    const outputWav = path.join(outDir, "fx_" + candidateId + "_" + Date.now() + ".wav");
    const paramsPath = path.join(logsDir, "fx_" + candidateId + "_params.json");
    const stdoutPath = path.join(logsDir, "fx_" + candidateId + "_stdout.log");
    const stderrPath = path.join(logsDir, "fx_" + candidateId + "_stderr.log");

    const params = {
      ffmpeg: FFMPEG_EXE,
      input_wav: resolvedInputPath,
      output_wav: outputWav,
      pitchSemitones: Number(body.pitchSemitones || 0),
      speed: Number(body.speed || 1),
      gainDb: Number(body.gainDb || 0),
      highpassHz: Number(body.highpassHz || 0),
      lowpassHz: Number(body.lowpassHz || 0),
      echo: String(body.echo || "off"),
      normalize: body.normalize !== false,
      preset: String(body.preset || "custom"),
      tonePreset: String(body.tonePreset || "neutral"),
      bodyMode: String(body.bodyMode || "normal"),
      gritAmount: Number(body.gritAmount || 0),
      compression: String(body.compression || "off"),
      layerMode: String(body.layerMode || "off"),
      layerMix: Number(body.layerMix || 0),
    };

    await fs.writeFile(paramsPath, JSON.stringify(params, null, 2) + "\n", "utf8");

    await runVoiceFx({ paramsPath, stdoutPath, stderrPath });

    const stdoutJson = await fs.readFile(stdoutPath, "utf8").catch(() => "");
    const meta = stdoutJson.trim() ? JSON.parse(stdoutJson) : null;

    return Response.json({
      ok: true,
      engine: "OTG Voice FX",
      characterId,
      candidateId,
      inputPath: resolvedInputPath,
      outputPath: outputWav,
      audioPath: outputWav,
      audioUrl: publicAudioUrl(outputWav),
      params,
      meta,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || String(error),
      },
      { status: 500 },
    );
  }
}
