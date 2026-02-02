import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { resetState } from "@/lib/contentState";
import { deviceGalleryDir, userGalleryDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function clearDirFiles(dir: string) {
  if (!dir) return;
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) fs.unlinkSync(p);
    } catch {
      // ignore per-file errors
    }
  }
}

// Hard reset the current user's content state.
// Used to recover from stuck/"ready but missing file" states.
// ALSO clears the user's gallery folder (NOT favorites).
export async function POST(req: NextRequest) {
  let ownerKey: string;
  let deviceId: string;
  let username: string | null;

  try {
    ({ ownerKey, deviceId, username } = await getOwnerContext(req));
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Auth failed" }, { status: 500 });
  }

  // Clear gallery files for this owner
  try {
    const dir = username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
    clearDirFiles(dir);
  } catch {
    // ignore
  }

  // Reset in-memory/content state
  const next = resetState(ownerKey);

  return NextResponse.json(
    { ok: true, ownerKey, status: next.status, clearedGallery: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
