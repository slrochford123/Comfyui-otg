import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { mediaFileResponse } from "@/lib/mediaResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataRoot() {
  return path.resolve(String(process.env.OTG_DATA_DIR || path.join(process.cwd(), "data")));
}

function isSafeSegment(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(trimmed);
}

function jsonError(error: string, status = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function resolvePreviewFilePath(req: NextRequest): { ok: true; filePath: string; fileName: string } | { ok: false; error: string; status: number } {
  const owner = String(req.nextUrl.searchParams.get("owner") || "").trim();
  const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
  const file = String(req.nextUrl.searchParams.get("file") || "final.mp4").trim();

  if (!isSafeSegment(owner)) return { ok: false, error: "Invalid owner.", status: 400 };
  if (!isSafeSegment(characterId)) return { ok: false, error: "Invalid characterId.", status: 400 };
  if (!isSafeSegment(jobId)) return { ok: false, error: "Invalid jobId.", status: 400 };
  if (!["final.mp4", "dubbed-preview.mp4", "model-spin.mp4", "raw-preview.mp4", "model-spin.mp4", "dubbed-audio.wav", "dubbed.wav", "guide.wav"].includes(file)) {
    return { ok: false, error: "Invalid character preview file.", status: 400 };
  }

  const root = dataRoot();
  const previewRoot = path.join(root, "characters", owner, "character-preview");
  const filePath = path.resolve(path.join(previewRoot, characterId, jobId, file));
  if (!filePath.startsWith(path.resolve(previewRoot) + path.sep)) {
    return { ok: false, error: "Invalid character preview file path.", status: 400 };
  }
  return { ok: true, filePath, fileName: file };
}

async function servePreviewFile(req: NextRequest, method: "GET" | "HEAD") {
  const resolved = resolvePreviewFilePath(req);
  if (!resolved.ok) return jsonError(resolved.error, resolved.status);
  if (!(await fileExists(resolved.filePath))) return jsonError("Character preview file not found.", 404);

  const contentType = resolved.fileName.endsWith(".wav") ? "audio/wav" : "video/mp4";
  const response = mediaFileResponse(req, resolved.filePath, {
    method,
    contentType,
    download: req.nextUrl.searchParams.get("download") === "1",
    fileName: resolved.fileName,
    cacheControl: "private, no-store",
  });
  response.headers.set("X-OTG-Character-Preview-File", "1");
  return response;
}

export async function GET(req: NextRequest) {
  return servePreviewFile(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return servePreviewFile(req, "HEAD");
}

