import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { deviceGalleryDir, userGalleryDir, ensureDir } from "@/lib/paths";
import { readState, writeState } from "@/lib/contentState";

export const runtime = "nodejs";

function safeBaseName(name: string) {
  return path.basename(name || "");
}

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
    return NextResponse.json({ ok: false, error: e?.message || "Auth failed" }, { status: 500 });
  }
  const state = readState(ownerKey);

  if (state.status !== "done" || !state.fileName) {
    return NextResponse.json({ ok: false, error: "No ready content to favorite." }, { status: 409 });
  }

  const srcDir = username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
  const favRoot = path.join(process.cwd(), "data", username ? "user_favorites" : "device_favorites");
  const favDir = username ? path.join(favRoot, username) : path.join(favRoot, deviceId);

  ensureDir(srcDir);
  ensureDir(favDir);

  const name = safeBaseName(state.fileName);
  const src = path.join(srcDir, name);
  const dst = path.join(favDir, name);

  if (!fs.existsSync(src)) {
    return NextResponse.json({ ok: false, error: "Active file not found." }, { status: 404 });
  }

  try {
    fs.copyFileSync(src, dst);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Copy failed" }, { status: 500 });
  }

  writeState(ownerKey, { favorited: true });

  return NextResponse.json({
    ok: true,
    scope,
    ownerKey,
    username: username || null,
    deviceId,
    favorited: true,
    favorite: { name, url: `/api/favorites/file?name=${encodeURIComponent(name)}` },
  });
}
