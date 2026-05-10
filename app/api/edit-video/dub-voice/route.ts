// OTG_QWEN3_WHISPER_API_BRIDGE_V12
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getGallerySourcesForRequest, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VOICES_ROOT = path.resolve(process.env.OTG_VOICES_ROOT || "C:\\AI\\Voices");
const ALLOWED_ROOTS = [VOICES_ROOT, path.resolve(OTG_DATA_ROOT)];
const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aac|ogg|webm)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv)$/i;
const IGNORE_RE = /[\\/](venv|\.venv|env|node_modules|site-packages|test_data|tests|__pycache__|\.git|scipy)[\\/]/i;

type DubMode = "replace" | "overlay";
type TtsEngine = "xtts" | "qwen3";

function jobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_dub_voice_jobs", safeSegment(ownerKey || "local"));
}

function cleanTitle(value: string) {
  return String(value || "tts_video_dub")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "tts_video_dub";
}

function normalizeTtsEngine(value: string): TtsEngine {
  return String(value || "xtts").toLowerCase() === "qwen3" ? "qwen3" : "xtts";
}

function ttsEngineLabel(engine: TtsEngine) {
  return engine === "qwen3" ? "Qwen3-TTS" : "XTTS";
}

function assertInside(base: string, target: string) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function expandVoicePath(rawValue: string) {
  const raw = String(rawValue || "").trim();
  if (raw.startsWith("OTG_DATA_ROOT")) {
    return path.resolve(OTG_DATA_ROOT, raw.slice("OTG_DATA_ROOT".length).replace(/^[\\/]+/, ""));
  }
  return path.resolve(raw);
}

function validateVoicePath(rawValue: string) {
  const voicePath = expandVoicePath(rawValue);
  const allowed = ALLOWED_ROOTS.some((root) => assertInside(root, voicePath));
  if (!allowed || !fs.existsSync(voicePath) || IGNORE_RE.test(voicePath)) {
    throw new Error("Selected voice source is invalid. Use a Characters reference voice or a clean C:\\AI\\Voices source, not venv/site-packages/test files.");
  }
  if (fs.statSync(voicePath).isFile() && !AUDIO_EXT_RE.test(voicePath)) {
    throw new Error("Selected voice source must be clean reference audio for XTTS.");
  }
  if (fs.statSync(voicePath).isDirectory()) {
    const sample = newestAudio(voicePath);
    if (!sample) throw new Error("Selected voice folder has no clean reference audio for XTTS.");
    return sample;
  }
  return voicePath;
}

function newestAudio(dir: string) {
  const files: string[] = [];
  function walk(current: string, depth: number) {
    if (depth > 4 || IGNORE_RE.test(`${current}${path.sep}`)) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (IGNORE_RE.test(full)) continue;
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && AUDIO_EXT_RE.test(full)) files.push(full);
    }
  }
  walk(dir, 0);
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

async function saveUpload(file: File, outPath: string) {
  await fsp.writeFile(outPath, Buffer.from(await file.arrayBuffer()));
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
  for (const [key, value] of Object.entries(values)) output = output.replaceAll(`{${key}}`, value);
  return output;
}

async function runCommand(template: string, values: Record<string, string>, cwd?: string) {
  const filled = fillTemplate(template, values);
  const parts = splitCommand(filled);
  if (!parts.length) throw new Error("Command template is empty.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(parts[0], parts.slice(1), { cwd, windowsHide: true, shell: false });
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Command failed with exit code ${code}. ${stderr || stdout}`.slice(0, 4000))));
  });
}

async function runFfmpeg(args: string[]) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed with exit code ${code}. ${stderr}`.slice(0, 3000))));
  });
}

async function postAudioToWhisperService(audioPath: string) {
  const baseUrl = String(process.env.WHISPER_URL || process.env.WHISPER_DUB_URL || "http://127.0.0.1:9001").replace(/\/+$/, "");
  const form = new FormData();
  const data = await fsp.readFile(audioPath);
  form.set("file", new Blob([new Uint8Array(data)], { type: "audio/wav" }), path.basename(audioPath));
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/transcribe`, { method: "POST", body: form });
  } catch (error: any) {
    throw new Error(`Whisper service is not reachable at ${baseUrl}. Start C:\AI\Services\whisper\run_whisper_server.bat or type the transcript manually. ${error?.message || ""}`.trim());
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Whisper service failed with HTTP ${response.status}.`);
  }
  return String(payload?.text || payload?.transcript || "").trim();
}

async function transcribeAudio(audioPath: string, jobDir: string) {
  const outText = path.join(jobDir, "transcript.txt");
  const command = process.env.WHISPER_DUB_COMMAND || process.env.FASTER_WHISPER_COMMAND || "";
  if (command.trim()) {
    await runCommand(command, { audio: audioPath, input: audioPath, output: outText, outDir: jobDir }, jobDir);
    if (fs.existsSync(outText)) return (await fsp.readFile(outText, "utf8")).trim();
  }

  const transcript = await postAudioToWhisperService(audioPath);
  if (transcript) {
    await fsp.writeFile(outText, transcript, "utf8");
    return transcript;
  }
  throw new Error("Missing transcript. Whisper returned empty text. Type transcript text manually or use clearer source audio.");
}

