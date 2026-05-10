import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

// OTG_SEEDVC_FORM_ALIAS_FIX_V10

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VOICES_ROOT = path.resolve(process.env.OTG_VOICES_ROOT || "C:\\AI\\Voices");
const SEED_VC_ROOT = path.resolve(process.env.SEED_VC_ROOT || path.join(VOICES_ROOT, "Seed-Vc"));
const ALLOWED_REFERENCE_ROOTS = [VOICES_ROOT, path.resolve(OTG_DATA_ROOT), path.resolve(process.cwd(), "data")];
const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aac|ogg|webm)$/i;
const MODEL_EXT_RE = /\.(pth|pt|ckpt|safetensors|onnx)$/i;
const IGNORE_RE = /[\\/](venv|\.venv|env|node_modules|site-packages|test_data|tests|__pycache__|\.git|scipy)[\\/]/i;
const COMMAND_TIMEOUT_MS = Number(process.env.SEEDVC_COMMAND_TIMEOUT_MS || process.env.XTTS_COMMAND_TIMEOUT_MS || process.env.VOICE_DUB_TIMEOUT_MS || 900000);
const WHISPER_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS || 600000);
const MAX_TRANSCRIPT_CHARS = Number(process.env.XTTS_MAX_TRANSCRIPT_CHARS || 1200);

type Engine = "seed-vc" | "xtts";

type ResolvedVoice = {
  voicePath: string;
  engine: Engine;
  modelPath: string;
  indexPath: string;
  samplePath: string;
  modelName: string;
  isAudioReference: boolean;
};

function ownerJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_dub_jobs", safeSegment(ownerKey || "local"));
}

function cleanTitle(value: string) {
  return String(value || "voice_dub")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "voice_dub";
}

function assertInside(base: string, target: string) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function expandVoicePath(rawValue: string) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if (raw.startsWith("OTG_DATA_ROOT")) {
    return path.resolve(OTG_DATA_ROOT, raw.slice("OTG_DATA_ROOT".length).replace(/^[\\/]+/, ""));
  }
  return path.resolve(raw);
}

