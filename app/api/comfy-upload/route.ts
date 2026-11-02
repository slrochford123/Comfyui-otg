import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { configuredImageComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { limitedFormData } from "@/lib/limitedRequestBody";
import { withOwner, RequestError } from "@/lib/routeSecurity";
import { recordOwnedWorkerMedia } from "@/lib/comfyMediaAccess";
import sharp from "sharp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withOwner(async (request, owner) => {
  const form = await limitedFormData(request, 32 * 1024 * 1024);
  const file = form.get("image");
  if (!(file instanceof File) || !file.size) throw new RequestError("Choose an image.", 400);
  const ext = path.extname(file.name).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) throw new RequestError("Unsupported image type.", 400);
  try { await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).metadata(); }
  catch { throw new RequestError("Choose a valid image within the 40 megapixel limit.", 400); }
  const name = "otg-" + createHash("sha256").update(owner.ownerKey).digest("hex").slice(0,16) + "-" + randomUUID() + ext;
  const outgoing = new FormData();
  outgoing.set("image", file, name);
  outgoing.set("type", "input");
  outgoing.set("overwrite", "false");
  const response = await fetch(configuredImageComfyBaseUrl() + "/upload/image", {
    method: "POST", body: outgoing, signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok) throw new RequestError("The image worker could not accept the upload. Please retry.", 502);
  const result = await response.json();
  if (typeof result.name !== "string") throw new RequestError("The worker did not confirm the uploaded image.", 502);
  await recordOwnedWorkerMedia(owner.ownerKey, configuredImageComfyBaseUrl(), { filename: result.name, subfolder: result.subfolder || "", type: "input" });
  return NextResponse.json(result);
});
