import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type VoiceFxAdapterResult = {
  sourceSamplePath: string;
  processedSamplePath: string;
  processedSampleUrl: string;
  fxPreset: string;
  adapter: "voice_fx";
  mock: false;
  outputDir: string;
  logsPath: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitCode: number;
  outputBytes: number;
};

type VoiceFxPlan = {
  enabled: boolean;
  ffmpeg: string;
  timeoutMs: number;
  sourceSamplePath: string;
  processedSamplePath: string;
  processedSampleUrl: string;
  outputDir: string;
  logsPath: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  fxPreset: string;
};

export type VoiceFxRunEvent = {
  phase: "process_start" | "process_exit";
  message: string;
  exitCode?: number | null;
};

export function isRealVoiceFxEnabled(): boolean {
  return process.env.OTG_ENABLE_REAL_VOICE_FX === "1";
}

export function isVoiceFxJob(job: QueuedContractJob): boolean {
  return job.jobType === "character_voice_pipeline" && job.action === "apply_voice_fx";
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function fileUrlFor(ownerKey: string, characterId: string, jobId: string, fileName: "sample.wav" | "fx.wav"): string {
  return `/api/characters/voice-sample/file?owner=${encodeURIComponent(ownerKey)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(fileName)}`;
}

function parseVoiceSampleUrl(value: string): { owner: string; characterId: string; jobId: string; fileName: "sample.wav" | "fx.wav" } | null {
  if (!value.startsWith("/api/characters/voice-sample/file")) return null;
  const url = new URL(value, "http://localhost");
  const fileName = url.searchParams.get("file") === "fx.wav" ? "fx.wav" : "sample.wav";
  return {
    owner: cleanString(url.searchParams.get("owner")),
    characterId: cleanString(url.searchParams.get("characterId")),
    jobId: cleanString(url.searchParams.get("jobId")),
    fileName,
  };
}

async function firstExistingPath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isFile()) return candidate;
  }
  return "";
}

async function resolveSourceSamplePath(ownerKey: string, job: QueuedContractJob): Promise<string> {
  const characterSegment = safeSegment(job.characterId || "character");
  const rawCandidates = [
    cleanString(job.input?.sourceSamplePath),
    cleanString(job.input?.inputPath),
    cleanString(job.input?.rawVoicePreviewPath),
    cleanString(job.input?.baseSampleUrl),
    cleanString(job.input?.sampleUrl),
  ].filter(Boolean);

  const pathCandidates: string[] = [];
  for (const raw of rawCandidates) {
    const voiceSample = parseVoiceSampleUrl(raw);
    if (voiceSample?.owner && voiceSample.characterId && voiceSample.jobId) {
      pathCandidates.push(path.join(OTG_DATA_ROOT, "characters", safeSegment(voiceSample.owner), "voice-samples", safeSegment(voiceSample.characterId), safeSegment(voiceSample.jobId), voiceSample.fileName));
      continue;
    }
    if (path.isAbsolute(raw)) {
      pathCandidates.push(path.resolve(raw));
      continue;
    }
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      pathCandidates.push(path.resolve(process.cwd(), raw));
    }
  }

  const sourceJobId = cleanString(job.input?.sourceJobId || job.input?.sourceSampleJobId || job.input?.baseSampleJobId);
  if (sourceJobId) {
    pathCandidates.push(path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey || "local"), "voice-samples", characterSegment, safeSegment(sourceJobId), "sample.wav"));
  }

  const found = await firstExistingPath(pathCandidates);
  if (!found) {
    throw new Error("Voice FX source sample not found. Provide inputPath, sourceSamplePath, sampleUrl, or sourceJobId for an existing WAV.");
  }
  return found;
}

export async function resolveVoiceFxPlan(ownerKey: string, job: QueuedContractJob): Promise<VoiceFxPlan> {
  const ownerSegment = safeSegment(ownerKey || "local");
  const characterSegment = safeSegment(job.characterId || "character");
  const jobSegment = safeSegment(job.jobId);
  const outputDir = path.join(OTG_DATA_ROOT, "characters", ownerSegment, "voice-samples", characterSegment, jobSegment);
  const logsPath = path.join(outputDir, "logs");
  return {
    enabled: isRealVoiceFxEnabled(),
    ffmpeg: cleanString(process.env.VOICE_FX_FFMPEG || process.env.FFMPEG_PATH || "ffmpeg"),
    timeoutMs: Math.max(30_000, Number(process.env.VOICE_FX_TIMEOUT_MS || 5 * 60 * 1000)),
    sourceSamplePath: await resolveSourceSamplePath(ownerKey, job),
    processedSamplePath: path.join(outputDir, "fx.wav"),
    processedSampleUrl: fileUrlFor(ownerSegment, characterSegment, jobSegment, "fx.wav"),
    outputDir,
    logsPath,
    paramsPath: path.join(logsPath, "voice_fx_params.json"),
    stdoutPath: path.join(logsPath, "voice_fx_stdout.log"),
    stderrPath: path.join(logsPath, "voice_fx_stderr.log"),
    fxPreset: cleanString(job.input?.fxPreset || job.input?.preset || "custom"),
  };
}

