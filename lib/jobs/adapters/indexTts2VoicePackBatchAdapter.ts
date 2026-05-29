import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import { ensureDir } from "@/lib/paths";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type IndexTts2VoicePackBatchClipInput = {
  clipId: string;
  text: string;
  outputWav: string;
};

export type IndexTts2VoicePackBatchClipResult = {
  clipId: string;
  ok: boolean;
  outputWav: string;
  outputBytes?: number;
  sampleRate?: number;
  error?: string;
};

export type IndexTts2VoicePackBatchResult = {
  adapter: "indextts2_pack_batch";
  provider: "indextts2";
  sourceProvider: "qwen3" | "cosy";
  mock: false;
  outputDir: string;
  logsPath: string;
  paramsPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitCode: number;
  referenceWav: string;
  results: IndexTts2VoicePackBatchClipResult[];
};

type ParsedIndexTts2Clip = {
  id?: string;
  clipId?: string;
  clip_id?: string;
  status?: string;
  outputPath?: string;
  outputWav?: string;
  output_wav?: string;
  bytes?: number;
  outputBytes?: number;
  error?: string;
};

type IndexTts2VoicePackBatchConfig = {
  python: string;
  bridge: string;
  timeoutMs: number;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function envPath(name: string): string {
  const value = process.env[name];
  return value ? path.resolve(value) : "";
}

function indexTts2BatchBridgePath(): string {
  return envPath("INDEXTTS2_BATCH_BRIDGE") || envPath("INDEXTTS2_BRIDGE") || path.join(process.cwd(), "scripts", "index_tts2_clone_pack_bridge.py");
}

function indexTts2BatchConfig(): IndexTts2VoicePackBatchConfig {
  return {
    python: envPath("INDEXTTS2_PYTHON") || process.execPath,
    bridge: indexTts2BatchBridgePath(),
    timeoutMs: Math.max(60_000, Number(process.env.INDEXTTS2_TIMEOUT_MS || process.env.VOICE_PACK_TIMEOUT_MS || 30 * 60 * 1000)),
  };
}

async function requireConfiguredFile(filePath: string, envName: string, label: string): Promise<void> {
  if (!filePath) throw new Error(`${envName} is required for IndexTTS2 voice-pack clone generation.`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`${label} not found: ${filePath}`);
}

function sourceProvider(job: QueuedContractJob): "qwen3" | "cosy" {
  const provider = cleanString(job.input.provider || job.input.sourceProvider || job.input.voiceProvider).toLowerCase();
  if (provider === "qwen3" || provider === "cosy") return provider;
  throw new Error("IndexTTS2 voice-pack generation requires a Qwen3 or Cosy approved source provider.");
}

function parseBatchResults(stdout: string, requested: IndexTts2VoicePackBatchClipInput[]): IndexTts2VoicePackBatchClipResult[] {
  const requestedById = new Map(requested.map((clip) => [clip.clipId, clip]));
  const results = new Map<string, IndexTts2VoicePackBatchClipResult>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ParsedIndexTts2Clip & {
        clips?: ParsedIndexTts2Clip[];
        ok?: boolean;
      };
      const parsedClips: ParsedIndexTts2Clip[] = Array.isArray(parsed.clips) ? parsed.clips : [parsed];
      for (const clip of parsedClips) {
        const clipId = cleanString(clip.clipId || clip.clip_id || clip.id);
        if (!clipId || !requestedById.has(clipId)) continue;
        const outputWav = cleanString(clip.outputWav || clip.output_wav || clip.outputPath) || requestedById.get(clipId)?.outputWav || "";
        const outputBytes = typeof clip.outputBytes === "number" ? clip.outputBytes : clip.bytes;
        results.set(clipId, {
          clipId,
          ok: parsed.ok === true || clip.status === "ready" || (typeof outputBytes === "number" && outputBytes > 0),
          outputWav,
          outputBytes,
          error: cleanString(clip.error || parsed.error),
        });
      }
    } catch {
      // Ignore non-JSON diagnostics.
    }
  }
  return Array.from(results.values());
}

async function runBatchBridge(config: IndexTts2VoicePackBatchConfig, args: {
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
        cwd: process.cwd(),
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env },
      },
    );

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore timeout cleanup failures
      }
      finish(() => reject(new Error(`IndexTTS2 voice-pack clone generation timed out. stdout: ${args.stdoutPath}; stderr: ${args.stderrPath}`)));
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

