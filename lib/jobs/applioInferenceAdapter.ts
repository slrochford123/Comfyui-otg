import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { QueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

export type ApplioInferenceResult = {
  adapter: "applio_real_inference";
  mock: false;
  provider: "applio";
  status: "completed";
  trainedArtifactId?: string;
  trainedModelPath: string;
  trainedIndexPath: string;
  inputAudioPath: string;
  inputAudioUrl?: string;
  outputAudioPath: string;
  outputAudioUrl: string;
  outputBytes: number;
  outputDir: string;
  logsPath: string;
  stdoutPath: string;
  stderrPath: string;
  commandPath: string;
  exitCode: number;
  inputSha256: string;
  outputSha256: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  elapsedLabel: string;
};

type ApplioInferencePlan = {
  applioRoot: string;
  python: string;
  inferScript: string;
  commandArgs: string[];
  outputDir: string;
  logsPath: string;
  stdoutPath: string;
  stderrPath: string;
  commandPath: string;
  outputAudioPath: string;
  outputAudioUrl: string;
  trainedModelPath: string;
  trainedIndexPath: string;
  inputAudioPath: string;
  inputAudioUrl?: string;
  trainedArtifactId?: string;
  timeoutMs: number;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function hasBytes(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function requireFileWithBytes(filePath: string, label: string): string {
  const resolved = path.resolve(cleanString(filePath));
  if (!resolved || !hasBytes(resolved)) {
    throw new Error(`${label} is missing or empty: ${resolved || "(unset)"}`);
  }
  return resolved;
}

function requireExistingPath(envName: string, label: string): string {
  const value = cleanString(process.env[envName]);
  if (!value) throw new Error(`${envName} is required for trained Applio inference (${label}).`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${envName} does not exist for trained Applio inference: ${resolved}`);
  return resolved;
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = cleanString(process.env[name]);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} through ${max}. Received: ${raw}`);
  }
  return value;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = numberEnv(name, fallback, min, max);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer from ${min} through ${max}. Received: ${cleanString(process.env[name])}`);
  }
  return value;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function appendLog(filePath: string, text: string): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, text, "utf8");
}

function isTraceback(stderr: string): boolean {
  return /Traceback \(most recent call last\)|ValueError:|FileNotFoundError:|RuntimeError:/i.test(stderr);
}

function inferScriptFromEnv(applioRoot: string): string {
  const explicit = cleanString(process.env.APPLIO_INFER_SCRIPT);
  const rootCore = path.join(applioRoot, "core.py");
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (fs.existsSync(resolved)) return resolved;
    if (fs.existsSync(rootCore)) return rootCore;
    throw new Error(`APPLIO_INFER_SCRIPT does not exist for trained Applio inference and APPLIO_ROOT/core.py was not found: ${resolved}`);
  }
  if (!fs.existsSync(rootCore)) {
    throw new Error(`APPLIO_INFER_SCRIPT is not set and APPLIO_ROOT/core.py was not found: ${rootCore}`);
  }
  return rootCore;
}

function inferenceOutputUrl(ownerKey: string, characterId: string, jobId: string): string {
  const params = new URLSearchParams({
    owner: safeSegment(ownerKey),
    characterId: safeSegment(characterId),
    jobId: safeSegment(jobId),
  });
  return `/api/characters/applio-inference/file?${params.toString()}`;
}

export function isApplioTrainedVoiceTestJob(job: QueuedContractJob): boolean {
  return job.jobType === "character_voice_pipeline" && job.action === "test_trained_voice";
}

export function resolveApplioInferencePlan(ownerKey: string, job: QueuedContractJob): ApplioInferencePlan {
  const input = job.input || {};
  const characterId = cleanString(job.characterId || input.characterId);
  if (!characterId) throw new Error("Missing characterId for trained Applio inference.");

  const trainedArtifactMock =
    input.trainedArtifactMock === false || input.trainingMock === false || input.artifactMock === false
      ? false
      : true;
  if (trainedArtifactMock) {
    throw new Error("Test Trained Voice requires a real trained Applio artifact with mock:false.");
  }

  const adapter = cleanString(input.trainedAdapter || input.trainingAdapter || input.adapter);
  if (adapter && adapter !== "applio_real_training") {
    throw new Error(`Test Trained Voice requires adapter applio_real_training. Received: ${adapter}`);
  }

  const applioRoot = requireExistingPath("APPLIO_ROOT", "Applio checkout root");
  const python = requireExistingPath("APPLIO_PYTHON", "Applio Python executable");
  const inferScript = inferScriptFromEnv(applioRoot);
  const trainedModelPath = requireFileWithBytes(cleanString(input.trainedModelPath || input.modelPath), "Trained Applio .pth model");
  const trainedIndexPath = requireFileWithBytes(cleanString(input.trainedIndexPath || input.indexPath), "Trained Applio .index");
  const inputAudioPath = requireFileWithBytes(cleanString(input.inputAudioPath), "Trained voice test input audio");

  const outputDir = path.join(
    OTG_DATA_ROOT,
    "characters",
    safeSegment(ownerKey),
    "applio-inference",
    safeSegment(characterId),
    safeSegment(job.jobId),
  );
  const logsPath = path.join(outputDir, "logs");
  const outputAudioPath = path.join(outputDir, "output.wav");
  const stdoutPath = path.join(logsPath, "applio-infer-stdout.log");
  const stderrPath = path.join(logsPath, "applio-infer-stderr.log");
  const commandPath = path.join(logsPath, "applio-infer-command.json");

  const f0Method = cleanString(process.env.APPLIO_INFER_F0_METHOD) || "rmvpe";
  const outputFormat = (cleanString(process.env.APPLIO_INFER_OUTPUT_FORMAT) || "WAV").toUpperCase();
  if (!["WAV", "MP3", "FLAC", "OGG", "M4A"].includes(outputFormat)) {
    throw new Error(`APPLIO_INFER_OUTPUT_FORMAT must be WAV, MP3, FLAC, OGG, or M4A. Received: ${outputFormat}`);
  }

  const pitch = integerEnv("APPLIO_INFER_PITCH", 0, -24, 24);
  const indexRate = numberEnv("APPLIO_INFER_INDEX_RATE", 0.75, 0, 1);
  const protect = numberEnv("APPLIO_INFER_PROTECT", 0.33, 0, 0.5);
  const timeoutMs = integerEnv("APPLIO_INFER_TIMEOUT_MS", 600_000, 1_000, 7_200_000);

  const commandArgs = [
    inferScript,
    "infer",
    "--pitch",
    String(pitch),
    "--index_rate",
    String(indexRate),
    "--volume_envelope",
    "1",
    "--protect",
    String(protect),
    "--f0_method",
    f0Method,
    "--input_path",
    inputAudioPath,
    "--output_path",
    outputAudioPath,
    "--pth_path",
    trainedModelPath,
    "--index_path",
    trainedIndexPath,
    "--split_audio",
    "False",
    "--f0_autotune",
    "False",
    "--clean_audio",
    "False",
    "--export_format",
    outputFormat,
    "--embedder_model",
    "contentvec",
  ];

  return {
    applioRoot,
    python,
    inferScript,
    commandArgs,
    outputDir,
    logsPath,
    stdoutPath,
    stderrPath,
    commandPath,
    outputAudioPath,
    outputAudioUrl: inferenceOutputUrl(ownerKey, characterId, job.jobId),
    trainedModelPath,
    trainedIndexPath,
    inputAudioPath,
    inputAudioUrl: cleanString(input.inputAudioUrl) || undefined,
    trainedArtifactId: cleanString(input.trainedArtifactId || input.voiceModelArtifactId) || undefined,
    timeoutMs,
  };
}

function runProcess(plan: ApplioInferencePlan): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(plan.python, plan.commandArgs, {
      cwd: plan.applioRoot,
      windowsHide: true,
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Applio inference timed out after ${plan.timeoutMs}ms. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`));
    }, plan.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      appendLog(plan.stdoutPath, text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      appendLog(plan.stderrPath, text);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function writeTestModeOutput(plan: ApplioInferencePlan): { exitCode: number; stdout: string; stderr: string } {
  const mode = cleanString(process.env.OTG_APPLIO_INFERENCE_TEST_MODE);
  if (!mode) return { exitCode: -999, stdout: "", stderr: "" };
  if (mode === "success") {
    fs.writeFileSync(plan.outputAudioPath, Buffer.concat([
      fs.readFileSync(plan.inputAudioPath),
      Buffer.from(`\nOTG_APPLIO_INFERENCE_TEST_${Date.now()}`, "utf8"),
    ]));
    const stdout = "test-mode Applio inference completed\n";
    appendLog(plan.stdoutPath, stdout);
    return { exitCode: 0, stdout, stderr: "" };
  }
  if (mode === "same-hash") {
    fs.copyFileSync(plan.inputAudioPath, plan.outputAudioPath);
    const stdout = "test-mode Applio inference copied input\n";
    appendLog(plan.stdoutPath, stdout);
    return { exitCode: 0, stdout, stderr: "" };
  }
  if (mode === "traceback") {
    const stderr = "Traceback (most recent call last)\nValueError: test inference failure\n";
    appendLog(plan.stderrPath, stderr);
    return { exitCode: 0, stdout: "", stderr };
  }
  throw new Error(`Unknown OTG_APPLIO_INFERENCE_TEST_MODE: ${mode}`);
}

export async function runApplioTrainedVoiceInference(ownerKey: string, job: QueuedContractJob): Promise<ApplioInferenceResult> {
  const plan = resolveApplioInferencePlan(ownerKey, job);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  ensureDir(plan.outputDir);
  ensureDir(plan.logsPath);
  fs.writeFileSync(plan.stdoutPath, "", "utf8");
  fs.writeFileSync(plan.stderrPath, "", "utf8");
  writeJsonAtomic(plan.commandPath, {
    adapter: "applio_real_inference",
    cwd: plan.applioRoot,
    python: plan.python,
    args: plan.commandArgs,
    trainedModelPath: plan.trainedModelPath,
    trainedIndexPath: plan.trainedIndexPath,
    inputAudioPath: plan.inputAudioPath,
    outputAudioPath: plan.outputAudioPath,
    startedAt,
  });

  const testModeResult = writeTestModeOutput(plan);
  const processResult = testModeResult.exitCode === -999 ? await runProcess(plan) : testModeResult;
  appendLog(plan.stdoutPath, `\nEXIT infer: ${processResult.exitCode}\n`);

  if (processResult.exitCode !== 0) {
    throw new Error(`Applio inference exited with code ${processResult.exitCode}. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }
  if (isTraceback(processResult.stderr)) {
    throw new Error(`Applio inference reported a traceback despite exit code 0. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }
  if (!hasBytes(plan.outputAudioPath)) {
    throw new Error(`Applio inference finished without writing output audio. output: ${plan.outputAudioPath}; stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }

  const inputSha256 = sha256(plan.inputAudioPath);
  const outputSha256 = sha256(plan.outputAudioPath);
  if (inputSha256 === outputSha256) {
    throw new Error(`Applio inference output is byte-identical to the input audio. Refusing to mark trained playback successful. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`);
  }

  const completedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startMs;
  const outputBytes = fs.statSync(plan.outputAudioPath).size;
  const result: ApplioInferenceResult = {
    adapter: "applio_real_inference",
    mock: false,
    provider: "applio",
    status: "completed",
    trainedArtifactId: plan.trainedArtifactId,
    trainedModelPath: plan.trainedModelPath,
    trainedIndexPath: plan.trainedIndexPath,
    inputAudioPath: plan.inputAudioPath,
    inputAudioUrl: plan.inputAudioUrl,
    outputAudioPath: plan.outputAudioPath,
    outputAudioUrl: plan.outputAudioUrl,
    outputBytes,
    outputDir: plan.outputDir,
    logsPath: plan.logsPath,
    stdoutPath: plan.stdoutPath,
    stderrPath: plan.stderrPath,
    commandPath: plan.commandPath,
    exitCode: processResult.exitCode,
    inputSha256,
    outputSha256,
    startedAt,
    completedAt,
    elapsedMs,
    elapsedLabel: formatDuration(elapsedMs),
  };

  writeJsonAtomic(plan.commandPath, {
    adapter: "applio_real_inference",
    cwd: plan.applioRoot,
    python: plan.python,
    args: plan.commandArgs,
    trainedModelPath: plan.trainedModelPath,
    trainedIndexPath: plan.trainedIndexPath,
    inputAudioPath: plan.inputAudioPath,
    outputAudioPath: plan.outputAudioPath,
    startedAt,
    completedAt,
    exitCode: processResult.exitCode,
    outputBytes,
    inputSha256,
    outputSha256,
  });

  return result;
}
