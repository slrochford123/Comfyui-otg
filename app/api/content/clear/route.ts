import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { deviceGalleryDir, userGalleryDir } from "@/lib/paths";
import { readState, resetState } from "@/lib/contentState";

export const runtime = "nodejs";

function safeBaseName(name: string) {
  return path.basename(name || "");
}

function comfyOutputDirs(): string[] {
  const env = (process.env.COMFY_OUTPUT_DIRS || process.env.COMFY_OUTPUT_DIR || "").trim();
  const dirs = env
    .split(/[;\n\r]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  // fallback common locations
  if (!dirs.length) {
    dirs.push(path.join(process.cwd(), "ComfyUI", "output"));
    dirs.push(path.join(process.cwd(), "output"));
  }
  return Array.from(new Set(dirs));
}

/**
 * Clear current preview + unlock the pipeline.
 *
 * Behavior:
 * - If state is DONE with a file, we delete that file (best-effort) from OTG temp + Comfy output dirs, then reset state.
 * - If state is RUNNING, we DO NOT try to cancel the upstream job (ComfyUI doesn't support reliable cancellation here),
 *   but we DO reset OTG state so the UI isn't stuck locked.
 * - If state is EMPTY, we just return ok.
 */
export async function POST(req: NextRequest) {
  let deviceId: string;
  let ownerKey: string;
  let username: string | null;
  let scope: "user" | "device";
  try {
    ({ deviceId, ownerKey, username, scope } = await getOwnerContext(req));
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const state = readState(ownerKey);

  // If a generation is running, unlock immediately.
  if (state.status === "running") {
    resetState(ownerKey);
    return NextResponse.json(
      { ok: true, scope, ownerKey, username: username || null, deviceId, cleared: true, unlocked: true, deleted: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Nothing to clear.
  // The state machine used by OTG uses: "idle" | "running" | "done" | "error".
  // Only a completed (done) run should have a stable fileName to clean up.
  if (state.status !== "done" || !state.fileName) {
    // Still reset to be safe (covers stale/bad state)
    resetState(ownerKey);
    return NextResponse.json(
      { ok: true, scope, ownerKey, username: username || null, deviceId, cleared: true, unlocked: true, deleted: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const name = safeBaseName(state.fileName);
  const tempDir = username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
  const tempPath = path.join(tempDir, name);

  const deleted: string[] = [];
  const failed: { path: string; error: string }[] = [];

  // 1) delete from OTG temp gallery (best-effort)
  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
      deleted.push(tempPath);
    }
  } catch (e: any) {
    failed.push({ path: tempPath, error: e?.message || "unlink failed" });
  }

  // 2) best-effort delete from ComfyUI shared output dirs
  for (const dir of comfyOutputDirs()) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deleted.push(p);
      }
    } catch (e: any) {
      failed.push({ path: p, error: e?.message || "unlink failed" });
    }
  }

  // 3) reset state (favorites copy remains untouched)
  resetState(ownerKey);

  return NextResponse.json(
    {
      ok: true,
      scope,
      ownerKey,
      username: username || null,
      deviceId,
      cleared: true,
      unlocked: true,
      deleted,
      failed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
