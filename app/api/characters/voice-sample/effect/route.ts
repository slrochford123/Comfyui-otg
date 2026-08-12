/* OTG_VOICE_EFFECTS_BACKEND_P1 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { findVoiceEffectPreset, isVoiceEffectIntensity, type VoiceEffectIntensity } from "@/lib/characters/voiceEffectPresets";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { getOwnerContext } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupportedProvider = "qwen3" | "cosy" | "ltx" | "unnatural_ltx" | "uploaded";
/* OTG_VOICE_EFFECTS_BACKEND_P3B */
type VoiceEffectEngine = "ffmpeg" | "pedalboard" | "sox";

const PEDALBOARD_PRESET_IDS = new Set([
  "pedalboard_studio",
  "pedalboard_distortion",
  "pedalboard_phaser",
  "pedalboard_chorus",
  "pedalboard_delay",
  "pedalboard_reverb",
  "pedalboard_pitch_shift",
  "pedalboard_plugin_chain",
  "pedalboard_vst3_presets",
]);

const SOX_PRESET_IDS = new Set([
  "sox_synthwave",
  "sox_chip",
  "sox_overdrive",
  "sox_echo_filtering",
  "sox_max_conversion",
]);

function resolveEffectEngine(effectId: string, requested: unknown): VoiceEffectEngine {
  const explicit = String(requested || "").trim().toLowerCase();
  if (explicit === "pedalboard" || PEDALBOARD_PRESET_IDS.has(effectId)) return "pedalboard";
  if (explicit === "sox" || SOX_PRESET_IDS.has(effectId)) return "sox";
  return "ffmpeg";
}

function resolvePythonPath() {
  return process.env.OTG_PYTHON_EXE || process.env.PYTHON_EXE || "python";
}

async function resolveSoxPath() {
  const candidates = [
    process.env.SOX_EXE,
    "C:\\Program Files (x86)\\sox-14-4-2\\sox.exe",
    "C:\\Program Files\\sox-14-4-2\\sox.exe",
    "sox",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "sox") return candidate;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // try next
    }
  }

  return "sox";
}

function soxArgsForPreset(preset: string, inputPath: string, outputPath: string) {
  const base = [inputPath, "-r", "48000", "-c", "1", outputPath];

  if (preset === "sox_synthwave") {
    return [
      ...base,
      "gain", "-n", "-3",
      "pitch", "-250",
      "chorus", "0.6", "0.8", "55", "0.35", "0.25", "2.0",
      "echo", "0.8", "0.45", "90", "0.25",
      "compand", "0.02,0.20", "6:-70,-60,-20", "-5", "-90", "0.2",
    ];
  }

  if (preset === "sox_chip") {
    return [
      ...base,
      "gain", "-n", "-4",
      "rate", "11025",
      "rate", "48000",
      "pitch", "450",
      "overdrive", "8", "18",
      "compand", "0.01,0.12", "6:-70,-55,-18", "-6", "-90", "0.2",
    ];
  }

  if (preset === "sox_overdrive") {
    return [
      ...base,
      "gain", "-n", "-6",
      "overdrive", "22", "18",
      "bass", "+3",
      "treble", "+2",
      "compand", "0.02,0.18", "6:-70,-58,-16", "-5", "-90", "0.2",
    ];
  }

  if (preset === "sox_echo_filtering") {
    return [
      ...base,
      "highpass", "220",
      "lowpass", "4200",
      "echo", "0.8", "0.42", "120", "0.28",
      "echo", "0.8", "0.25", "240", "0.18",
      "gain", "-n", "-3",
    ];
  }

  if (preset === "sox_max_conversion") {
    return [
      ...base,
      "gain", "-n", "-2",
      "highpass", "80",
      "lowpass", "12000",
      "compand", "0.02,0.20", "6:-70,-60,-18", "-5", "-90", "0.2",
      "norm", "-1",
    ];
  }

  throw new Error(`Unsupported SoX preset: ${preset}`);
}

