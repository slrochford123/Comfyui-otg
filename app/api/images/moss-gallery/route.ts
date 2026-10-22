import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, writeMetaForFile } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";
import { mossTarget, MossInputError } from "@/lib/images/mossImage";

export const runtime = "nodejs";
const origins = new Set(["character", "freeform-character", "background", "asset"]);
export async function POST(request: NextRequest) {
  try {
    const { owner, sources } = await getGallerySourcesForRequest(request);
    const form = await request.formData();
    const image = form.get("image"), origin = String(form.get("origin") || ""), promptId = String(form.get("promptId") || "");
    if (!(image instanceof File) || image.size < 1 || image.size > 16 * 1024 * 1024 || !origins.has(origin) || !/^[a-f0-9-]{36}$/i.test(promptId)) {
      return NextResponse.json({ error: "A valid MOSS image, originating surface and prompt ID are required." }, { status: 400 });
    }
    const target = mossTarget(form.get("gpuTarget"));
    const bytes = Buffer.from(await image.arrayBuffer());
    let metadata;
    try { metadata = await sharp(bytes, { limitInputPixels: 4194304 }).metadata(); }
    catch { return NextResponse.json({ error: "The MOSS result is not a supported image." }, { status: 400 }); }
    if (metadata.format !== "png") return NextResponse.json({ error: "Choose the original PNG MOSS result." }, { status: 400 });
    const source = sources[0];
    fs.mkdirSync(source.dir, { recursive: true });
    // One durable Gallery record per owner's actual candidate, including repeated taps.
    const name = `MOSS_${origin}_${promptId}.png`, file = path.join(source.dir, name);
    try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error: any) { if (error.code !== "EEXIST") throw error; }
    writeMetaForFile(file, {
      sourceType: `moss-${origin}`, requestKind: "moss-explicit-gallery-save", sourcePromptId: promptId,
      workflowId: "moss-image-sft", workflowTitle: "MOSS-Image SFT (INT8)", mediaCategory: "generated-image",
      positivePrompt: String(form.get("prompt") || "").slice(0, 20000),
      submitPayload: { model: "moss-image-sft", gpuTarget: target, origin, width: metadata.width, height: metadata.height, seed: String(form.get("seed") || "") },
      ownerKey: owner.ownerKey, username: owner.username, deviceId: owner.deviceId,
    }, source);
    return NextResponse.json({ ok: true, name, url: `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${source.scope}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SessionInvalidError ? 401 : error instanceof MossInputError ? 400 : 500;
    return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 400 ? (error as Error).message : "Could not save this MOSS result to Gallery." }, { status });
  }
}
