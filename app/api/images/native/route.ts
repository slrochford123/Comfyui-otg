import {NextRequest, NextResponse} from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {randomInt, randomUUID} from "node:crypto";
import sharp from "sharp";
import {getOwnerContext} from "@/lib/ownerKey";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {buildNativeImageGraph, isNativeImageModel, nativeImageEditDimensions, NATIVE_IMAGE_MODELS, type NativeImageModel} from "@/lib/images/nativeImageModels";
import {chooseNativeImageBackend} from "@/lib/images/nativeImageBackend";
import {submitComfyPromptWithGpuLease} from "@/lib/workers/comfyPromptLease";
import {getMediaQueueJob} from "@/lib/workers/mediaGpuQueue";
import {resolveComfyPromptImageStatus} from "@/lib/comfyImageOutputLookup";
import {GET as ownedFile} from "@/app/api/file/route";
import {writePromptRequestMeta} from "@/lib/promptRequestMeta";
import {cancelComfyPrompt} from "@/lib/comfySafeCancel";
import {getGallerySourcesForRequest, writeMetaForFile} from "@/lib/gallery";
import {privateMediaEnvironmentEnabled} from "@/lib/privateMediaRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Job = {id: string; model: NativeImageModel; status: string; promptId?: string; baseUrl?: string;
  width: number; height: number; seed: number; createdAt: string; error?: string; imagePath?: string; prompt?: string};
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
function fileFor(owner: string, id: string) {
  if (!validId(id)) throw Object.assign(Error("Invalid image job id."), {status: 400});
  return path.join(OTG_DATA_ROOT, "native-image-jobs", safeSegment(owner), id + ".json");
}
async function writeJob(file: string, job: Job) {
  const temporary = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(job), {mode: 0o600});
  await fs.rename(temporary, file);
}
function publicJob(job: Job) {
  return {ok: true, jobId: job.id, promptId: job.promptId, prompt_id: job.promptId,
    status: job.status, model: job.model, modelLabel: NATIVE_IMAGE_MODELS[job.model].label,
    steps: NATIVE_IMAGE_MODELS[job.model].steps, width: job.width, height: job.height, seed: job.seed,
    error: job.error, outputNodeId: "461", comfyBaseUrl: job.baseUrl,
    ...(job.imagePath ? {serverPath: job.imagePath, imageUrl: `/api/images/native?jobId=${job.id}&image=1`} : {})};
}
function failure(error: unknown) {
  const e = error as Error & {status?: number; code?: string};
  return NextResponse.json({ok: false, error: e.message || "Image operation failed."},
    {status: e.status || 502, headers: {"Cache-Control": "no-store"}});
}
function assertNativeImagesEnabled() {
  if (!privateMediaEnvironmentEnabled()) throw Object.assign(Error("Native image tools require the configured private-research media environment."), {status: 404});
}
export async function POST(req: NextRequest) {
  let job: Job | undefined, file: string | undefined;
  try {
    assertNativeImagesEnabled();
    const owner = await getOwnerContext(req);
    const multipart = req.headers.get("content-type")?.includes("multipart/form-data");
    const form = multipart ? await req.formData() : null;
    const body = form ? Object.fromEntries(form) : await req.json();
    if (!isNativeImageModel(body.model)) throw Object.assign(Error("Choose a supported local image model."), {status: 400});
    const model: NativeImageModel = body.model;
    if (["imageB", "imageC", "imageBPath", "imageCPath", "referenceImages"].some(key => body[key])) {
      throw Object.assign(Error("This local image editor is verified with one source image. Use Qwen for multiple references; none have been discarded."), {status: 400});
    }
    const prompt = String(body.prompt || body.positivePrompt || "").trim();
    if (!prompt || prompt.length > 12_000) throw Object.assign(Error("Enter a prompt of 1–12000 characters."), {status: 400});
    let width = Number(body.width || 1024), height = Number(body.height || 1024);
    const seed = body.seed === undefined || body.seed === "" ? randomInt(0, 2 ** 48 - 1) : Number(body.seed);
    let source: Buffer | undefined;
    const image = form?.get("image");
    if (image instanceof File && image.size) {
      if (image.size > 20 * 1024 * 1024) throw Object.assign(Error("Source image must be at most 20 MB."), {status: 400});
      source = Buffer.from(await image.arrayBuffer());
    } else if (body.imageAPath) {
      // Reuse the existing authenticated, realpath/owner-scoped media resolver.
      // Never read an arbitrary browser-supplied filesystem path directly.
      const response = await ownedFile(new NextRequest(new URL(`/api/file?path=${encodeURIComponent(String(body.imageAPath))}`, req.url), {headers: req.headers}));
      if (!response.ok) throw Object.assign(Error("The source image is not accessible to this account."), {status: 403});
      if (Number(response.headers.get("content-length") || 0) > 20 * 1024 * 1024) throw Object.assign(Error("Source image is too large."), {status: 400});
      source = Buffer.from(await response.arrayBuffer());
    }
    if (source) {
      if (source.length > 20 * 1024 * 1024) throw Object.assign(Error("Source image is too large."), {status: 400});
      try { source = await sharp(source, {limitInputPixels: 16_777_216, animated: false}).rotate().png().toBuffer(); }
      catch { throw Object.assign(Error("The source must be a valid still image, up to 16 megapixels."), {status: 400}); }
      if (!body.width && !body.height) {
        const metadata = await sharp(source).metadata();
        ({width, height} = nativeImageEditDimensions(metadata.width!, metadata.height!));
      }
    }
    // Validate semantics and dimensions before claiming a request or uploading.
    try {buildNativeImageGraph({model, prompt, width, height, seed, image: source ? "pending.png" : undefined});}
    catch (error) {throw Object.assign(error as Error, {status: 400});}
    const id = String(body.clientRequestId || randomUUID());
    file = fileFor(owner.ownerKey, id);
    await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    job = {id, model, status: "preparing", width, height, seed, prompt, createdAt: new Date().toISOString()};
    try { await fs.writeFile(file, JSON.stringify(job), {flag: "wx", mode: 0o600}); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return NextResponse.json(publicJob(JSON.parse(await fs.readFile(file, "utf8"))), {status: 202});
    }
    const backend = await chooseNativeImageBackend(model);
    job.baseUrl = backend.baseUrl;
    let name: string | undefined;
    if (source) {
      const upload = new FormData();
      upload.set("image", new File([new Uint8Array(source)], `slr-native-${id}.png`, {type: "image/png"}));
      upload.set("overwrite", "false");
      const response = await fetch(backend.baseUrl + "/upload/image", {method: "POST", body: upload, signal: AbortSignal.timeout(30_000)});
      const uploaded = await response.json();
      if (!response.ok || !uploaded.name) throw Error("ComfyUI did not accept the source image.");
      name = [uploaded.subfolder, uploaded.name].filter(Boolean).join("/");
    }
    const graph = buildNativeImageGraph({model, prompt, negativePrompt: String(body.negativePrompt || ""), width, height, seed, image: name});
    graph["461"].inputs.filename_prefix = `SLR_TEST_Images/${safeSegment(owner.ownerKey)}/${id}`;
    job.status = "submitting";
    await writeJob(file, job);
    const response = await submitComfyPromptWithGpuLease({
      baseUrl: backend.baseUrl, workerId: "api-characters-native-image", purpose: "image", mediaQueueScope: true,
      init: {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({prompt: graph, client_id: id})},
      onPromptAccepted: async promptId => {
        job!.promptId = promptId; job!.status = "queued";
        writePromptRequestMeta(owner.ownerKey, promptId, {comfyBaseUrl: backend.baseUrl, workflowId: `native/${model}`,
          workflowLabel: NATIVE_IMAGE_MODELS[model].label, requestKind: "native-image", positivePrompt: prompt, username: owner.username, deviceId: owner.deviceId});
        await writeJob(file!, job!);
      },
    });
    const accepted = await response.json();
    if (!response.ok || !accepted.prompt_id) throw Error(JSON.stringify(accepted.error || accepted.node_errors || "Image submission failed."));
    job.promptId = accepted.prompt_id;
    job.status = "queued";
    await writeJob(file, job);
    return NextResponse.json(publicJob(job), {status: 202, headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    if (job && file) {
      job.status = job.promptId || job.status === "submitting" ? "unknown" : "failed";
      job.error = String((error as Error).message);
      await writeJob(file, job);
    }
    return failure(error);
  }
}
export async function DELETE(req: NextRequest) {
  try {
    assertNativeImagesEnabled();
    const owner = await getOwnerContext(req);
    const file = fileFor(owner.ownerKey, req.nextUrl.searchParams.get("jobId") || "");
    let job: Job;
    try {job = JSON.parse(await fs.readFile(file, "utf8"));}
    catch {throw Object.assign(Error("Image job not found for this account."), {status: 404});}
    if (!job.promptId || !job.baseUrl) throw Object.assign(Error("Submission is not confirmed. Refresh this job before attempting cancellation."), {status: 409});
    const result = await cancelComfyPrompt(job.baseUrl, job.promptId);
    job.status = result.status;
    await writeJob(file, job);
    return NextResponse.json(publicJob(job), {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return failure(error);}
}
export async function PATCH(req: NextRequest) {
  try {
    assertNativeImagesEnabled();
    const {owner, sources} = await getGallerySourcesForRequest(req);
    const file = fileFor(owner.ownerKey, req.nextUrl.searchParams.get("jobId") || "");
    let job: Job;
    try {job = JSON.parse(await fs.readFile(file, "utf8"));}
    catch {throw Object.assign(Error("Image job not found for this account."), {status: 404});}
    if (job.status !== "completed" || !job.imagePath || !job.promptId) throw Object.assign(Error("Only completed images can be saved to Gallery."), {status: 409});
    const source = sources[0];
    if (!source) throw Error("No owner gallery is available.");
    const name = `${job.model}_${job.id}.png`, destination = path.join(source.dir, name);
    await fs.mkdir(source.dir, {recursive: true});
    try {await fs.copyFile(job.imagePath, destination, (await import("node:fs")).constants.COPYFILE_EXCL);}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
    writeMetaForFile(destination, {sourceType: "native-image", requestKind: "native-explicit-gallery-save",
      workflowId: `native/${job.model}`, workflowTitle: NATIVE_IMAGE_MODELS[job.model].label, sourcePromptId: job.promptId,
      positivePrompt: job.prompt, mediaCategory: "generated-image", ownerKey: owner.ownerKey,
      username: owner.username, deviceId: owner.deviceId,
      submitPayload: {model: job.model, steps: NATIVE_IMAGE_MODELS[job.model].steps, width: job.width, height: job.height, seed: job.seed, backend: job.baseUrl}}, source);
    return NextResponse.json({ok: true, name, url: `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${source.scope}`}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return failure(error);}
}
export async function GET(req: NextRequest) {
  try {
    assertNativeImagesEnabled();
    const owner = await getOwnerContext(req);
    const id = req.nextUrl.searchParams.get("jobId") || "";
    const file = fileFor(owner.ownerKey, id);
    let job: Job;
    try { job = JSON.parse(await fs.readFile(file, "utf8")); }
    catch { throw Object.assign(Error("Image job not found for this account."), {status: 404}); }
    if (!job.imagePath && job.promptId && job.baseUrl && !["failed", "canceled"].includes(job.status)) {
      const queued = getMediaQueueJob(job.promptId);
      if (queued && ["failed", "canceled", "unknown"].includes(queued.status)) {
        job.status = queued.status; job.error = queued.error || `Image job ${queued.status}.`;
        await writeJob(file, job);
      } else {
        const result = await resolveComfyPromptImageStatus({promptId: job.promptId, preferredBaseUrl: job.baseUrl, strictPreferred: true, filters: {nodeId: "461"}});
        if (result.status === "completed" && result.image) {
          const params = new URLSearchParams({filename: result.image.filename, subfolder: result.image.subfolder, type: result.image.type});
          const response = await fetch(job.baseUrl + "/view?" + params, {signal: AbortSignal.timeout(30_000)});
          if (!response.ok) throw Error("The completed image could not be retrieved. Try refreshing this job.");
          const bytes = Buffer.from(await response.arrayBuffer());
          const metadata = await sharp(bytes).metadata();
          if (metadata.width !== job.width || metadata.height !== job.height) throw Error("Generated image dimensions differ from the requested configuration.");
          const output = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(owner.ownerKey), `native-${id}.png`);
          await fs.mkdir(path.dirname(output), {recursive: true, mode: 0o700});
          await fs.writeFile(output, await sharp(bytes).png().toBuffer(), {mode: 0o600});
          job.imagePath = output; job.status = "completed";
          await writeJob(file, job);
        } else if (["failed", "missing_output"].includes(result.status)) {
          job.status = "failed"; job.error = result.error; await writeJob(file, job);
        } else job.status = result.status === "running" ? "running" : "queued";
      }
    }
    if (req.nextUrl.searchParams.get("image") === "1") {
      if (!job.imagePath) throw Object.assign(Error("Image output is not ready."), {status: 404});
      return new NextResponse(new Uint8Array(await fs.readFile(job.imagePath)), {headers: {"Content-Type": "image/png", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${job.model}-${id}.png"`}});
    }
    return NextResponse.json(publicJob(job), {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return failure(error); }
}