async function convertToWorkingWav(inputPath: string, outputPath: string) {
  const ffmpeg = resolveFfmpegPath();
  const result = await runCmd(ffmpeg, [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    "-vn",
    "-ar",
    "48000",
    "-ac",
    "1",
    outputPath,
  ], { timeoutMs: 5 * 60 * 1000 });

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "ffmpeg conversion failed").slice(0, 2000));
  }

  if (!(await fileExists(outputPath))) {
    throw new Error("ffmpeg conversion completed but did not create working WAV.");
  }
}


function jsonError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { ok: false, error, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function safeSegment(value: unknown, fallback = "") {
  const text = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return text || fallback;
}

function isBlockedOwner(value: string) {
  return !value || value === "profile_unresolved" || value === "web_characters_builder";
}

function isSupportedProvider(value: unknown): value is SupportedProvider {
  return value === "qwen3" || value === "cosy" || value === "ltx" || value === "unnatural_ltx" || value === "uploaded";
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function resolveDataFilePath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false as const, error: "Missing samplePath." };
  if (/^(https?:|blob:|data:)/i.test(raw)) {
    return { ok: false as const, error: "Remote, blob, and data URLs are not accepted for voice effects." };
  }

  const dataRoot = path.resolve(OTG_DATA_ROOT);
  const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(dataRoot, raw));
  const dataRootWithSep = dataRoot.endsWith(path.sep) ? dataRoot : dataRoot + path.sep;

  if (resolved !== dataRoot && !resolved.startsWith(dataRootWithSep)) {
    return { ok: false as const, error: "samplePath must be under the project data folder." };
  }

  return { ok: true as const, path: resolved };
}

function effectFileUrl(audioPath: string) {
  return `/api/file?path=${encodeURIComponent(audioPath)}`;
}

/* OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_CONTROLS */
function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function atempoChain(factor: number) {
  const parts: string[] = [];
  let remaining = factor;

  while (remaining > 2) {
    parts.push("atempo=2");
    remaining /= 2;
  }

  while (remaining < 0.5) {
    parts.push("atempo=0.5");
    remaining /= 0.5;
  }

  parts.push(`atempo=${remaining.toFixed(6)}`);
  return parts;
}

function buildCustomFfmpegFilter(rawControls: unknown) {
  if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls)) return "";

  const controls = rawControls as Record<string, unknown>;
  const parts: string[] = [];

  const pitchSemitones = clampNumber(controls.pitchSemitones, -12, 12, 0);
  const grit = clampNumber(controls.grit, 0, 100, 0);
  const echoDelayMs = clampNumber(controls.echoDelayMs, 0, 900, 0);
  const echoDecay = clampNumber(controls.echoDecay, 0, 0.9, 0);
  const tremoloRate = clampNumber(controls.tremoloRate, 0, 40, 0);
  const tremoloDepth = clampNumber(controls.tremoloDepth, 0, 1, 0);
  const vibratoRate = clampNumber(controls.vibratoRate, 0, 15, 0);
  const vibratoDepth = clampNumber(controls.vibratoDepth, 0, 1, 0);
  const chorusMix = clampNumber(controls.chorusMix, 0, 1, 0);
  const highpassHz = clampNumber(controls.highpassHz, 20, 1200, 80);
  const lowpassHz = clampNumber(controls.lowpassHz, 1200, 20000, 12000);
  const gainDb = clampNumber(controls.gainDb, -12, 12, 0);
  const compression = clampNumber(controls.compression, 0, 100, 30);

  if (Math.abs(pitchSemitones) >= 0.05) {
    const rateFactor = Math.pow(2, pitchSemitones / 12);
    const inverseTempo = 1 / rateFactor;
    parts.push(`asetrate=48000*${rateFactor.toFixed(6)}`);
    parts.push("aresample=48000");
    parts.push(...atempoChain(inverseTempo));
  }

  if (highpassHz > 20) parts.push(`highpass=f=${Math.round(highpassHz)}`);
  if (lowpassHz < 20000) parts.push(`lowpass=f=${Math.round(lowpassHz)}`);

  if (grit > 0) {
    const bits = Math.round(16 - (grit / 100) * 10);
    const mix = Math.min(0.65, grit / 130).toFixed(3);
    parts.push(`acrusher=bits=${bits}:mix=${mix}`);
  }

  if (echoDelayMs > 0 && echoDecay > 0) {
    const decay = echoDecay.toFixed(3);
    parts.push(`aecho=0.8:0.45:${Math.round(echoDelayMs)}:${decay}`);
  }

  if (tremoloRate > 0 && tremoloDepth > 0) {
    parts.push(`tremolo=f=${tremoloRate.toFixed(3)}:d=${tremoloDepth.toFixed(3)}`);
  }

  if (vibratoRate > 0 && vibratoDepth > 0) {
    parts.push(`vibrato=f=${vibratoRate.toFixed(3)}:d=${vibratoDepth.toFixed(3)}`);
  }

  if (chorusMix > 0) {
    const mix = chorusMix.toFixed(3);
    parts.push(`chorus=0.45:0.65:40|55:0.22|0.18:${mix}|${mix}:1.4|1.8`);
  }

  if (compression > 0) {
    const ratio = (1.5 + (compression / 100) * 3.5).toFixed(2);
    parts.push(`acompressor=threshold=0.14:ratio=${ratio}`);
  }

  if (Math.abs(gainDb) >= 0.1) {
    parts.push(`volume=${gainDb.toFixed(2)}dB`);
  }

  parts.push("loudnorm=I=-16:TP=-1.5:LRA=10");
  return parts.join(",");
}
function ffmpegArgs(inputPath: string, outputPath: string, filter: string) {
  return [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    "-vn",
    "-af",
    filter,
    "-ar",
    "48000",
    "-ac",
    "1",
    outputPath,
  ];
}

