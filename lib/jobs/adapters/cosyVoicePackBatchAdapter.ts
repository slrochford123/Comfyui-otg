import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import { ensureDir } from "@/lib/paths";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type CosyVoicePackBatchClipInput = {
  clipId: string;
  text: string;
  outputWav: string;
};

export type CosyVoicePackBatchClipResult = {
  clipId: string;
  ok: boolean;
  outputWav: string;
  outputBytes?: number;
  sampleRate?: number;
  error?: string;
};

export type CosyVoicePackBatchResult = {
  adapter: "cosy_pack_batch";
  provider: "cosy";
  mock: false;
  outputDir: string;
  logsPath: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitCode: number;
  results: CosyVoicePackBatchClipResult[];
};

type CosyVoicePackBatchConfig = {
  enabled: boolean;
  root: string;
  python: string;
  sitePackages: string;
  bridge: string;
  modelId: string;
  timeoutMs: number;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function envPath(name: string): string {
  const value = process.env[name];
  return value ? path.resolve(value) : "";
}

function batchBridgePath(): string {
  const explicit = envPath("COSYVOICE_BATCH_BRIDGE");
  if (explicit) return explicit;
  const sampleBridge = envPath("COSYVOICE_BRIDGE");
  if (sampleBridge) return path.join(path.dirname(sampleBridge), "index_tts2_clone_pack_bridge.py");
  return path.join(process.cwd(), "scripts", "index_tts2_clone_pack_bridge.py");
}

function cosyBatchConfig(): CosyVoicePackBatchConfig {
  return {
    enabled: process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE === "1",
    root: envPath("COSYVOICE_ROOT"),
    python: envPath("COSYVOICE_PYTHON"),
    sitePackages: envPath("COSYVOICE_SITE_PACKAGES"),
    bridge: batchBridgePath(),
    modelId: cleanString(process.env.COSYVOICE_MODEL_ID || "CosyVoice"),
    timeoutMs: Math.max(60_000, Number(process.env.COSYVOICE_TIMEOUT_MS || 10 * 60 * 1000)),
  };
}

async function requireConfiguredDir(dirPath: string, envName: string, label: string): Promise<void> {
  if (!dirPath) throw new Error(`${envName} is required for real Cosy/CosyVoice batch voice-pack generation.`);
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${dirPath}`);
}

async function requireOptionalConfiguredDir(dirPath: string, label: string): Promise<void> {
  if (!dirPath) return;
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${label} not found: ${dirPath}`);
}

