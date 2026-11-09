import { NextRequest } from "next/server";
import {
  authorize,
  studio,
  json,
  failure,
} from "@/lib/productionStudio/server";
import { upload } from "@/lib/productionStudio/media";
import { StudioError } from "@/lib/productionStudio/store";
import { bootstrapStudioWorker } from "@/lib/productionStudio/jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  req: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const u = await authorize(req, true),
      { id } = await c.params;
    studio().get(u.ownerKey, id);
    if (Number(req.headers.get("content-length")) > 513 * 1024 * 1024)
      throw new StudioError("Upload too large.", 413);
    const form = await req.formData(),
      file = form.get("file");
    if (!(file instanceof File)) throw new StudioError("Choose a file.");
    const asset = await upload(studio(), u.ownerKey, id, file);
    if (asset.kind === "video") {
      studio().enqueue(
        u.ownerKey,
        id,
        "proxy",
        { assetId: asset.id },
        `proxy-${asset.id}`,
      );
      bootstrapStudioWorker();
    }
    return json({ asset }, 201);
  } catch (e) {
    return failure(e);
  }
}