async function processVoiceEffect(args: {
  inputPath: string;
  outputPath: string;
  filter: string;
}) {
  const started = Date.now();
  const ffmpeg = resolveFfmpegPath();
  const result = await runCmd(ffmpeg, ffmpegArgs(args.inputPath, args.outputPath, args.filter), {
    timeoutMs: 5 * 60 * 1000,
  });
  const elapsedMs = Date.now() - started;

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "ffmpeg failed").slice(0, 2000));
  }

  if (!(await fileExists(args.outputPath))) {
    throw new Error("ffmpeg completed but did not create output audio.");
  }

  return { engine: "ffmpeg", elapsedMs };
}
/* OTG_VOICE_EFFECTS_3C2_ROUTE_CONTROLS */
function serializeEffectControls(rawControls: unknown) {
  if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls)) return "";
  return JSON.stringify(rawControls);
}

function soxArgsForCustomControls(rawControls: unknown, inputPath: string, outputPath: string) {
  if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls)) return null;

  const controls = rawControls as Record<string, unknown>;
  const base = [inputPath, "-r", "48000", "-c", "1", outputPath];
  const effects: string[] = [];

  const pitchCents = Math.round(clampNumber(controls.pitchCents, -1200, 1200, 0));
  const tempo = clampNumber(controls.tempo, 0.5, 2, 1);
  const overdriveGain = clampNumber(controls.overdriveGain, 0, 40, 0);
  const overdriveColour = clampNumber(controls.overdriveColour, 0, 100, 20);
  const echoDelayMs = Math.round(clampNumber(controls.echoDelayMs, 0, 900, 0));
  const echoDecay = clampNumber(controls.echoDecay, 0, 0.9, 0);
  const highpassHz = Math.round(clampNumber(controls.highpassHz, 20, 1200, 80));
  const lowpassHz = Math.round(clampNumber(controls.lowpassHz, 1200, 20000, 12000));
  const chorusDelayMs = clampNumber(controls.chorusDelayMs, 0, 120, 0);
  const chorusDecay = clampNumber(controls.chorusDecay, 0, 1, 0);
  const bassDb = clampNumber(controls.bassDb, -12, 12, 0);
  const trebleDb = clampNumber(controls.trebleDb, -12, 12, 0);
  const gainDb = clampNumber(controls.gainDb, -12, 12, 0);
  const normalize = Boolean(controls.normalize);

  if (highpassHz > 20) effects.push("highpass", String(highpassHz));
  if (lowpassHz < 20000) effects.push("lowpass", String(lowpassHz));
  if (pitchCents !== 0) effects.push("pitch", String(pitchCents));
  if (Math.abs(tempo - 1) >= 0.01) effects.push("tempo", tempo.toFixed(3));
  if (overdriveGain > 0) effects.push("overdrive", overdriveGain.toFixed(1), overdriveColour.toFixed(1));
  if (echoDelayMs > 0 && echoDecay > 0) effects.push("echo", "0.8", "0.45", String(echoDelayMs), echoDecay.toFixed(3));
  if (chorusDelayMs > 0 && chorusDecay > 0) {
    effects.push("chorus", "0.6", "0.8", chorusDelayMs.toFixed(1), chorusDecay.toFixed(3), "0.25", "2.0");
  }
  if (Math.abs(bassDb) >= 0.1) effects.push("bass", bassDb.toFixed(1));
  if (Math.abs(trebleDb) >= 0.1) effects.push("treble", trebleDb.toFixed(1));
  if (Math.abs(gainDb) >= 0.1) effects.push("gain", gainDb.toFixed(1));
  if (normalize) effects.push("norm", "-1");

  if (!effects.length) return null;
  return [...base, ...effects];
}
async function processPedalboardEffect(args: {
  inputPath: string;
  outputPath: string;
  preset: string;
  workDir: string;
  controls?: unknown;
}) {
  const started = Date.now();
  const workingInput = path.join(args.workDir, "pedalboard-input.wav");
  await convertToWorkingWav(args.inputPath, workingInput);

  const python = resolvePythonPath();
  const scriptPath = path.join(process.cwd(), "scripts", "process_pedalboard_voice_fx.py");
  const result = await runCmd(python, [
    scriptPath,
    "--input",
    workingInput,
    "--output",
    args.outputPath,
    "--preset",
    args.preset,
    "--controls",
    serializeEffectControls(args.controls),
  ], { timeoutMs: 5 * 60 * 1000 });

  const elapsedMs = Date.now() - started;

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "pedalboard failed").slice(0, 2000));
  }

  if (!(await fileExists(args.outputPath))) {
    throw new Error("Pedalboard completed but did not create output audio.");
  }

  return { engine: "pedalboard", elapsedMs };
}