function listFiles(dir: string, maxDepth = 5) {
  const files: string[] = [];
  function walk(current: string, depth: number) {
    if (depth > maxDepth || IGNORE_RE.test(`${current}${path.sep}`)) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (IGNORE_RE.test(full)) continue;
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(dir, 0);
  return files;
}

function newest(files: string[], re: RegExp) {
  return files
    .filter((file) => re.test(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function findSeedVcScript() {
  const configuredRaw = process.env.SEED_VC_SCRIPT?.trim() || "";
  const configured = process.platform === "win32" && configuredRaw.startsWith("/opt/") ? "" : configuredRaw;
  const candidates = [
    configured || "",
    path.join(SEED_VC_ROOT, "inference.py"),
    path.join(SEED_VC_ROOT, "inference_v2.py"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function seedVcPython() {
  const configured = process.env.SEED_VC_PYTHON?.trim();
  if (configured && !(process.platform === "win32" && configured.startsWith("/opt/"))) return configured;
  const winVenv = path.join(SEED_VC_ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) return winVenv;
  const venv = path.join(SEED_VC_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return "python";
}

function hasSeedVcRuntime() {
  return Boolean(process.env.SEEDVC_DUB_COMMAND?.trim() || findSeedVcScript());
}

function resolveVoice(voicePathRaw: string, requestedEngineRaw: string): ResolvedVoice {
  const voicePath = expandVoicePath(voicePathRaw);
  const allowed = ALLOWED_REFERENCE_ROOTS.some((root) => assertInside(root, voicePath));
  if (!voicePath || !allowed || !fs.existsSync(voicePath) || IGNORE_RE.test(voicePath)) {
    throw new Error("Selected voice path is invalid. Use a Characters tab reference voice or a clean source under C:\\AI\\Voices.");
  }

  const stat = fs.statSync(voicePath);
  const files = stat.isDirectory() ? listFiles(voicePath) : [voicePath];
  const modelPath = newest(files, MODEL_EXT_RE);
  const indexPath = newest(files, /\.index$/i);
  const samplePath = stat.isFile() && AUDIO_EXT_RE.test(voicePath) ? voicePath : newest(files, AUDIO_EXT_RE);
  const requestedEngine = String(requestedEngineRaw || "auto").toLowerCase();

  let engine: Engine;
  if (requestedEngine === "seed-vc" || requestedEngine === "xtts") {
    engine = requestedEngine;
  } else {
    engine = hasSeedVcRuntime() && samplePath ? "seed-vc" : "xtts";
  }

  if (engine === "seed-vc" && !samplePath) {
    throw new Error("Seed-VC requires a clean reference audio sample. Select a Characters tab voice or upload/extract a voice sample first.");
  }
  if (engine === "xtts" && !samplePath) {
    throw new Error("XTTS fallback requires a clean reference audio file from Characters or C:\\AI\\Voices.");
  }

  return {
    voicePath,
    engine,
    modelPath,
    indexPath,
    samplePath,
    modelName: modelPath ? path.basename(modelPath, path.extname(modelPath)) : path.basename(samplePath || voicePath, path.extname(samplePath || voicePath)),
    isAudioReference: Boolean(samplePath) && !modelPath,
  };
}

async function saveUpload(file: File, outPath: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(outPath, bytes);
}

function splitCommand(template: string) {
  const result: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if ((ch === '"' || ch === "'") && template[i - 1] !== "\\") {
      quote = quote === ch ? null : quote || ch;
      continue;
    }
    if (/\s/.test(ch) && !quote) {
      if (current) result.push(current), current = "";
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result;
}

function fillTemplate(template: string, values: Record<string, string>) {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{${key}}`, value);
  }
  return output;
}

async function runCommand(template: string, values: Record<string, string>, cwd?: string, timeoutMs = COMMAND_TIMEOUT_MS) {
  const filled = fillTemplate(template, values);
  const parts = splitCommand(filled);
  if (!parts.length) throw new Error("Voice conversion command is empty.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(parts[0], parts.slice(1), { cwd, windowsHide: true, shell: false });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Voice conversion command timed out after ${Math.round(timeoutMs / 1000)} seconds: ${parts[0]}`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Voice conversion command failed with exit code ${code}. ${stderr || stdout}`.slice(0, 5000)));
    });
  });
}

async function convertWithFfmpeg(inputPath: string, outputPath: string) {
  const cmd = process.env.FFMPEG_PATH || "ffmpeg";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "44100", outputPath], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg audio normalization failed with exit code ${code}. ${stderr}`.slice(0, 4000))));
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeAudio(audioPath: string, jobDir: string) {
  const outText = path.join(jobDir, "performance_transcript.txt");
  const command = process.env.WHISPER_DUB_COMMAND || process.env.FASTER_WHISPER_COMMAND || "";
  if (command.trim()) {
    await runCommand(command, { audio: audioPath, input: audioPath, output: outText, outDir: jobDir }, jobDir, WHISPER_TIMEOUT_MS);
    if (fs.existsSync(outText)) return (await fsp.readFile(outText, "utf8")).trim();
  }

  const whisperUrl = (process.env.WHISPER_SERVER_URL || "http://127.0.0.1:9001/transcribe").trim();
  try {
    const healthUrl = whisperUrl.replace(/\/transcribe\/?$/i, "/health");
    await fetchWithTimeout(healthUrl, { method: "GET" }, 7000);
  } catch {
    throw new Error(`Whisper server is not reachable at ${whisperUrl}. Start C:\\AI\\Services\\whisper\\run_whisper_server.bat.`);
  }

  const audioBytes = await fsp.readFile(audioPath);
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(audioBytes)], { type: "audio/wav" }), "performance.wav");
  const resp = await fetchWithTimeout(whisperUrl, { method: "POST", body: fd }, WHISPER_TIMEOUT_MS);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Whisper server failed (${resp.status}). ${detail}`.slice(0, 1200));
  }
  const data = await resp.json().catch(() => ({}));
  const text = String(data?.text || "").trim();
  if (!text) throw new Error("Whisper returned an empty transcript. Record clearer audio or use XTTS Video Dub with manual transcript.");
  await fsp.writeFile(outText, text, "utf8");
  return text;
}

async function synthesizeWithXttsServer(text: string, speakerWav: string, outputPath: string) {
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`Transcript is ${text.length} characters. Voice Conversion XTTS fallback is whole-audio v1 and is capped at ${MAX_TRANSCRIPT_CHARS} characters. Use a shorter clip until segment timing is added.`);
  }
  const xttsUrl = (process.env.XTTS_SERVER_URL || "http://127.0.0.1:7862/synthesize").trim();
  const fd = new FormData();
  fd.append("text", text);
  fd.append("speaker_path", speakerWav);
  fd.append("output_path", outputPath);
  fd.append("language", process.env.XTTS_LANGUAGE || "en");
  const resp = await fetchWithTimeout(xttsUrl, { method: "POST", body: fd }, COMMAND_TIMEOUT_MS);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`XTTS server failed (${resp.status}). ${detail}`.slice(0, 2000));
  }
  const data = await resp.json().catch(() => ({}));
  if (!data?.ok) throw new Error(String(data?.error || "XTTS server did not return ok=true."));
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error("XTTS server returned ok=true, but output audio was not written.");
  }
}

async function runXttsFallback(inputPath: string, outputPath: string, samplePath: string, jobDir: string) {
  const transcript = await transcribeAudio(inputPath, jobDir);
  await synthesizeWithXttsServer(transcript, samplePath, outputPath);
  return transcript;
}

function newestAudioInDir(dir: string) {
  if (!fs.existsSync(dir)) return "";
  return listFiles(dir, 5)
    .filter((file) => AUDIO_EXT_RE.test(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function defaultSeedVcCommand() {
  const script = findSeedVcScript();
  if (!script) return "";
  const py = seedVcPython();
  const steps = process.env.SEEDVC_DIFFUSION_STEPS || "25";
  const lengthAdjust = process.env.SEEDVC_LENGTH_ADJUST || "1.0";
  const cfg = process.env.SEEDVC_CFG_RATE || "0.7";
  if (/inference_v2\.py$/i.test(script)) {
    return `"${py}" "${script}" --source "{input}" --target "{sample}" --output "{outputDir}" --diffusion-steps ${steps} --length-adjust ${lengthAdjust} --intelligibility-cfg-rate ${cfg} --similarity-cfg-rate ${cfg} --repetition-penalty 1.0`;
  }
  return `"${py}" "${script}" --source "{input}" --target "{sample}" --output "{outputDir}" --diffusion-steps ${steps} --length-adjust ${lengthAdjust} --inference-cfg-rate ${cfg} --f0-condition False --auto-f0-adjust False --semi-tone-shift {pitch} --fp16 True`;
}

async function runSeedVc(inputPath: string, outputPath: string, samplePath: string, pitch: string, jobDir: string) {
  const outputDir = safeJoin(jobDir, "seedvc_output");
  ensureDir(outputDir);
  const command = process.env.SEEDVC_DUB_COMMAND?.trim() || defaultSeedVcCommand();
  if (!command) {
    throw new Error("Seed-VC is not installed or SEEDVC_DUB_COMMAND is not configured. Install Seed-VC at C:\\AI\\Voices\\Seed-Vc or set SEED_VC_ROOT / SEEDVC_DUB_COMMAND.");
  }
  await runCommand(command, {
    input: inputPath,
    output: outputPath,
    outputDir,
    voice: samplePath,
    model: "",
    index: "",
    sample: samplePath,
    speaker: samplePath,
    target: samplePath,
    pitch,
  }, SEED_VC_ROOT, COMMAND_TIMEOUT_MS);

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    const generated = newestAudioInDir(outputDir);
    if (!generated) {
      throw new Error("Seed-VC finished but no audio output was found. Check the Seed-VC console output and command template.");
    }
    await fsp.copyFile(generated, outputPath);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error("Seed-VC did not write a usable output file.");
  }
}

async function runConversion(args: { engine: Engine; inputPath: string; outputPath: string; voicePath: string; modelPath: string; indexPath: string; samplePath: string; pitch: string; jobDir: string }) {
  if (args.engine === "seed-vc") {
    await runSeedVc(args.inputPath, args.outputPath, args.samplePath, args.pitch, args.jobDir);
    return { transcript: "", mode: "seed-vc-reference" };
  }

  const transcript = await runXttsFallback(args.inputPath, args.outputPath, args.samplePath, args.jobDir);
  return { transcript, mode: "xtts-whisper-reference" };
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();
    const performance = form.get("performance_audio") || form.get("audio") || form.get("file") || form.get("performanceAudio");
    if (!performance || typeof (performance as any).arrayBuffer !== "function" || Number((performance as any).size || 0) <= 0) {
      return NextResponse.json({ ok: false, error: "Missing performance audio upload. Record again or re-select the uploaded audio after restarting the app." }, { status: 400 });
    }

    const voicePathRaw = String(form.get("voice_path") || form.get("voicePath") || form.get("selectedVoicePath") || form.get("modelPath") || "").trim();
    const requestedEngine = String(form.get("engine") || "auto").trim().toLowerCase();
    const pitch = String(Number(form.get("pitch") || form.get("pitchShift") || 0) || 0);
    const title = cleanTitle(String(form.get("title") || form.get("outputName") || "voice_dub"));
    const voice = resolveVoice(voicePathRaw, requestedEngine);

    const root = ownerJobRoot(owner.ownerKey);
    ensureDir(root);
    const jobId = `voice-dub-${Date.now()}`;
    const jobDir = path.join(root, jobId);
    ensureDir(jobDir);

    const perfFile = performance as File;
    const inputExt = AUDIO_EXT_RE.test(perfFile.name || "") ? path.extname(perfFile.name).toLowerCase() : ".webm";
    const rawInput = safeJoin(jobDir, `performance${inputExt}`);
    const normalizedInput = safeJoin(jobDir, "performance_44100.wav");
    const outputPath = safeJoin(jobDir, `${title}.wav`);
    await saveUpload(perfFile, rawInput);
    await convertWithFfmpeg(rawInput, normalizedInput);

    const conversion = await runConversion({
      engine: voice.engine,
      inputPath: normalizedInput,
      outputPath,
      voicePath: voice.voicePath,
      modelPath: voice.modelPath,
      indexPath: voice.indexPath,
      samplePath: voice.samplePath,
      pitch,
      jobDir,
    });

    const stat = await fsp.stat(outputPath);
    const meta = {
      type: "voice-dub-job",
      source: "edit-video-voice-dubbing",
      operation: "voice-dubbing",
      engine: voice.engine,
      conversionMode: conversion.mode,
      modelName: voice.modelName,
      voicePath: voice.voicePath,
      modelPath: voice.modelPath,
      indexPath: voice.indexPath,
      samplePath: voice.samplePath,
      pitch: Number(pitch),
      transcript: conversion.transcript || undefined,
      inputFileName: perfFile.name || "performance_audio",
      outputFileName: path.basename(outputPath),
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(`${outputPath}.json`, JSON.stringify(meta, null, 2), "utf8");

    const message = conversion.mode === "seed-vc-reference"
      ? "Voice conversion is ready using Seed-VC zero-shot reference conversion."
      : "Voice conversion is ready using Whisper transcript plus XTTS character reference voice. This is transcript-based fallback, not true voice-to-voice timing.";

    return NextResponse.json({
      ok: true,
      jobId,
      fileName: path.basename(outputPath),
      audioPath: outputPath,
      url: `/api/voice/dub/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(path.basename(outputPath))}`,
      saved: false,
      engine: voice.engine,
      conversionMode: conversion.mode,
      modelName: voice.modelName,
      sizeBytes: stat.size,
      message,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Voice dubbing failed" }, { status: 500 });
  }
}
