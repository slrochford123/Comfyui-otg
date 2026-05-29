import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type CosyVoiceSampleAdapterResult = {
  samplePath: string;
  sampleUrl: string;
  provider: "cosy";
  adapter: "cosy";
  mock: false;
  outputDir: string;
  logsPath: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitCode: number;
  outputBytes: number;
};

export type CosyVoiceSamplePlan = {
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

export type CosyVoiceSampleRunEvent = {
  phase: "process_start" | "process_exit";
  message: string;
  exitCode?: number | null;
};

type CosyVoiceSampleConfig = {
  enabled: boolean;
  root: string;
  python: string;
  sitePackages: string;
  bridge: string;
  modelId: string;
  timeoutMs: number;
};

export function isRealCosyVoiceSampleEnabled(): boolean {
  return process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE === "1";
}

export function isCosyVoiceSampleJob(job: QueuedContractJob): boolean {
  return (
    job.jobType === "character_voice_pipeline" &&
    job.action === "create_voice_sample" &&
    job.input?.provider === "cosy"
  );
}

function envPath(name: string): string {
  const value = process.env[name];
  return value ? path.resolve(value) : "";
}

function cosyConfig(): CosyVoiceSampleConfig {
  return {
    enabled: isRealCosyVoiceSampleEnabled(),
    root: envPath("COSYVOICE_ROOT"),
    python: envPath("COSYVOICE_PYTHON"),
    sitePackages: envPath("COSYVOICE_SITE_PACKAGES"),
    bridge: envPath("COSYVOICE_BRIDGE"),
    modelId: String(process.env.COSYVOICE_MODEL_ID || "CosyVoice"),
    timeoutMs: Math.max(60_000, Number(process.env.COSYVOICE_TIMEOUT_MS || 10 * 60 * 1000)),
  };
}

export function resolveCosyVoiceSamplePlan(ownerKey: string, job: QueuedContractJob): CosyVoiceSamplePlan {
  const config = cosyConfig();
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
    paramsPath: path.join(logsPath, "cosy_sample_params.json"),
    stdoutPath: path.join(logsPath, "cosy_sample_stdout.log"),
    stderrPath: path.join(logsPath, "cosy_sample_stderr.log"),
  };
}

async function requireConfiguredDir(dirPath: string, envName: string, label: string): Promise<void> {
  if (!dirPath) throw new Error(`${envName} is required for real Cosy/CosyVoice voice sample generation.`);
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${dirPath}`);
}

async function requireOptionalConfiguredDir(dirPath: string, label: string): Promise<void> {
  if (!dirPath) return;
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${dirPath}`);
}

