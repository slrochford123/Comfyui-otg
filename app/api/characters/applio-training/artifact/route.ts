import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { resolveApplioTrainingArtifactPath } from "@/lib/jobs/applioTrainingArtifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const owner = String(req.nextUrl.searchParams.get("owner") || "").trim();
  const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();

  if (!isSafeSegment(owner)) return jsonError("Invalid owner.", 400);
  if (!isSafeSegment(characterId)) return jsonError("Invalid characterId.", 400);
  if (!isSafeSegment(jobId)) return jsonError("Invalid jobId.", 400);

  try {
    const artifactPath = resolveApplioTrainingArtifactPath(owner, characterId, jobId);
    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    return NextResponse.json(
      { ok: true, artifact },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return jsonError("Applio training artifact not found.", 404);
  }
}
