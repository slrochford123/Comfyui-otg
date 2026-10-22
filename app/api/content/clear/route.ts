import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readState, resetState } from "@/lib/contentState";

export const runtime = "nodejs";

/**
 * Clear current preview + unlock the pipeline.
 *
 * Behavior:
 * - If state is DONE with a file, preserve the file and reset only pipeline state.
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

  // Recovery is intentionally non-destructive. Gallery cleanup belongs to an
  // explicit Gallery action, never to Settings recovery.
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
      deleted: [],
      preserved: state.fileName ? [state.fileName] : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
