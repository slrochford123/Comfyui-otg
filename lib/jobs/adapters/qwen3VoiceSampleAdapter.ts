import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type Qwen3VoiceSampleAdapterResult = {
  samplePath: string;
  sampleUrl: string;
  provider: "qwen3";
  adapter: "qwen3";
  mock: false;
  outputDir: string;
  logsPath: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitCode: number;
  outputBytes: number;
};

export type Qwen3VoiceSamplePlan = {
  enabled: boolean;
  root: string;
  python: string;
  sitePackages: string;
  bridge: string;
  modelId: string;
  timeoutMs: number;
  outputDir: string;
  logsPath: string;
  samplePath: string;
  sampleUrl: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
};

export type Qwen3VoiceSampleRunEvent = {
  phase: "process_start" | "process_exit";
  message: string;
  exitCode?: number | null;
};

type Qwen3VoiceSampleConfig = {
  enabled: boolean;
  root: string;
  python: string;
  sitePackages: string;
  bridge: string;
  modelId: string;
  timeoutMs: number;
};

export function isRealQwen3VoiceSampleEnabled(): boolean {
  return process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE === "1";
}

export function isQwen3VoiceSampleJob(job: QueuedContractJob): boolean {
  return (
    job.jobType === "character_voice_pipeline" &&
    job.action === "create_voice_sample" &&
    job.input?.provider === "qwen3"
  );
}

function qwen3Config(): Qwen3VoiceSampleConfig {
  return {
    enabled: isRealQwen3VoiceSampleEnabled(),
    root: path.resolve(process.env.QWEN_TTS_ROOT || "C:\\AI\\voices\\qwen 3"),
    python: path.resolve(process.env.QWEN_TTS_PYTHON || "C:\\Users\\SLRoc\\miniconda3\\envs\\qwen3tts-repair\\python.exe"),
    sitePackages: path.resolve(process.env.QWEN_TTS_SITE_PACKAGES || "C:\\AI\\voices\\qwen 3\\qwen3tts-env\\Lib\\site-packages"),
    bridge: path.resolve(process.env.QWEN_TTS_BRIDGE || path.join(process.cwd(), "scripts", "qwen3_voice_design_preview.py")),
    modelId: String(process.env.QWEN_TTS_MODEL_ID || "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"),
    timeoutMs: Math.max(60_000, Number(process.env.QWEN_TTS_PREVIEW_TIMEOUT_MS || 10 * 60 * 1000)),
  };
}

export function resolveQwen3VoiceSamplePlan(ownerKey: string, job: QueuedContractJob): Qwen3VoiceSamplePlan {
  const config = qwen3Config();
  const ownerSegment = safeSegment(ownerKey || "local");
  const characterSegment = safeSegment(job.characterId || "character");
  const jobSegment = safeSegment(job.jobId);
  const outputDir = path.join(OTG_DATA_ROOT, "characters", ownerSegment, "voice-samples", characterSegment, jobSegment);
  const logsPath = path.join(outputDir, "logs");
  const samplePath = path.join(outputDir, "sample.wav");
  return {
    ...config,
    outputDir,
    logsPath,
    samplePath,
    sampleUrl: sampleUrlFor(ownerSegment, characterSegment, jobSegment),
    paramsPath: path.join(logsPath, "qwen3_sample_params.json"),
    stdoutPath: path.join(logsPath, "qwen3_sample_stdout.log"),
    stderrPath: path.join(logsPath, "qwen3_sample_stderr.log"),
  };
}

async function requireFile(filePath: string, label: string): Promise<void> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${label} not found: ${filePath}`);
}

async function requireDir(dirPath: string, label: string): Promise<void> {
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${dirPath}`);
}

function sampleUrlFor(ownerKey: string, characterId: string, jobId: string): string {
  return `/api/characters/voice-sample/file?owner=${encodeURIComponent(ownerKey)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(jobId)}`;
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function extractQwenInstruction(job: QueuedContractJob): string {
  const explicitInstruction = cleanString(job.input?.voiceInstruction);
  if (explicitInstruction) return explicitInstruction;

  const record = job.input?.qwenVoiceDesignRecord;
  if (record && typeof record === "object" && !Array.isArray(record)) {
    const candidate = record as Record<string, unknown>;
    return cleanString(candidate.voiceInstruction || candidate.fullQwenInstruction || candidate.baseInstruction);
  }
  return cleanString(job.input?.voiceInstruction || job.input?.prompt);
}

function sampleText(job: QueuedContractJob): string {
  return (
    cleanString(job.input?.sampleText) ||
    cleanString(job.input?.previewText) ||
    cleanString(job.input?.text) ||
    "This is a character voice sample for approval."
  );
}

function normalizeQwenLanguage(value: unknown): string {
  const raw = cleanString(value || "english").toLowerCase();
  const map: Record<string, string> = {
    en: "english",
    eng: "english",
    english: "english",
    zh: "chinese",
    cn: "chinese",
    chinese: "chinese",
    fr: "french",
    french: "french",
    de: "german",
    german: "german",
    it: "italian",
    italian: "italian",
    ja: "japanese",
    jp: "japanese",
    japanese: "japanese",
    ko: "korean",
    korean: "korean",
    pt: "portuguese",
    portuguese: "portuguese",
    ru: "russian",
    russian: "russian",
    es: "spanish",
    spanish: "spanish",
    auto: "auto",
  };
  return map[raw] || raw || "english";
}

function runQwenBridge(config: Qwen3VoiceSampleConfig, args: {
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  onEvent?: (event: Qwen3VoiceSampleRunEvent) => void;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    args.onEvent?.({
      phase: "process_start",
      message: `Qwen3 process start. stdout: ${args.stdoutPath}; stderr: ${args.stderrPath}`,
    });
    const child = spawn(
      config.python,
      [
        config.bridge,
        "--params-json",
        args.paramsPath,
        "--stdout-log",
        args.stdoutPath,
        "--stderr-log",
        args.stderrPath,
      ],
      {
        cwd: config.root,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PYTHONPATH: config.sitePackages,
          HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
        },
      },
    );

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore timeout cleanup failures
      }
      reject(new Error("Qwen3-TTS voice sample generation timed out."));
    }, config.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      args.onEvent?.({
        phase: "process_exit",
        message: `Qwen3 process exit code ${code ?? "null"}. stdout: ${args.stdoutPath}; stderr: ${args.stderrPath}`,
        exitCode: code,
      });
      if (code === 0) {
        resolve(0);
        return;
      }

      const stderr = await fs.readFile(args.stderrPath, "utf8").catch(() => "");
      const stdout = await fs.readFile(args.stdoutPath, "utf8").catch(() => "");
      reject(new Error((`Qwen3-TTS voice sample generation failed with exit code ${code}.\n${stderr}\n${stdout}`).trim()));
    });
  });
}

