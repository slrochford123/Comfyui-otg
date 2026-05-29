import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext } from "@/lib/ownerKey";
import { deviceGalleryDir, userGalleryDir } from "@/lib/paths";
import {
  ensureGalleryMetaForFile,
  isMediaFile,
  safeGalleryName,
} from "@/lib/gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req) as any;
    const ownerKey = String(owner?.ownerKey || owner?.key || "").trim();

    if (!ownerKey) {
      return NextResponse.json(
        { ok: false, error: "Missing ownerKey" },
        { status: 400 }
      );
    }

    const dirs: string[] = [];
    if (owner?.username) dirs.push(userGalleryDir(owner.username));
    if (owner?.deviceId) dirs.push(deviceGalleryDir(owner.deviceId));

    let scanned = 0;
    let repaired = 0;
    const touched: string[] = [];

    for (const dir of dirs) {
      if (!dir || !fs.existsSync(dir)) continue;

      for (const entry of fs.readdirSync(dir)) {
        if (!isMediaFile(entry)) continue;
        scanned += 1;

        const absPath = path.join(dir, entry);
        const metaPath = `${absPath}.meta.json`;

        if (fs.existsSync(metaPath)) continue;

        ensureGalleryMetaForFile(absPath, {
          originalName: entry,
          renamedName:
            safeGalleryName(path.basename(entry, path.extname(entry))) +
            path.extname(entry),
          positivePrompt: null,
          negativePrompt: null,
          submitPayload: null,
          workflowId: null,
          workflowTitle: null,
          sourcePromptId: null,
        });

        repaired += 1;
        touched.push(absPath);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      repaired,
      touched,
      note: "repair-meta now avoids owner-global content_state prompt reuse",
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "repair-meta failed" },
      { status: 400 }
    );
  }
}
