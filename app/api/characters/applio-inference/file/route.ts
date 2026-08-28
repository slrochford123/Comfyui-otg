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
  if (!trimmed) return false;
  if (trimmed.includes("..")) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
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

function resolveInferenceOutputPath(req: NextRequest): { ok: true; outputPath: string } | { ok: false; error: string; status: number } {
  const owner = String(req.nextUrl.searchParams.get("owner") || "").trim();
  const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();

  if (!isSafeSegment(owner)) return { ok: false, error: "Invalid owner.", status: 400 };
  if (!isSafeSegment(characterId)) return { ok: false, error: "Invalid characterId.", status: 400 };
  if (!isSafeSegment(jobId)) return { ok: false, error: "Invalid jobId.", status: 400 };

  const root = dataRoot();
  const inferenceRoot = path.join(root, "characters", owner, "applio-inference");
  const outputPath = path.resolve(path.join(inferenceRoot, characterId, jobId, "output.wav"));
  if (!outputPath.startsWith(path.resolve(inferenceRoot) + path.sep)) {
    return { ok: false, error: "Invalid Applio inference output path.", status: 400 };
  }
  return { ok: true, outputPath };
}

async function serveInferenceOutput(req: NextRequest, method: "GET" | "HEAD") {
  const resolved = resolveInferenceOutputPath(req);
  if (!resolved.ok) return jsonError(resolved.error, resolved.status);
  if (!(await fileExists(resolved.outputPath))) return jsonError("Applio inference output not found.", 404);

  const response = mediaFileResponse(req, resolved.outputPath, {
    method,
    contentType: "audio/wav",
    download: req.nextUrl.searchParams.get("download") === "1",
    fileName: "output.wav",
    cacheControl: "private, no-store",
  });
  response.headers.set("X-OTG-Applio-Inference-File", "1");
  return response;
}

export async function GET(req: NextRequest) {
  return serveInferenceOutput(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return serveInferenceOutput(req, "HEAD");
}
