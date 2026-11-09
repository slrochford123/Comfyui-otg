import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import {
  authorize,
  body,
  studio,
  json,
  failure,
} from "@/lib/productionStudio/server";
import { assertAssetIntact } from "@/lib/productionStudio/media";
import { StudioError } from "@/lib/productionStudio/store";
import { userGalleryDir } from "@/lib/paths";
import { writeMetaForFile, clearGalleryListCache } from "@/lib/gallery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  req: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const u = await authorize(req, true),
      { id } = await c.params,
      b = await body(req),
      entry = await assertAssetIntact(
        studio(),
        u.ownerKey,
        id,
        String(b.assetId),
      );
    if (!["image", "video"].includes(entry.asset.kind))
      throw new StudioError(
        "Only pictures and videos can be saved to the Gallery.",
      );
    const name = `production-${id.slice(0, 8)}-${entry.asset.id}${path.extname(entry.path)}`,
      file = path.join(userGalleryDir(u.ownerKey), name);
    try {
      await fs.copyFile(entry.path, file, constants.COPYFILE_EXCL);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    writeMetaForFile(file, {
      ownerKey: u.ownerKey,
      username: u.username,
      deviceId: u.deviceId,
      originalName: entry.asset.name,
      renamedName: entry.asset.name,
      sourceType: "production-studio",
      workflowTitle: "Production v.2",
      createdAt: Date.now(),
    });
    clearGalleryListCache();
    return json({ saved: true, name });
  } catch (e) {
    return failure(e);
  }
}