async function requireFfmpeg(ffmpeg: string): Promise<void> {
  if (!ffmpeg) throw new Error("VOICE_FX_FFMPEG is required for real Voice FX processing.");
  if (!path.isAbsolute(ffmpeg)) return;
  const stat = await fs.stat(ffmpeg).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Voice FX ffmpeg not found: ${ffmpeg}`);
}

function atempoFilters(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters;
}

function buildAudioFilters(job: QueuedContractJob): string {
  const speed = numberInRange(job.input?.speed, 1, 0.5, 2);
  const gainDb = numberInRange(job.input?.gainDb, 0, -24, 24);
  const highpassHz = numberInRange(job.input?.highpassHz, 0, 0, 4000);
  const lowpassHz = numberInRange(job.input?.lowpassHz, 0, 0, 20000);
  const pitchSemitones = numberInRange(job.input?.pitchSemitones, 0, -12, 12);
  const normalize = boolValue(job.input?.normalize, true);
  const filters: string[] = ["aformat=channel_layouts=mono"];

  if (gainDb !== 0) filters.push(`volume=${gainDb.toFixed(2)}dB`);
  if (highpassHz > 0) filters.push(`highpass=f=${Math.round(highpassHz)}`);
  if (lowpassHz > 0) filters.push(`lowpass=f=${Math.round(lowpassHz)}`);
  if (pitchSemitones !== 0) {
    const factor = Math.pow(2, pitchSemitones / 12);
    filters.push(`asetrate=24000*${factor.toFixed(6)}`, "aresample=24000");
    filters.push(...atempoFilters(1 / factor));
  }
  if (speed !== 1) filters.push(...atempoFilters(speed));
  if (normalize) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

  return filters.join(",");
}

function runFfmpeg(plan: VoiceFxPlan, filters: string, onEvent?: (event: VoiceFxRunEvent) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    onEvent?.({
      phase: "process_start",
      message: `Voice FX ffmpeg start. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
    });
    const stdout = createWriteStream(plan.stdoutPath, { flags: "a" });
    const stderr = createWriteStream(plan.stderrPath, { flags: "a" });
    const child = spawn(
      plan.ffmpeg,
      ["-y", "-i", plan.sourceSamplePath, "-vn", "-af", filters, "-ar", "24000", "-ac", "1", plan.processedSamplePath],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore timeout cleanup failures
      }
      reject(new Error("Voice FX processing timed out."));
    }, plan.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      stdout.end();
      stderr.end();
      onEvent?.({
        phase: "process_exit",
        message: `Voice FX ffmpeg exit code ${code ?? "null"}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
        exitCode: code,
      });
      if (code === 0) {
        resolve(0);
        return;
      }

      const stderrText = await fs.readFile(plan.stderrPath, "utf8").catch(() => "");
      reject(new Error((`Voice FX ffmpeg failed with exit code ${code}.\n${stderrText}`).trim()));
    });
  });
}

export async function applyVoiceFx(
  ownerKey: string,
  job: QueuedContractJob,
  options: { onEvent?: (event: VoiceFxRunEvent) => void } = {},
): Promise<VoiceFxAdapterResult> {
  const plan = await resolveVoiceFxPlan(ownerKey, job);
  if (!plan.enabled) throw new Error("Real Voice FX processing is disabled. Set OTG_ENABLE_REAL_VOICE_FX=1.");
  await requireFfmpeg(plan.ffmpeg);

  ensureDir(plan.logsPath);
  const filters = buildAudioFilters(job);
  await fs.writeFile(
    plan.paramsPath,
    JSON.stringify(
      {
        engine: "ffmpeg",
        adapter: "voice_fx",
        ffmpeg: plan.ffmpeg,
        sourceSamplePath: plan.sourceSamplePath,
        processedSamplePath: plan.processedSamplePath,
        filters,
        fxPreset: plan.fxPreset,
        input: job.input,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fs.writeFile(plan.stdoutPath, "", "utf8");
  await fs.writeFile(plan.stderrPath, "", "utf8");

  const testMode = process.env.NODE_ENV === "test" ? cleanString(process.env.OTG_VOICE_FX_TEST_MODE) : "";
  let exitCode = 0;
  if (testMode === "success") {
    options.onEvent?.({ phase: "process_start", message: `Voice FX ffmpeg start. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}` });
    await fs.copyFile(plan.sourceSamplePath, plan.processedSamplePath);
    await fs.writeFile(plan.stdoutPath, JSON.stringify({ ok: true, testMode: true }) + "\n", "utf8");
    options.onEvent?.({ phase: "process_exit", message: `Voice FX ffmpeg exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`, exitCode: 0 });
  } else {
    exitCode = await runFfmpeg(plan, filters, options.onEvent);
  }

  const stat = await fs.stat(plan.processedSamplePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Voice FX finished without writing processed WAV: ${plan.processedSamplePath}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }

  return {
    sourceSamplePath: plan.sourceSamplePath,
    processedSamplePath: plan.processedSamplePath,
    processedSampleUrl: plan.processedSampleUrl,
    fxPreset: plan.fxPreset,
    adapter: "voice_fx",
    mock: false,
    outputDir: plan.outputDir,
    logsPath: plan.logsPath,
    paramsPath: plan.paramsPath,
    stdoutPath: plan.stdoutPath,
    stderrPath: plan.stderrPath,
    exitCode,
    outputBytes: stat.size,
  };
}