async function requireConfiguredFile(filePath: string, envName: string, label: string): Promise<void> {
  if (!filePath) throw new Error(`${envName} is required for real Cosy/CosyVoice voice sample generation.`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${label} not found: ${filePath}`);
}

function sampleUrlFor(ownerKey: string, characterId: string, jobId: string): string {
  return `/api/characters/voice-sample/file?owner=${encodeURIComponent(ownerKey)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(jobId)}`;
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function sampleText(job: QueuedContractJob): string {
  return (
    cleanString(job.input?.previewText) ||
    cleanString(job.input?.text) ||
    "This is a character voice sample for approval."
  );
}

function voicePrompt(job: QueuedContractJob): string {
  return (
    cleanString(job.input?.voiceInstruction) ||
    cleanString(job.input?.prompt) ||
    "Create a clear, natural, plain neutral character voice. Keep pronunciation understandable."
  );
}

function runCosyBridge(config: CosyVoiceSampleConfig, args: {
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  onEvent?: (event: CosyVoiceSampleRunEvent) => void;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    args.onEvent?.({
      phase: "process_start",
      message: `Cosy process start. stdout: ${args.stdoutPath}; stderr: ${args.stderrPath}`,
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
          PYTHONPATH: config.sitePackages || process.env.PYTHONPATH,
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
      finish(() => reject(new Error("Cosy/CosyVoice voice sample generation timed out.")));
    }, config.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      args.onEvent?.({
        phase: "process_exit",
        message: `Cosy process exit code ${code ?? "null"}. stdout: ${args.stdoutPath}; stderr: ${args.stderrPath}`,
        exitCode: code,
      });
      if (code === 0) {
        finish(() => resolve(0));
        return;
      }

      const stderr = await fs.readFile(args.stderrPath, "utf8").catch(() => "");
      const stdout = await fs.readFile(args.stdoutPath, "utf8").catch(() => "");
      finish(() => reject(new Error((`Cosy/CosyVoice voice sample generation failed with exit code ${code}.\n${stderr}\n${stdout}`).trim())));
    });
  });
}

export async function generateCosyVoiceSample(
  ownerKey: string,
  job: QueuedContractJob,
  options: { onEvent?: (event: CosyVoiceSampleRunEvent) => void } = {},
): Promise<CosyVoiceSampleAdapterResult> {
  const plan = resolveCosyVoiceSamplePlan(ownerKey, job);
  if (!plan.enabled) throw new Error("Real Cosy/CosyVoice voice sample generation is disabled. Set OTG_ENABLE_REAL_COSY_VOICE_SAMPLE=1.");

  await requireConfiguredDir(plan.root, "COSYVOICE_ROOT", "Cosy/CosyVoice root");
  await requireConfiguredFile(plan.python, "COSYVOICE_PYTHON", "Cosy/CosyVoice Python");
  await requireOptionalConfiguredDir(plan.sitePackages, "Cosy/CosyVoice site-packages");
  await requireConfiguredFile(plan.bridge, "COSYVOICE_BRIDGE", "Cosy/CosyVoice bridge");

  ensureDir(plan.logsPath);

  await fs.writeFile(
    plan.paramsPath,
    JSON.stringify(
      {
        engine: "CosyVoice",
        model_id: plan.modelId,
        cosyvoice_root: plan.root,
        output_wav: plan.samplePath,
        text: sampleText(job),
        instruction: voicePrompt(job),
        prompt: voicePrompt(job),
        prompt_wav: cleanString(job.input?.promptWav || job.input?.prompt_wav || job.input?.referenceWav || job.input?.reference_wav),
        language: cleanString(job.input?.language || "english"),
        source_job_id: job.jobId,
        character_id: job.characterId,
        input: job.input,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const testMode = process.env.NODE_ENV === "test" ? String(process.env.OTG_COSY_VOICE_SAMPLE_TEST_MODE || "") : "";
  let exitCode = 0;
  if (testMode === "success") {
    options.onEvent?.({ phase: "process_start", message: `Cosy process start. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}` });
    await fs.writeFile(plan.stdoutPath, JSON.stringify({ ok: true, testMode: true }) + "\n", "utf8");
    await fs.writeFile(plan.stderrPath, "", "utf8");
    await fs.writeFile(plan.samplePath, Buffer.from("RIFF$\u0000\u0000\u0000WAVEfmt ", "binary"));
    options.onEvent?.({ phase: "process_exit", message: `Cosy process exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`, exitCode: 0 });
  } else if (testMode === "nonzero") {
    await fs.writeFile(plan.stdoutPath, "", "utf8");
    await fs.writeFile(plan.stderrPath, "test cosy nonzero failure\n", "utf8");
    throw new Error(`Cosy/CosyVoice voice sample generation failed with exit code 2.\ntest cosy nonzero failure\nstdout: ${plan.stdoutPath}\nstderr: ${plan.stderrPath}`);
  } else if (testMode === "no_output") {
    options.onEvent?.({ phase: "process_start", message: `Cosy process start. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}` });
    await fs.writeFile(plan.stdoutPath, JSON.stringify({ ok: true, noOutput: true }) + "\n", "utf8");
    await fs.writeFile(plan.stderrPath, "", "utf8");
    options.onEvent?.({ phase: "process_exit", message: `Cosy process exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`, exitCode: 0 });
  } else {
    exitCode = await runCosyBridge(plan, {
      paramsPath: plan.paramsPath,
      stdoutPath: plan.stdoutPath,
      stderrPath: plan.stderrPath,
      onEvent: options.onEvent,
    });
  }

  const stat = await fs.stat(plan.samplePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Cosy/CosyVoice finished without writing voice sample WAV: ${plan.samplePath}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }

  return {
    samplePath: plan.samplePath,
    sampleUrl: plan.sampleUrl,
    provider: "cosy",
    adapter: "cosy",
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
