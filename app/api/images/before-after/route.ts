import {NextRequest, NextResponse} from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {withOwner, RequestError} from "@/lib/routeSecurity";
import {limitedFormData} from "@/lib/limitedRequestBody";
import {claimBeforeAfterJob, readBeforeAfterJob, writeBeforeAfterJob, publicBeforeAfterJob, type BeforeAfterJob} from "@/lib/images/beforeAfter";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {ownedHistoryImage, ownedPromptMeta, proxyOwnedWorkerMedia} from "@/lib/comfyMediaAccess";
import {getGallerySourcesForRequest, writeMetaForFile, clearGalleryListCache} from "@/lib/gallery";
import {getMediaQueueJob} from "@/lib/workers/mediaGpuQueue";
import {resolveComfyPromptImageStatus} from "@/lib/comfyImageOutputLookup";
import {POST as submitNative, GET as readNative, PATCH as saveNative} from "@/app/api/images/native/route";
import {POST as submitQwen} from "@/app/api/comfy/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function internalRequest(req: NextRequest, endpoint: string, method = "GET", body?: FormData) {
  const headers = new Headers(req.headers);
  headers.delete("content-length"); headers.delete("content-type"); headers.delete("range");
  // Do not tie accepted GPU work to the browser's upload connection lifetime.
  return new NextRequest(new URL(endpoint, req.url), {method, headers, body});
}
export const POST = withOwner(async (req, owner) => {
  const form = await limitedFormData(req, 65 * 1024 * 1024);
  const id = String(form.get("clientRequestId") || ""), engine = String(form.get("engine") || "");
  const prompt = String(form.get("prompt") || "").trim(), seed = Number(form.get("seed"));
  if (!["qwen", "fibo2-edit-turbo", "fibo2-dev"].includes(engine)) throw new RequestError("Choose an image edit model.", 400);
  if (!prompt || prompt.length > 12_000 || !Number.isSafeInteger(seed) || seed < 0) throw new RequestError("Enter a prompt and a valid seed.", 400);
  const image = form.get("image");
  if (!(image instanceof File) || !image.size || image.size > 64 * 1024 * 1024) throw new RequestError("Choose a source image up to 64 MB.", 400);
  let bytes: Buffer;
  // Keep the untouched original in the comparison session. Only the inference
  // copy is rotated and proportionally reduced, so high-resolution phone photos
  // do not hit the native editor's 16-MP decoder or waste shared GPU memory.
  try { bytes = await sharp(Buffer.from(await image.arrayBuffer()), {limitInputPixels: 268_402_689, animated: false}).rotate()
    .resize({width: 1536, height: 1536, fit: "inside", withoutEnlargement: true}).png().toBuffer(); }
  catch { throw new RequestError("That image could not be decoded safely. Try exporting it as JPEG or PNG.", 400); }
  const job: BeforeAfterJob = {id, engine: engine as BeforeAfterJob["engine"], prompt, seed, createdAt: new Date().toISOString(), status: "submitting"};
  if (!await claimBeforeAfterJob(owner.ownerKey, job)) return NextResponse.json(publicBeforeAfterJob(await readBeforeAfterJob(owner.ownerKey, id)), {status: 202});
  const body = new FormData();
  body.set("prompt", prompt); body.set("positivePrompt", prompt); body.set("seed", String(seed));
  body.set("saveToGallery", "false"); body.set("save_to_gallery", "false");
  // Qwen's canonical uploader uses overwrite=true. A per-owner/per-job name is
  // essential: another queued edit must never replace this job's source file.
  const source = new File([new Uint8Array(bytes)], `before-after-${safeSegment(owner.ownerKey)}-${id}.png`, {type: "image/png"});
  if (engine === "qwen") {
    body.set("workflowId", "presets/image_qwen_image_2_1_image_edit");
    body.set("requestKind", "generate-qwen21-image-edit"); body.set("sourceType", "image-edit"); body.set("imageA", source);
  } else { body.set("model", engine); body.set("clientRequestId", id); body.set("image", source); }
  try {
    const response = engine === "qwen" ? await submitQwen(internalRequest(req, "/api/comfy", "POST", body))
      : await submitNative(internalRequest(req, "/api/images/native", "POST", body));
    const accepted = await response.json();
    // The canonical Qwen route chooses its own fresh execution seed. Keep the
    // actual seed, not the client's requested value, for retry/provenance.
    if (engine === "qwen" && Number.isSafeInteger(accepted.qwenTurbo?.seed)) job.seed = accepted.qwenTurbo.seed;
    job.promptId = String(accepted.prompt_id || accepted.promptId || "") || undefined;
    if (!response.ok) {
      job.status = response.status >= 500 ? "unknown" : "failed";
      job.error = String(accepted.error || "The edit was not accepted.");
    } else job.status = job.promptId ? "queued" : "unknown";
  } catch {
    job.status = "unknown"; job.error = "Submission needs checking. The same job will be checked; it will not be resubmitted.";
  }
  await writeBeforeAfterJob(owner.ownerKey, job);
  return NextResponse.json(publicBeforeAfterJob(job), {status: 202});
});

