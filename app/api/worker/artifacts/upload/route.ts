import fs from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import { getQueuedContractJob } from "@/lib/jobs/voicePipelineJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WORKER_ARTIFACT_BYTES = Number(process.env.OTG_WORKER_ARTIFACT_MAX_BYTES || 1024 * 1024 * 1024);

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

function isSafeSegment(value: string): boolean {
  return !!value && /^[a-zA-Z0-9._-]+$/.test(value) && !value.includes("..");
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value === "object" && typeof (value as File).arrayBuffer === "function";
}

function safeUploadName(name: string, fallback: string): string {
  const base = path.basename(cleanString(name) || fallback).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  return base && base !== "." && base !== ".." ? base : fallback;
}

async function writeFileAtomic(filePath: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, filePath);
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const ownerKey = workerOwnerKey(req, owner.ownerKey);
    const form = await req.formData();
    const jobId = cleanString(form.get("jobId"));

    if (!isSafeSegment(ownerKey)) return jsonError("Invalid owner key.", 400);
    if (!isSafeSegment(jobId)) return jsonError("Invalid or missing jobId.", 400);

    const job = getQueuedContractJob(ownerKey, jobId);
    if (!job) return jsonError("Job not found.", 404);

    const root = path.join(OTG_DATA_ROOT, "worker-artifacts", ownerKey, jobId);
    ensureDir(root);

    const artifacts: Array<{ field: string; fileName: string; path: string; bytes: number }> = [];
    for (const [field, value] of form.entries()) {
      if (!isUploadFile(value)) continue;
      const fileName = safeUploadName(value.name, `${cleanString(field) || "artifact"}.bin`);
      const bytes = Buffer.from(await value.arrayBuffer());
      if (bytes.length <= 0) return jsonError(`Uploaded artifact is empty: ${fileName}`, 400);
      if (bytes.length > MAX_WORKER_ARTIFACT_BYTES) return jsonError(`Uploaded artifact is too large: ${fileName}`, 413);

      const filePath = path.join(root, fileName);
      await writeFileAtomic(filePath, bytes);
      artifacts.push({ field, fileName, path: filePath, bytes: bytes.length });
    }

    if (!artifacts.length) return jsonError("No artifact files were uploaded.", 400);

    return NextResponse.json({ ok: true, ownerKey, jobId, artifacts }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError(
      error instanceof Error ? error.message : "Could not upload worker artifact.",
      500,
    );
  }
}

