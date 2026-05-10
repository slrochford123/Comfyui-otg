// OTG_VOICE_TEXT_TO_SPEECH_PROVIDER_V2

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type TtsProvider = "indextts2" | "omnivoice";

const VOICES_ROOT = path.resolve(process.env.OTG_VOICES_ROOT || "C:\\AI\\Voices");
const ALLOWED_REFERENCE_ROOTS = [VOICES_ROOT, path.resolve(OTG_DATA_ROOT), path.resolve(process.cwd(), "data")];
const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aac|ogg|webm)$/i;
const IGNORE_RE = /[\\/](venv|\.venv|env|node_modules|site-packages|test_data|tests|__pycache__|\.git|scipy)[\\/]/i;
const COMMAND_TIMEOUT_MS = Number(process.env.TTS_COMMAND_TIMEOUT_MS || process.env.INDEXTTS2_COMMAND_TIMEOUT_MS || process.env.OMNIVOICE_COMMAND_TIMEOUT_MS || 900000);

function ownerTtsRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_tts_jobs", safeSegment(ownerKey || "local"));
}

function cleanTitle(value: string) {
  return String(value || "character_tts")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "character_tts";
}

function providerLabel(provider: TtsProvider) {
  return provider === "omnivoice" ? "OmniVoice" : "IndexTTS2";
}

function normalizeProvider(value: string): TtsProvider {
  const raw = String(value || "").toLowerCase();
  return raw === "omnivoice" || raw === "omni" ? "omnivoice" : "indextts2";
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

function validateReferencePath(rawValue: string) {
  const voicePath = expandVoicePath(rawValue);
  const allowed = ALLOWED_REFERENCE_ROOTS.some((root) => assertInside(root, voicePath));
  if (!voicePath || !allowed || !fs.existsSync(voicePath) || IGNORE_RE.test(voicePath)) {
    throw new Error("Selected voice source is invalid. Use a Characters reference voice or a clean C:\\AI\\Voices source.");
  }
  const stat = fs.statSync(voicePath);
  if (stat.isFile()) {
    if (!AUDIO_EXT_RE.test(voicePath)) throw new Error("Selected voice source must be an audio reference file.");
    return voicePath;
  }
  const sample = listFiles(voicePath, 5)
    .filter((file) => AUDIO_EXT_RE.test(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!sample) throw new Error("Selected voice folder has no clean reference audio.");
  return sample;
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

async function runCommand(template: string, values: Record<string, string>, cwd?: string) {
  const filled = fillTemplate(template, values);
  const parts = splitCommand(filled);
  if (!parts.length) throw new Error("TTS command is empty.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(parts[0], parts.slice(1), { cwd, windowsHide: true, shell: false });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`TTS command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)} seconds: ${parts[0]}`));
    }, COMMAND_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`TTS command failed with exit code ${code}. ${stderr || stdout}`.slice(0, 5000)));
    });
  });
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function writeBinaryResponse(resp: Response, outputPath: string) {
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("audio/") && !contentType.includes("octet-stream")) return false;
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!bytes.length) return false;
  await fsp.writeFile(outputPath, bytes);
  return true;
}

async function synthesizeIndexTts2(values: Record<string, string>, outputPath: string) {
  const command = process.env.INDEXTTS2_TTS_COMMAND || "";
  if (command.trim()) {
    await runCommand(command, values, path.dirname(values.voice || VOICES_ROOT));
  } else {
    const ttsUrl = process.env.INDEXTTS2_TTS_URL || process.env.INDEXTTS2_URL || "";
    if (!ttsUrl.trim()) {
      throw new Error("IndexTTS2 is not configured. Set INDEXTTS2_TTS_COMMAND or INDEXTTS2_TTS_URL.");
    }
    const resp = await fetchWithTimeout(ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: values.text,
        emotion: values.emotion,
        voice: values.voice,
        speed: Number(values.speed || 1),
        emotion_strength: Number(values.emotion_strength || 0.8),
        style_strength: Number(values.style_strength || 0.8),
        language: values.language || "en",
        seed: values.seed || "random",
        output_path: outputPath,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`IndexTTS2 failed (${resp.status}). ${detail}`.slice(0, 2000));
    }
    await writeBinaryResponse(resp, outputPath);
  }
}

