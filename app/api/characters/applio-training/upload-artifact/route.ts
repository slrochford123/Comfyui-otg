import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { safeSegment } from "@/lib/paths";
import {
  applioTrainingArtifactDirectory,
  applioTrainingArtifactPath,
  applioTrainingArtifactUrl,
  type ApplioTrainingArtifact,
  type ApplioTrainingArtifactResult,
} from "@/lib/jobs/applioTrainingArtifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Writes the remote Applio training-artifact.json plus uploaded .pth/.index/log files.

const MAX_MODEL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_INDEX_BYTES = 512 * 1024 * 1024;
const MAX_LOG_BYTES = 64 * 1024 * 1024;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = cleanString(req.headers.get("x-otg-owner-key"));
  return headerOwnerKey || fallbackOwnerKey;
}

function safeFileName(value: unknown, fallback: string): string {
  const cleaned = cleanString(value)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);

  return cleaned || fallback;
}

function parseArtifact(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("artifact must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function getFile(form: FormData, names: string[]): File | null {
  for (const name of names) {
    const value = form.get(name);
    if (value instanceof File) return value;
  }
  return null;
}

async function writeUploadFile(args: {
  file: File | null;
  outputDir: string;
  fallbackName: string;
  allowedExtensions: string[];
  maxBytes: number;
  required?: boolean;
}): Promise<string> {
  const { file, outputDir, fallbackName, allowedExtensions, maxBytes, required = false } = args;
  if (!(file instanceof File)) {
    if (required) throw new Error(`Missing required file: ${fallbackName}`);
    return "";
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length <= 0) throw new Error(`Uploaded file is empty: ${file.name || fallbackName}`);
  if (bytes.length > maxBytes) throw new Error(`Uploaded file is too large: ${file.name || fallbackName}`);

  const filename = safeFileName(file.name, fallbackName);
  const extension = path.extname(filename).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new Error(`Invalid file extension for ${filename}. Expected: ${allowedExtensions.join(", ")}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  const finalPath = path.join(outputDir, filename);
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedFinalPath = path.resolve(finalPath);
  if (!resolvedFinalPath.startsWith(resolvedOutputDir + path.sep)) {
    throw new Error("Invalid upload path.");
  }

  const tempPath = `${resolvedFinalPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, resolvedFinalPath);
  return resolvedFinalPath;
}

async function writeTextFile(args: {
  file: File | null;
  outputDir: string;
  fallbackName: string;
  maxBytes: number;
}): Promise<string> {
  const { file, outputDir, fallbackName, maxBytes } = args;
  if (!(file instanceof File)) return "";

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Uploaded text/log file is too large: ${file.name || fallbackName}`);

  await fs.mkdir(outputDir, { recursive: true });
  const finalPath = path.join(outputDir, safeFileName(file.name, fallbackName));
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedFinalPath = path.resolve(finalPath);
  if (!resolvedFinalPath.startsWith(resolvedOutputDir + path.sep)) {
    throw new Error("Invalid upload path.");
  }

  const tempPath = `${resolvedFinalPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, resolvedFinalPath);
  return resolvedFinalPath;
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tempPath, filePath);
}

function buildArtifact(args: {
  artifactInput: Record<string, unknown>;
  ownerKey: string;
  characterId: string;
  jobId: string;
  artifactPath: string;
  artifactUrl: string;
  modelPath: string;
  indexPath: string;
  configPath: string;
  stdoutPath: string;
  stderrPath: string;
  commandPath: string;
}): ApplioTrainingArtifact {
  const now = new Date().toISOString();
  const artifactInput = args.artifactInput;
  const inputDataset = artifactInput.dataset && typeof artifactInput.dataset === "object" && !Array.isArray(artifactInput.dataset)
    ? artifactInput.dataset as Record<string, unknown>
    : {};
  const inputModel = artifactInput.model && typeof artifactInput.model === "object" && !Array.isArray(artifactInput.model)
    ? artifactInput.model as Record<string, unknown>
    : {};

  const modelName = cleanString(inputModel.modelName || artifactInput.modelName) ||
    path.basename(args.modelPath, path.extname(args.modelPath));

  return {
    schemaVersion: 1,
    ownerKey: args.ownerKey,
    characterId: args.characterId,
    jobId: args.jobId,
    createdAt: cleanString(artifactInput.createdAt) || now,
    status: "trained",
    mock: false,
    adapter: "applio_real_training",
    dataset: {
      manifestPath: cleanString(inputDataset.manifestPath || artifactInput.manifestPath),
      manifestUrl: cleanString(inputDataset.manifestUrl || artifactInput.manifestUrl),
      sourceDatasetJobId: cleanString(inputDataset.sourceDatasetJobId || artifactInput.sourceDatasetJobId),
      clipCount: Number(inputDataset.clipCount || artifactInput.clipCount || 0),
      approvedSampleUrl: cleanString(inputDataset.approvedSampleUrl || artifactInput.approvedSampleUrl),
      preparedDatasetPath: cleanString(inputDataset.preparedDatasetPath || artifactInput.preparedDatasetPath),
      generationMode: cleanString(inputDataset.generationMode || artifactInput.generationMode),
      provider: cleanString(inputDataset.provider || artifactInput.provider),
    },
    model: {
      modelName,
      expectedModelPath: args.modelPath,
      expectedIndexPath: args.indexPath,
      expectedConfigPath: args.configPath,
      modelPath: args.modelPath,
      indexPath: args.indexPath,
      sourceModelPath: cleanString(inputModel.sourceModelPath || artifactInput.sourceModelPath),
      sourceIndexPath: cleanString(inputModel.sourceIndexPath || artifactInput.sourceIndexPath),
      status: "trained",
    },
    logs: {
      logsDir: path.dirname(args.stdoutPath || args.stderrPath || args.commandPath || args.artifactPath),
      stdoutPath: args.stdoutPath,
      stderrPath: args.stderrPath,
      commandPath: args.commandPath,
    },
    trainingQualityPreset: cleanString(artifactInput.trainingQualityPreset),
    epochs: Number(artifactInput.epochs || 0) || undefined,
    saveEveryEpoch: Number(artifactInput.saveEveryEpoch || 0) || undefined,
    estimatedDurationLabel: cleanString(artifactInput.estimatedDurationLabel),
    trainingStartedAt: cleanString(artifactInput.trainingStartedAt),
    trainingCompletedAt: cleanString(artifactInput.trainingCompletedAt) || now,
    totalTrainingMs: Number(artifactInput.totalTrainingMs || 0) || undefined,
    totalTrainingLabel: cleanString(artifactInput.totalTrainingLabel),
    note: cleanString(artifactInput.note) ||
      "Real Applio training ran on the remote Windows worker. Required .pth and .index outputs were uploaded and verified.",
  };
}

function buildResult(args: {
  artifact: ApplioTrainingArtifact;
  artifactPath: string;
  artifactUrl: string;
  modelPath: string;
  indexPath: string;
  stdoutPath: string;
  stderrPath: string;
  commandPath: string;
}): ApplioTrainingArtifactResult {
  return {
    mock: false,
    adapter: "applio_real_training",
    artifactPath: args.artifactPath,
    artifactUrl: args.artifactUrl,
    status: "trained",
    manifestPath: args.artifact.dataset.manifestPath,
    clipCount: args.artifact.dataset.clipCount,
    modelName: args.artifact.model.modelName,
    expectedModelPath: args.modelPath,
    expectedIndexPath: args.indexPath,
    modelPath: args.modelPath,
    indexPath: args.indexPath,
    sourceModelPath: args.artifact.model.sourceModelPath,
    sourceIndexPath: args.artifact.model.sourceIndexPath,
    stdoutPath: args.stdoutPath,
    stderrPath: args.stderrPath,
    commandPath: args.commandPath,
    preparedDatasetPath: args.artifact.dataset.preparedDatasetPath,
    trainingQualityPreset: args.artifact.trainingQualityPreset,
    epochs: args.artifact.epochs,
    saveEveryEpoch: args.artifact.saveEveryEpoch,
    estimatedDurationLabel: args.artifact.estimatedDurationLabel,
    currentStage: "completed",
    trainingStartedAt: args.artifact.trainingStartedAt,
    trainingCompletedAt: args.artifact.trainingCompletedAt,
    totalTrainingMs: args.artifact.totalTrainingMs,
    totalTrainingLabel: args.artifact.totalTrainingLabel,
  };
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();

    const ownerKey = workerOwnerKey(req, owner.ownerKey);
    const characterId = safeSegment(cleanString(form.get("characterId")));
    const jobId = safeSegment(cleanString(form.get("jobId")));

    if (!ownerKey) return jsonError("Missing owner.", 400);
    if (!characterId) return jsonError("Missing characterId.", 400);
    if (!jobId) return jsonError("Missing jobId.", 400);

    const outputDir = applioTrainingArtifactDirectory(ownerKey, characterId, jobId);
    const logsDir = path.join(outputDir, "logs");

    const artifactInput = parseArtifact(form.get("artifact"));
    const modelName = safeSegment(cleanString(
      (artifactInput.model && typeof artifactInput.model === "object" && !Array.isArray(artifactInput.model)
        ? (artifactInput.model as Record<string, unknown>).modelName
        : "") || artifactInput.modelName || `voice_model_${characterId}_${jobId}`,
    ));

    const modelPath = await writeUploadFile({
      file: getFile(form, ["model", "modelFile", "pth"]),
      outputDir,
      fallbackName: `${modelName}.pth`,
      allowedExtensions: [".pth"],
      maxBytes: MAX_MODEL_BYTES,
      required: true,
    });

    const indexPath = await writeUploadFile({
      file: getFile(form, ["index", "indexFile"]),
      outputDir,
      fallbackName: `${modelName}.index`,
      allowedExtensions: [".index"],
      maxBytes: MAX_INDEX_BYTES,
      required: true,
    });

    const configPath = await writeUploadFile({
      file: getFile(form, ["config", "configFile"]),
      outputDir,
      fallbackName: `${modelName}.json`,
      allowedExtensions: [".json"],
      maxBytes: MAX_LOG_BYTES,
      required: false,
    });

    const stdoutPath = await writeTextFile({
      file: getFile(form, ["stdout", "stdoutLog"]),
      outputDir: logsDir,
      fallbackName: "applio-stdout.log",
      maxBytes: MAX_LOG_BYTES,
    });

    const stderrPath = await writeTextFile({
      file: getFile(form, ["stderr", "stderrLog"]),
      outputDir: logsDir,
      fallbackName: "applio-stderr.log",
      maxBytes: MAX_LOG_BYTES,
    });

    const commandPath = await writeTextFile({
      file: getFile(form, ["commands", "commandLog", "command"]),
      outputDir: logsDir,
      fallbackName: "applio-commands.json",
      maxBytes: MAX_LOG_BYTES,
    });

    const artifactPath = applioTrainingArtifactPath(ownerKey, characterId, jobId);
    const artifactUrl = applioTrainingArtifactUrl(ownerKey, characterId, jobId);
    const artifact = buildArtifact({
      artifactInput,
      ownerKey,
      characterId,
      jobId,
      artifactPath,
      artifactUrl,
      modelPath,
      indexPath,
      configPath: configPath || path.join(outputDir, `${modelName}.json`),
      stdoutPath: stdoutPath || path.join(logsDir, "applio-stdout.log"),
      stderrPath: stderrPath || path.join(logsDir, "applio-stderr.log"),
      commandPath: commandPath || path.join(logsDir, "applio-commands.json"),
    });

    await writeJsonAtomic(artifactPath, artifact);

    const result = buildResult({
      artifact,
      artifactPath,
      artifactUrl,
      modelPath,
      indexPath,
      stdoutPath: artifact.logs?.stdoutPath || "",
      stderrPath: artifact.logs?.stderrPath || "",
      commandPath: artifact.logs?.commandPath || "",
    });

    return NextResponse.json(
      {
        ok: true,
        artifact,
        result,
      },
      { headers: withNoStore() },
    );
  } catch (error) {
    const sessionResponse = sessionErrorResponse(error);
    if (sessionResponse) return sessionResponse;
    return jsonError(error instanceof Error ? error.message : "Could not upload Applio training artifact.", 500);
  }
}