export async function generateIndexTts2VoicePackBatch(args: {
  ownerKey: string;
  job: QueuedContractJob;
  outputDir: string;
  referenceWav: string;
  clips: IndexTts2VoicePackBatchClipInput[];
}): Promise<IndexTts2VoicePackBatchResult> {
  const config = indexTts2BatchConfig();
  await requireConfiguredFile(config.python, "INDEXTTS2_PYTHON", "IndexTTS2 Python");
  await requireConfiguredFile(config.bridge, "INDEXTTS2_BATCH_BRIDGE", "IndexTTS2 batch bridge");
  await requireConfiguredFile(args.referenceWav, "approvedSamplePath", "IndexTTS2 reference voice");

  const logsPath = path.join(args.outputDir, "logs");
  const paramsPath = path.join(logsPath, `indextts2_pack_batch_${Date.now()}_${Math.random().toString(16).slice(2)}.json`);
  const stdoutPath = paramsPath.replace(/\.json$/, "_stdout.log");
  const stderrPath = paramsPath.replace(/\.json$/, "_stderr.log");
  const source = sourceProvider(args.job);
  ensureDir(logsPath);

  const payload = {
    engine: "IndexTTS2",
    adapter: "indextts2_pack_batch",
    provider: "indextts2",
    source_provider: source,
    owner_key: args.ownerKey,
    source_job_id: args.job.jobId,
    character_id: args.job.characterId,
    output_dir: args.outputDir,
    reference_wav: args.referenceWav,
    prompt_wav: args.referenceWav,
    approvedSamplePath: args.referenceWav,
    speakerLockMode: "strict_same_speaker_indextts2_clone",
    identityPolicy: "same_reference_voice_for_all_clips",
    clips: args.clips.map((clip) => ({
      clip_id: clip.clipId,
      clipId: clip.clipId,
      id: clip.clipId,
      text: clip.text,
      output_wav: clip.outputWav,
      outputWav: clip.outputWav,
      outputPath: clip.outputWav,
    })),
  };

  await fs.writeFile(paramsPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const testMode = process.env.NODE_ENV === "test" ? cleanString(process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE) : "";
  if (testMode === "success" || testMode === "partial") {
    const results: IndexTts2VoicePackBatchClipResult[] = [];
    for (const [index, clip] of args.clips.entries()) {
      if (testMode === "partial" && index > 0) {
        results.push({ clipId: clip.clipId, ok: false, outputWav: clip.outputWav, error: "test IndexTTS2 partial failure" });
        continue;
      }
      ensureDir(path.dirname(clip.outputWav));
      await fs.writeFile(clip.outputWav, Buffer.from(`RIFF$\u0000\u0000\u0000WAVEfmt OTG_INDEXTTS2_${clip.clipId}`, "binary"));
      const stat = await fs.stat(clip.outputWav);
      results.push({ clipId: clip.clipId, ok: true, outputWav: clip.outputWav, outputBytes: stat.size, sampleRate: 24000 });
    }
    const exitCode = results.every((result) => result.ok) ? 0 : 2;
    await fs.writeFile(stdoutPath, results.map((result) => JSON.stringify(result)).join("\n") + "\n", "utf8");
    await fs.writeFile(stderrPath, exitCode === 0 ? "" : "test IndexTTS2 partial failure\n", "utf8");
    return {
      adapter: "indextts2_pack_batch",
      provider: "indextts2",
      sourceProvider: source,
      mock: false,
      outputDir: args.outputDir,
      logsPath,
      paramsPath,
      stdoutPath,
      stderrPath,
      exitCode,
      referenceWav: args.referenceWav,
      results,
    };
  }

  const exitCode = await runBatchBridge(config, { paramsPath, stdoutPath, stderrPath });
  const stdout = await fs.readFile(stdoutPath, "utf8").catch(() => "");
  const stderr = await fs.readFile(stderrPath, "utf8").catch(() => "");
  const results = parseBatchResults(stdout, args.clips);
  if (exitCode !== 0 && results.length === 0) {
    throw new Error(`IndexTTS2 voice-pack clone generation failed with exit code ${exitCode}. stdout: ${stdoutPath}; stderr: ${stderrPath}\n${stderr}`);
  }

  return {
    adapter: "indextts2_pack_batch",
    provider: "indextts2",
    sourceProvider: source,
    mock: false,
    outputDir: args.outputDir,
    logsPath,
    paramsPath,
    stdoutPath,
    stderrPath,
    exitCode,
    referenceWav: args.referenceWav,
    results,
  };
}