async function reconcile(req: NextRequest, ownerKey: string, job: BeforeAfterJob) {
  if (job.imagePath || ["failed", "canceled"].includes(job.status)) return job;
  if (job.engine !== "qwen") {
    const response = await readNative(internalRequest(req, `/api/images/native?jobId=${job.id}`));
    if (response.status === 404) return job;
    const native = await response.json();
    if (!response.ok) throw new RequestError(String(native.error || "Unable to check this edit."), response.status);
    job.status = native.status; job.promptId = native.promptId || job.promptId; job.error = native.error;
    if (native.status === "completed" && native.serverPath) job.imagePath = native.serverPath;
  } else if (job.promptId) {
    const meta = ownedPromptMeta(ownerKey, job.promptId), queue = getMediaQueueJob(job.promptId);
    if (queue && ["failed", "canceled", "unknown"].includes(queue.status)) { job.status = queue.status; job.error = queue.error || undefined; }
    else {
      const status = await resolveComfyPromptImageStatus({promptId: job.promptId, preferredBaseUrl: meta.comfyBaseUrl || undefined, strictPreferred: true, filters: {nodeId: "461"}});
      if (status.status === "completed") {
        const result = await ownedHistoryImage(ownerKey, job.promptId, {nodeId: "461"});
        const image = await proxyOwnedWorkerMedia(internalRequest(req, "/api/images/before-after"), result.baseUrl, result.image);
        if (!image.ok) throw new RequestError("The completed edit could not be retrieved. Check again.", 503);
        const bytes = await sharp(Buffer.from(await image.arrayBuffer()), {limitInputPixels: 16_777_216}).png().toBuffer();
        const output = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(ownerKey), `before-after-${job.id}.png`);
        await fs.mkdir(path.dirname(output), {recursive: true, mode: 0o700});
        await fs.writeFile(output, bytes, {mode: 0o600});
        job.imagePath = output; job.status = "completed";
      } else if (["failed", "missing_output"].includes(status.status)) { job.status = "failed"; job.error = status.error; }
      else job.status = status.status === "running" ? "running" : "queued";
    }
  } else return job; // A pending GET must not overwrite POST's newly confirmed prompt ID.
  await writeBeforeAfterJob(ownerKey, job);
  return job;
}
export const GET = withOwner(async (req, owner) => {
  const job = await reconcile(req, owner.ownerKey, await readBeforeAfterJob(owner.ownerKey, req.nextUrl.searchParams.get("jobId") || ""));
  if (req.nextUrl.searchParams.get("image") === "1") {
    if (!job.imagePath) throw new RequestError("The edited image is not ready.", 404);
    return new NextResponse(new Uint8Array(await fs.readFile(job.imagePath)), {headers: {"Content-Type": "image/png", "Content-Disposition": `${req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="before-after-${job.id}.png"`}});
  }
  return NextResponse.json(publicBeforeAfterJob(job));
});
export const PATCH = withOwner(async (req, owner) => {
  const job = await reconcile(req, owner.ownerKey, await readBeforeAfterJob(owner.ownerKey, req.nextUrl.searchParams.get("jobId") || ""));
  if (job.status !== "completed" || !job.imagePath) throw new RequestError("Wait for the edit to finish before saving.", 409);
  if (job.engine !== "qwen") return saveNative(internalRequest(req, `/api/images/native?jobId=${job.id}`, "PATCH"));
  const {sources} = await getGallerySourcesForRequest(req), source = sources[0];
  if (!source) throw new RequestError("No gallery is available for this account.", 409);
  const name = `before-after-${job.id}.png`, output = path.join(source.dir, name);
  await fs.mkdir(source.dir, {recursive: true}); await fs.copyFile(job.imagePath, output);
  writeMetaForFile(output, {sourceType: "before-after", positivePrompt: job.prompt, sourcePromptId: job.promptId,
    workflowId: "presets/image_qwen_image_2_1_image_edit", ownerKey: owner.ownerKey,
    submitPayload: {seed: job.seed, model: job.engine}}, source);
  clearGalleryListCache();
  return NextResponse.json({ok: true, name, url: `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${source.scope}`});
});