async function processSoxEffect(args: {
  inputPath: string;
  outputPath: string;
  preset: string;
  workDir: string;
  controls?: unknown;
}) {
  const started = Date.now();
  const workingInput = path.join(args.workDir, "sox-input.wav");
  await convertToWorkingWav(args.inputPath, workingInput);

  const sox = await resolveSoxPath();
  const customSoxArgs = soxArgsForCustomControls(args.controls, workingInput, args.outputPath);
  const result = await runCmd(sox, customSoxArgs || soxArgsForPreset(args.preset, workingInput, args.outputPath), {
    timeoutMs: 5 * 60 * 1000,
  });

  const elapsedMs = Date.now() - started;

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "sox failed").slice(0, 2000));
  }

  if (!(await fileExists(args.outputPath))) {
    throw new Error("SoX completed but did not create output audio.");
  }

  return { engine: "sox", elapsedMs };
}

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonError("Missing JSON body.");

    const owner = await getOwnerContext(req);
    const ownerKey = safeSegment(owner.ownerKey);
    if (isBlockedOwner(ownerKey)) {
      return jsonError("Resolved owner is not allowed to process voice effects.", 409);
    }

    const provider = String(body.provider || "").trim();
    if (!provider) return jsonError("Missing required field: provider", 400);
    if (!isSupportedProvider(provider)) {
      return jsonError("Unsupported voice provider for voice effects.", 400);
    }

    const effectId = String(body.effectId || "").trim();
    if (!effectId) return jsonError("Missing required field: effectId", 400);

    const engine = resolveEffectEngine(effectId, body.engine || body.effectEngine);
    const preset = engine === "ffmpeg" ? findVoiceEffectPreset(effectId) : null;
    const customVoiceTuning = engine === "ffmpeg" && effectId === "custom_voice_tuning";

    if (engine === "ffmpeg" && !preset && !customVoiceTuning) return jsonError("Unknown FFmpeg voice effect preset.", 404);
    if (engine === "pedalboard" && !PEDALBOARD_PRESET_IDS.has(effectId)) return jsonError("Unknown Pedalboard voice effect preset.", 404);
    if (engine === "sox" && !SOX_PRESET_IDS.has(effectId)) return jsonError("Unknown SoX voice effect preset.", 404);

    const intensityRaw = String(body.intensity || "medium").trim();
    const intensity: VoiceEffectIntensity = isVoiceEffectIntensity(intensityRaw) ? intensityRaw : "medium";
    const filter = preset?.filterByIntensity[intensity] || "";
    const customFfmpegFilter = engine === "ffmpeg" ? buildCustomFfmpegFilter(body.controls || body.customControls) : "";
    const effectiveFilter = customFfmpegFilter || filter;

    if (engine === "ffmpeg" && !effectiveFilter) return jsonError("Voice effect preset has no filter for this intensity.", 500);

    const resolvedInput = resolveDataFilePath(body.samplePath);
    if (!resolvedInput.ok) return jsonError(resolvedInput.error, 400);
    if (!(await fileExists(resolvedInput.path))) {
      return jsonError("Input voice sample file does not exist.", 404);
    }

    const characterId = safeSegment(body.characterId, "character");
    const jobId = safeSegment(body.jobId, "manual");
    const effectRunId = `${Date.now()}-${effectId}-${intensity}`;
    const outputDir = safeJoin(OTG_DATA_ROOT, "characters", ownerKey, "voice-effects", characterId, jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const outputFileName = `voice-effect-${safeSegment(effectId)}-${safeSegment(intensity)}-${effectRunId}.wav`;
    const outputPath = safeJoin(outputDir, outputFileName);
    const workDir = safeJoin(outputDir, `.work-${safeSegment(effectRunId)}`);
    await fs.mkdir(workDir, { recursive: true });

    const method =
      engine === "pedalboard"
        ? await processPedalboardEffect({
            inputPath: resolvedInput.path,
            outputPath,
            preset: effectId,
            workDir,
            controls: body.controls || body.customControls,
          })
        : engine === "sox"
          ? await processSoxEffect({
              inputPath: resolvedInput.path,
              outputPath,
              preset: effectId,
              workDir,
            })
          : await processVoiceEffect({
              inputPath: resolvedInput.path,
              outputPath,
              filter: effectiveFilter,
            });

    const audioUrl = effectFileUrl(outputPath);

    console.info("[OTG_VOICE_EFFECTS_BACKEND_P1]", {
      provider,
      effectId,
      intensity,
      category: customVoiceTuning ? "Custom" : preset?.category || engine,
      inputPath: resolvedInput.path,
      outputPath,
      engine: method.engine, customControls: Boolean(customFfmpegFilter),
      elapsedMs: method.elapsedMs,
    });

    return NextResponse.json({
      ok: true,
      provider,
      effectId,
      effectLabel: customVoiceTuning ? "Custom Voice Tuning" : preset?.label || safeSegment(effectId),
      category: customVoiceTuning ? "Custom" : preset?.category || engine,
      intensity,
      engine: method.engine, customControls: Boolean(customFfmpegFilter),
      audioPath: outputPath,
      audioUrl,
      elapsedMs: Date.now() - started,
      message: `Voice effect created: ${(customVoiceTuning ? "Custom Voice Tuning" : preset?.label || safeSegment(effectId))} (${intensity}).`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[OTG_VOICE_EFFECTS_BACKEND_P1] failed", { message });
    return jsonError("Voice effect failed. Original audio is still available.", 500, {
      detail: message.slice(0, 1000),
    });
  }
}