async function requireConfiguredFile(filePath: string, envName: string, label: string): Promise<void> {
  if (!filePath) throw new Error(`${envName} is required for real Cosy/CosyVoice batch voice-pack generation.`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${label} not found: ${filePath}`);
}

function voicePrompt(job: QueuedContractJob): string {
  return (
    cleanString(job.input?.voiceInstruction) ||
    cleanString(job.input?.prompt) ||
    "Create a clear, natural, plain neutral character voice. Keep pronunciation understandable."
  );
}

function writeTestWavBytes(clipId: string): Buffer {
  return Buffer.from(`RIFF$\u0000\u0000\u0000WAVEfmt OTG_COSY_BATCH_${clipId}`, "binary");
}

function parseBatchResults(stdout: string): CosyVoicePackBatchClipResult[] {
  const results: CosyVoicePackBatchClipResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<CosyVoicePackBatchClipResult> & {
        clip_id?: string;
        output_wav?: string;
        output_bytes?: number;
        sample_rate?: number;
      };
      const clipId = cleanString(parsed.clipId || parsed.clip_id);
      if (!clipId) continue;
      results.push({
        clipId,
        ok: parsed.ok === true,
        outputWav: cleanString(parsed.outputWav || parsed.output_wav),
        outputBytes: typeof parsed.outputBytes === "number" ? parsed.outputBytes : parsed.output_bytes,
        sampleRate: typeof parsed.sampleRate === "number" ? parsed.sampleRate : parsed.sample_rate,
        error: cleanString(parsed.error),
      });
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }
  return results;
}

async function runBatchBridge(config: CosyVoicePackBatchConfig, args: {
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

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
      finish(() => reject(new Error(`Cosy/CosyVoice batch voice-pack generation timed out. stdout: ${args.stdoutPath}; stderr: ${args.stderrPath}`)));
    }, config.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      finish(() => resolve(code ?? 1));
    });
  });
}

export async function generateCosyVoicePackBatch(args: {
  ownerKey: string;
  job: QueuedContractJob;
  outputDir: string;
  canonicalSourcePath: string;
  clips: CosyVoicePackBatchClipInput[];
}): Promise<CosyVoicePackBatchResult> {
  const config = cosyBatchConfig();
  if (!config.enabled) throw new Error("Real Cosy/CosyVoice batch voice-pack generation is disabled. Set OTG_ENABLE_REAL_COSY_VOICE_SAMPLE=1.");

  await requireConfiguredDir(config.root, "COSYVOICE_ROOT", "Cosy/CosyVoice root");
  await requireConfiguredFile(config.python, "COSYVOICE_PYTHON", "Cosy/CosyVoice Python");
  await requireOptionalConfiguredDir(config.sitePackages, "Cosy/CosyVoice site-packages");
  await requireConfiguredFile(config.bridge, "COSYVOICE_BATCH_BRIDGE", "Cosy/CosyVoice batch bridge");

  const logsPath = path.join(args.outputDir, "logs");
  const paramsPath = path.join(logsPath, `cosy_pack_batch_${Date.now()}_${Math.random().toString(16).slice(2)}.json`);
  const stdoutPath = paramsPath.replace(/\.json$/, "_stdout.log");
  const stderrPath = paramsPath.replace(/\.json$/, "_stderr.log");
  ensureDir(logsPath);

  await fs.writeFile(
    paramsPath,
    JSON.stringify(
      {
        engine: "CosyVoice",
        adapter: "cosy_pack_batch",
        model_id: config.modelId,
        cosyvoice_root: config.root,
        prompt_wav: args.canonicalSourcePath,
        reference_wav: args.canonicalSourcePath,
        instruction: voicePrompt(args.job),
        prompt: voicePrompt(args.job),
        language: cleanString(args.job.input?.language || "english"),
        source_job_id: args.job.jobId,
        character_id: args.job.characterId,
        clips: args.clips.map((clip) => ({
          clip_id: clip.clipId,
          text: clip.text,
          output_wav: clip.outputWav,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const testMode = process.env.NODE_ENV === "test" ? cleanString(process.env.OTG_COSY_VOICE_PACK_BATCH_TEST_MODE) : "";
  let exitCode = 0;
  if (testMode === "success" || testMode === "partial") {
    const results: CosyVoicePackBatchClipResult[] = [];
    for (const [index, clip] of args.clips.entries()) {
      if (testMode === "partial" && index > 0) {
        results.push({ clipId: clip.clipId, ok: false, outputWav: clip.outputWav, error: "test batch partial failure" });
        continue;
      }
      ensureDir(path.dirname(clip.outputWav));
      await fs.writeFile(clip.outputWav, writeTestWavBytes(clip.clipId));
      const stat = await fs.stat(clip.outputWav);
      results.push({ clipId: clip.clipId, ok: true, outputWav: clip.outputWav, outputBytes: stat.size, sampleRate: 24000 });
    }
    exitCode = results.every((result) => result.ok) ? 0 : 2;
    await fs.writeFile(stdoutPath, results.map((result) => JSON.stringify(result)).join("\n") + "\n", "utf8");
    await fs.writeFile(stderrPath, exitCode === 0 ? "" : "test batch partial failure\n", "utf8");
    return {
      adapter: "cosy_pack_batch",
      provider: "cosy",
      mock: false,
      outputDir: args.outputDir,
      logsPath,
      paramsPath,
      stdoutPath,
      stderrPath,
      exitCode,
      results,
    };
  }

  exitCode = await runBatchBridge(config, { paramsPath, stdoutPath, stderrPath });
  const stdout = await fs.readFile(stdoutPath, "utf8").catch(() => "");
  const stderr = await fs.readFile(stderrPath, "utf8").catch(() => "");
  const results = parseBatchResults(stdout);
  if (exitCode !== 0 && results.length === 0) {
    throw new Error(`Cosy/CosyVoice batch voice-pack generation failed with exit code ${exitCode}. stdout: ${stdoutPath}; stderr: ${stderrPath}\n${stderr}`);
  }

  return {
    adapter: "cosy_pack_batch",
    provider: "cosy",
    mock: false,
    outputDir: args.outputDir,
    logsPath,
    paramsPath,
    stdoutPath,
    stderrPath,
    exitCode,
    results,
  };
}
