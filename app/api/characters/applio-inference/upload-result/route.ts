import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataRoot() {
  return path.resolve(String(process.env.OTG_DATA_DIR || path.join(process.cwd(), "data")));
}

function safeSegment(value: unknown): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error("Missing required path segment.");
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`Invalid path segment: ${trimmed}`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error(`Invalid path segment: ${trimmed}`);
  }
  return trimmed;
}

function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  return headerOwnerKey || fallbackOwnerKey;
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

async function writeFormFile(form: FormData, field: string, targetPath: string, required: boolean) {
  const value = form.get(field);
  if (!(value instanceof File)) {
    if (required) throw new Error(`Missing required file: ${field}`);
    return null;
  }

  const bytes = Buffer.from(await value.arrayBuffer());
  if (required && bytes.length <= 0) throw new Error(`Uploaded file is empty: ${field}`);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, bytes);
  return {
    path: targetPath,
    bytes: bytes.length,
  };
}

async function writeOptionalText(form: FormData, field: string, targetPath: string) {
  const value = form.get(field);
  if (typeof value !== "string" || !value.trim()) return null;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
  return {
    path: targetPath,
    bytes: Buffer.byteLength(value),
  };
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();

    const ownerKey = safeSegment(workerOwnerKey(req, owner.ownerKey));
    const characterId = safeSegment(form.get("characterId"));
    const jobId = safeSegment(form.get("jobId"));

    const root = dataRoot();
    const inferenceRoot = path.join(root, "characters", ownerKey, "applio-inference");
    const outputDir = path.resolve(path.join(inferenceRoot, characterId, jobId));
    if (!outputDir.startsWith(path.resolve(inferenceRoot) + path.sep)) {
      return jsonError("Invalid Applio inference output path.", 400);
    }

    const logsDir = path.join(outputDir, "logs");
    const output = await writeFormFile(form, "output.wav", path.join(outputDir, "output.wav"), true);
    const stdout = await writeFormFile(form, "applio-infer-stdout.log", path.join(logsDir, "applio-infer-stdout.log"), false);
    const stderr = await writeFormFile(form, "applio-infer-stderr.log", path.join(logsDir, "applio-infer-stderr.log"), false);
    const command = await writeFormFile(form, "applio-infer-command.json", path.join(logsDir, "applio-infer-command.json"), false);

    await writeOptionalText(form, "stdoutText", path.join(logsDir, "applio-infer-stdout.log"));
    await writeOptionalText(form, "stderrText", path.join(logsDir, "applio-infer-stderr.log"));
    await writeOptionalText(form, "commandJson", path.join(logsDir, "applio-infer-command.json"));

    const outputAudioUrl = `/api/characters/applio-inference/file?owner=${encodeURIComponent(ownerKey)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(jobId)}`;

    return NextResponse.json({
      ok: true,
      ownerKey,
      characterId,
      jobId,
      outputAudioPath: output?.path,
      outputAudioUrl,
      outputBytes: output?.bytes || 0,
      outputDir,
      logsPath: logsDir,
      stdoutPath: stdout?.path || path.join(logsDir, "applio-infer-stdout.log"),
      stderrPath: stderr?.path || path.join(logsDir, "applio-infer-stderr.log"),
      commandPath: command?.path || path.join(logsDir, "applio-infer-command.json"),
    }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError(error instanceof Error ? error.message : "Could not upload Applio inference result.", 500);
  }
}