export async function generateQwen3VoiceSample(
  ownerKey: string,
  job: QueuedContractJob,
  options: { onEvent?: (event: Qwen3VoiceSampleRunEvent) => void } = {},
): Promise<Qwen3VoiceSampleAdapterResult> {
  const plan = resolveQwen3VoiceSamplePlan(ownerKey, job);
  if (!plan.enabled) throw new Error("Real Qwen3 voice sample generation is disabled. Set OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE=1.");

  await requireDir(plan.root, "Qwen3-TTS root");
  await requireFile(plan.python, "Qwen3-TTS Python");
  await requireDir(plan.sitePackages, "Qwen3-TTS site-packages");
  await requireFile(plan.bridge, "Qwen3-TTS bridge");

  ensureDir(plan.logsPath);

  const instruction = extractQwenInstruction(job) || "Create a clear, natural, plain neutral character voice. Keep pronunciation understandable.";
  const speechText = sampleText(job);

  await fs.writeFile(
    plan.paramsPath,
    JSON.stringify(
      {
        engine: "Qwen3-TTS VoiceDesign",
        model_id: plan.modelId,
        qwen_tts_root: plan.root,
        output_wav: plan.samplePath,
        text: speechText,
        sample_text: speechText,
        preview_text: cleanString(job.input?.previewText),
        language: normalizeQwenLanguage(job.input?.language || "english"),
        dtype: cleanString(job.input?.dtype || "float16"),
        qwen_instruction: instruction,
        voice_instruction: instruction,
        voice_design: job.input?.voiceDesign || null,
        qwen_design_record: job.input?.qwenVoiceDesignRecord || null,
        source_job_id: job.jobId,
        character_id: job.characterId,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const testMode = process.env.NODE_ENV === "test" ? String(process.env.OTG_QWEN3_VOICE_SAMPLE_TEST_MODE || "") : "";
  let exitCode = 0;
  if (testMode === "success") {
    options.onEvent?.({ phase: "process_start", message: `Qwen3 process start. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}` });
    await fs.writeFile(plan.stdoutPath, JSON.stringify({ ok: true, testMode: true }) + "\n", "utf8");
    await fs.writeFile(plan.stderrPath, "", "utf8");
    await fs.writeFile(plan.samplePath, Buffer.from("RIFF$\u0000\u0000\u0000WAVEfmt ", "binary"));
    options.onEvent?.({ phase: "process_exit", message: `Qwen3 process exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`, exitCode: 0 });
  } else if (testMode === "nonzero") {
    await fs.writeFile(plan.stdoutPath, "", "utf8");
    await fs.writeFile(plan.stderrPath, "test nonzero failure\n", "utf8");
    throw new Error(`Qwen3-TTS voice sample generation failed with exit code 2.\ntest nonzero failure\nstdout: ${plan.stdoutPath}\nstderr: ${plan.stderrPath}`);
  } else if (testMode === "no_output") {
    options.onEvent?.({ phase: "process_start", message: `Qwen3 process start. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}` });
    await fs.writeFile(plan.stdoutPath, JSON.stringify({ ok: true, noOutput: true }) + "\n", "utf8");
    await fs.writeFile(plan.stderrPath, "", "utf8");
    options.onEvent?.({ phase: "process_exit", message: `Qwen3 process exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`, exitCode: 0 });
  } else {
    exitCode = await runQwenBridge(plan, {
      paramsPath: plan.paramsPath,
      stdoutPath: plan.stdoutPath,
      stderrPath: plan.stderrPath,
      onEvent: options.onEvent,
    });
  }

  const stat = await fs.stat(plan.samplePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Qwen3-TTS finished without writing voice sample WAV: ${plan.samplePath}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }

  return {
    samplePath: plan.samplePath,
    sampleUrl: plan.sampleUrl,
    provider: "qwen3",
    adapter: "qwen3",
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