async function synthesizeXtts(text: string, speakerWav: string, outWav: string) {
  const command = process.env.XTTS_VIDEO_DUB_COMMAND || process.env.XTTS_TTS_COMMAND || "";
  const values = { text, speaker: speakerWav, voice: speakerWav, output: outWav, language: process.env.XTTS_LANGUAGE || "en" };
  if (command.trim()) {
    await runCommand(command, values, VOICES_ROOT);
  } else {
    const xttsPython = path.join(VOICES_ROOT, "XTTS", "venv", "Scripts", "python.exe");
    const python = fs.existsSync(xttsPython) ? xttsPython : "python";
    await runCommand(`"${python}" -m TTS.bin.synthesize --model_name tts_models/multilingual/multi-dataset/xtts_v2 --text "{text}" --speaker_wav "{speaker}" --language_idx {language} --out_path "{output}"`, values, VOICES_ROOT);
  }
  if (!fs.existsSync(outWav) || fs.statSync(outWav).size <= 0) throw new Error("XTTS finished without writing dubbed speech output.");
}

// OTG_QWEN3_FASTAPI_SYNTHESIZE_BRIDGE_V12
async function synthesizeQwen3(text: string, speakerWav: string, outWav: string) {
  const command = process.env.QWEN3_VIDEO_DUB_COMMAND || process.env.QWEN3_TTS_DUB_COMMAND || process.env.QWEN3_TTS_COMMAND || "";
  const values = {
    text,
    speaker: speakerWav,
    voice: speakerWav,
    reference: speakerWav,
    output: outWav,
    language: process.env.QWEN3_TTS_LANGUAGE || process.env.XTTS_LANGUAGE || "en",
  };

  if (command.trim()) {
    await runCommand(command, values, path.join(VOICES_ROOT, "qwen 3"));
  } else {
    const serviceUrl = String(process.env.QWEN3_TTS_URL || "http://127.0.0.1:7863").replace(/\/+$/, "");
    let response: Response;
    try {
      const body = new URLSearchParams();
      body.set("text", text);
      body.set("speaker_path", speakerWav);
      body.set("reference_path", speakerWav);
      body.set("output_path", outWav);
      body.set("language", values.language);
      response = await fetch(`${serviceUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error: any) {
      throw new Error(`Qwen3-TTS service is not reachable. Start C:\AI\OTG-Test2\scripts\voice\run_qwen3_tts_api.bat at ${serviceUrl} or set QWEN3_TTS_COMMAND. ${error?.message || ""}`.trim());
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Qwen3-TTS service failed with HTTP ${response.status}.`);
    }
  }

  if (!fs.existsSync(outWav) || fs.statSync(outWav).size <= 0) throw new Error("Qwen3-TTS finished without writing dubbed speech output.");
}

async function synthesizeSpeech(engine: TtsEngine, text: string, speakerWav: string, outWav: string) {
  if (engine === "qwen3") return synthesizeQwen3(text, speakerWav, outWav);
  return synthesizeXtts(text, speakerWav, outWav);
}