async function synthesizeOmniVoice(values: Record<string, string>, outputPath: string) {
  const command = process.env.OMNIVOICE_TTS_COMMAND || "";
  if (command.trim()) {
    await runCommand(command, values, process.env.OMNIVOICE_ROOT || path.join(VOICES_ROOT, "OmniVoice"));
  } else {
    const omniUrl = process.env.OMNIVOICE_TTS_URL || process.env.OMNIVOICE_URL || "";
    if (!omniUrl.trim()) {
      throw new Error("OmniVoice is not configured. Set OMNIVOICE_TTS_COMMAND or OMNIVOICE_TTS_URL after installing OmniVoice.");
    }
    const resp = await fetchWithTimeout(omniUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: values.text,
        prompt: values.text,
        emotion: values.emotion,
        reference_audio: values.voice,
        voice: values.voice,
        language: values.language || "auto",
        output_path: outputPath,
        speed: Number(values.speed || 1),
        seed: values.seed || "random",
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`OmniVoice failed (${resp.status}). ${detail}`.slice(0, 2000));
    }
    await writeBinaryResponse(resp, outputPath);
  }
}

function assertOutput(outputPath: string, provider: TtsProvider) {
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error(`${providerLabel(provider)} finished without writing usable audio output.`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();
    const text = String(form.get("text") || "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "Text is required." }, { status: 400 });

    const provider = normalizeProvider(String(form.get("provider") || form.get("engine") || "indextts2"));
    const title = cleanTitle(String(form.get("title") || "character_tts"));
    const root = ownerTtsRoot(owner.ownerKey);
    ensureDir(root);
    const jobId = `voice-tts-${provider}-${Date.now()}`;
    const jobDir = safeJoin(root, jobId);
    ensureDir(jobDir);

    const uploadedVoice = form.get("voice_upload");
    let referencePath = "";
    if (uploadedVoice instanceof File && uploadedVoice.size > 0) {
      if (!AUDIO_EXT_RE.test(uploadedVoice.name || "")) return NextResponse.json({ ok: false, error: "Uploaded voice sample must be audio." }, { status: 400 });
      referencePath = safeJoin(jobDir, `reference${path.extname(uploadedVoice.name).toLowerCase() || ".wav"}`);
      await saveUpload(uploadedVoice, referencePath);
    } else {
      const voicePathRaw = String(form.get("voice_sample_path") || form.get("voice_path") || "").trim();
      referencePath = validateReferencePath(voicePathRaw);
    }

    const outputPath = safeJoin(jobDir, `${title}.wav`);
    const values = {
      text,
      prompt: text,
      emotion: String(form.get("emotion") || "").trim(),
      language: String(form.get("language") || "en").trim() || "en",
      speed: String(form.get("speed") || "1"),
      emotion_strength: String(form.get("emotion_strength") || "0.8"),
      style_strength: String(form.get("style_strength") || "0.8"),
      seed: String(form.get("seed") || "random").trim() || "random",
      voice: referencePath,
      speaker: referencePath,
      reference: referencePath,
      output: outputPath,
      output_path: outputPath,
      out: outputPath,
    };

    if (provider === "omnivoice") await synthesizeOmniVoice(values, outputPath);
    else await synthesizeIndexTts2(values, outputPath);
    assertOutput(outputPath, provider);

    const stat = await fsp.stat(outputPath);
    const modelName = String(form.get("model_name") || (uploadedVoice instanceof File ? "Manual voice sample" : path.basename(referencePath))).trim();
    await fsp.writeFile(`${outputPath}.json`, JSON.stringify({
      type: "voice-tts-job",
      operation: "text-to-speech",
      engine: provider,
      provider,
      modelName,
      referencePath,
      emotion: values.emotion,
      language: values.language,
      outputFileName: path.basename(outputPath),
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    }, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      jobId,
      fileName: path.basename(outputPath),
      audioPath: outputPath,
      url: `/api/voice/tts/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(path.basename(outputPath))}`,
      saved: false,
      engine: provider,
      provider,
      modelName,
      sizeBytes: stat.size,
      message: `${providerLabel(provider)} Text-to-Speech audio is ready.`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "Text-to-Speech failed" }, { status: 500 });
  }
}