function uniqueTargetPath(dir: string, desiredName: string) {
  const ext = path.extname(desiredName) || ".mp4";
  const stem = path.basename(desiredName, ext) || "xtts_video_dub";
  let candidate = path.join(dir, `${stem}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

async function handleSave(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const jobId = String(body?.jobId || "").trim();
  const fileName = path.basename(String(body?.fileName || "tts_video_dub.mp4"));
  const title = cleanTitle(String(body?.title || "tts_video_dub"));
  const ttsEngine = normalizeTtsEngine(String(body?.ttsEngine || body?.tts_engine || "xtts"));
  if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" }, { status: 400 });
  const { owner, sources } = await getGallerySourcesForRequest(req);
  const sourcePath = safeJoin(jobRoot(owner.ownerKey), jobId, fileName);
  if (!fs.existsSync(sourcePath)) return NextResponse.json({ ok: false, error: "dubbed video not found" }, { status: 404 });
  const targetSource = sources[0];
  const targetPath = uniqueTargetPath(targetSource.dir, `${safeGalleryName(title)}.mp4`);
  await fsp.copyFile(sourcePath, targetPath);
  const stat = fs.statSync(targetPath);
  const savedName = path.basename(targetPath);
  const meta = writeMetaForFile(targetPath, {
    originalName: savedName,
    renamedName: savedName,
    sourceType: `edit-video-${ttsEngine}-dub-voice`,
    requestKind: `edit-video-${ttsEngine}-dub-voice`,
    mediaCategory: "edited-video",
    workflowId: `edit-video/dub-voice/${ttsEngine}-v1`,
    workflowTitle: `Edit Video - Voice Dubbing - ${ttsEngineLabel(ttsEngine)} Video Dub`,
    submitPayload: { requestKind: `edit-video-${ttsEngine}-dub-voice`, sourceJobId: jobId, title, ttsEngine },
    ownerKey: targetSource.ownerKey,
    username: targetSource.username,
    deviceId: targetSource.deviceId,
    createdAt: stat.birthtimeMs || stat.mtimeMs || Date.now(),
    updatedAt: Date.now(),
  }, targetSource);
  return NextResponse.json({ ok: true, fileName: savedName, name: savedName, source: targetSource.scope, url: `/api/gallery/file?name=${encodeURIComponent(savedName)}&scope=${targetSource.scope}`, meta });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const url = new URL(req.url);
    const jobId = safeSegment(url.searchParams.get("jobId") || "");
    const name = path.basename(url.searchParams.get("name") || "");
    if (!jobId || !name) return NextResponse.json({ ok: false, error: "missing jobId or name" }, { status: 400 });
    const filePath = safeJoin(jobRoot(owner.ownerKey), jobId, name);
    if (!fs.existsSync(filePath)) return NextResponse.json({ ok: false, error: "file not found" }, { status: 404 });
    const data = await fsp.readFile(filePath);
    return new NextResponse(data, { headers: { "Content-Type": "video/mp4", "Content-Length": String(data.length), "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "file read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return await handleSave(req);

    const owner = await getOwnerContext(req);
    const form = await req.formData();
    const video = form.get("video");
    const uploadedVoice = form.get("voice_upload");
    if (!(video instanceof File) || video.size <= 0) return NextResponse.json({ ok: false, error: "video is required." }, { status: 400 });
    if (!VIDEO_EXT_RE.test(video.name)) return NextResponse.json({ ok: false, error: "Select an MP4/WEBM/MOV/MKV video." }, { status: 400 });

    const ttsEngine = normalizeTtsEngine(String(form.get("tts_engine") || form.get("ttsEngine") || "xtts"));
    const engineLabel = ttsEngineLabel(ttsEngine);
    const title = cleanTitle(String(form.get("title") || `${ttsEngine}_video_dub`));
    const mode = (String(form.get("mode") || "replace") === "overlay" ? "overlay" : "replace") as DubMode;
    const manualTranscript = String(form.get("transcript") || "").trim();
    const voicePathRaw = String(form.get("voice_path") || "").trim();

    const root = jobRoot(owner.ownerKey);
    ensureDir(root);
    const jobId = `${ttsEngine}-dub-${Date.now()}`;
    const jobDir = safeJoin(root, jobId);
    ensureDir(jobDir);

    const videoPath = safeJoin(jobDir, `source${path.extname(video.name).toLowerCase() || ".mp4"}`);
    const sourceAudio = safeJoin(jobDir, "source_audio.wav");
    const generatedVoice = safeJoin(jobDir, `${ttsEngine}_voice.wav`);
    const mixedAudio = safeJoin(jobDir, "final_audio.m4a");
    const outputPath = safeJoin(jobDir, `${title}.mp4`);
    await saveUpload(video, videoPath);

    let speakerPath = "";
    if (uploadedVoice instanceof File && uploadedVoice.size > 0) {
      if (!AUDIO_EXT_RE.test(uploadedVoice.name)) return NextResponse.json({ ok: false, error: "Uploaded voice sample must be audio." }, { status: 400 });
      speakerPath = safeJoin(jobDir, `speaker${path.extname(uploadedVoice.name).toLowerCase() || ".wav"}`);
      await saveUpload(uploadedVoice, speakerPath);
    } else {
      speakerPath = validateVoicePath(voicePathRaw);
    }

    await runFfmpeg(["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "24000", sourceAudio]);
    const transcript = manualTranscript || await transcribeAudio(sourceAudio, jobDir);
    if (!transcript) throw new Error("Transcript is empty. Type transcript text or configure Whisper.");

    await synthesizeSpeech(ttsEngine, transcript, speakerPath, generatedVoice);

    if (mode === "overlay") {
      await runFfmpeg(["-y", "-i", sourceAudio, "-i", generatedVoice, "-filter_complex", "[0:a]volume=0.25[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0", "-c:a", "aac", "-b:a", "192k", mixedAudio]);
    } else {
      await runFfmpeg(["-y", "-i", generatedVoice, "-c:a", "aac", "-b:a", "192k", mixedAudio]);
    }
    await runFfmpeg(["-y", "-i", videoPath, "-i", mixedAudio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", outputPath]);

    const stat = fs.statSync(outputPath);
    await fsp.writeFile(`${outputPath}.meta.json`, JSON.stringify({
      type: `edit-video-${ttsEngine}-dub-voice-job`,
      operation: `${ttsEngine}-video-dub`,
      mode,
      transcript,
      speakerPath,
      sourceVideoName: video.name,
      outputFileName: path.basename(outputPath),
      ttsEngine,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    }, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      jobId,
      fileName: path.basename(outputPath),
      url: `/api/edit-video/dub-voice?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(path.basename(outputPath))}`,
      transcript,
      mode,
      ttsEngine,
      sizeBytes: stat.size,
      message: `${engineLabel} video dub is ready.`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "TTS video dubbing failed" }, { status: 500 });
  }
}
