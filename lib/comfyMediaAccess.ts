import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { OwnerContext } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeSegment, userGalleryDir } from "@/lib/paths";
import { readPromptRequestMeta } from "@/lib/promptRequestMeta";
import { candidateComfyImageBaseUrls, extractComfyHistoryImages, matchesComfyHistoryImageRequest, normalizeComfyBaseUrl, type ComfyHistoryImageFilters, type ComfyHistoryImagePayload } from "@/lib/comfyImageOutputLookup";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { RequestError } from "@/lib/requestError";

type Receipt = ComfyHistoryImagePayload & { ownerKey: string; baseUrl: string; promptId?: string };
const mediaExtension = /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|mkv|m4v|wav|mp3|m4a|flac|ogg)$/i;

export function validateWorkerMedia(input: ComfyHistoryImagePayload) {
  const { filename, subfolder, type } = input;
  if (!filename || filename.length > 255 || /[/\\\x00-\x1f]/.test(filename) || !mediaExtension.test(filename) ||
      subfolder.length > 1024 || subfolder.includes("\\") || subfolder.startsWith("/") ||
      subfolder.split("/").some(part => part === ".." || part === ".") || /[\x00-\x1f]/.test(subfolder) ||
      !["input", "output", "temp"].includes(type)) throw new RequestError("Invalid media reference.", 400);
  return input;
}

function receiptPath(ownerKey: string, media: ComfyHistoryImagePayload) {
  const hash = createHash("sha256").update(JSON.stringify([media.type, media.subfolder, media.filename])).digest("hex");
  return path.join(OTG_DATA_ROOT, "owned-worker-media", safeSegment(ownerKey), hash + ".json");
}

/** Only call after a server-owned job history or authenticated upload proves provenance. */
export async function recordOwnedWorkerMedia(ownerKey: string, baseUrl: string, media: ComfyHistoryImagePayload, promptId?: string) {
  validateWorkerMedia(media);
  const normalized = normalizeComfyBaseUrl(baseUrl);
  if (!candidateComfyImageBaseUrls().includes(normalized)) throw new RequestError("Media backend is not configured.", 503);
  // A distinct receipt per backend avoids lost updates when two workers finish
  // equal filenames concurrently. Older array receipts remain readable below.
  const file = path.join(receiptPath(ownerKey, media) + ".d", createHash("sha256").update(normalized).digest("hex") + ".json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const receipt: Receipt = { ...media, baseUrl: normalized, ownerKey, promptId };
  const tmp = file + "." + randomUUID() + ".tmp";
  try { await fs.writeFile(tmp, JSON.stringify(receipt), { mode: 0o600, flag: "wx" }); await fs.rename(tmp, file); }
  finally { await fs.unlink(tmp).catch(() => {}); }
}

export function ownedPromptMeta(ownerKey: string, promptId: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(promptId)) throw new RequestError("Invalid job reference.", 400);
  const meta = readPromptRequestMeta(ownerKey, promptId);
  if (!meta || meta.ownerKey !== ownerKey || meta.promptId !== promptId) throw new RequestError("Job not found.", 404);
  return meta;
}

export async function ownedHistoryImage(ownerKey: string, promptId: string, filters: ComfyHistoryImageFilters = {}) {
  const meta = ownedPromptMeta(ownerKey, promptId);
  const recorded = normalizeComfyBaseUrl(meta.comfyBaseUrl);
  if (recorded && !candidateComfyImageBaseUrls().includes(recorded)) throw new RequestError("Job backend is unavailable.", 503);
  // Legacy records without a backend can be resolved only by their owned UUID,
  // never by looking up the same filename on another worker.
  const bases = recorded ? [recorded] : candidateComfyImageBaseUrls();
  const matches: Array<{ baseUrl: string; image: ComfyHistoryImagePayload; count: number }> = [];
  let reachable = false;
  for (const baseUrl of bases) {
    let response: Response;
    try { response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { cache: "no-store", signal: AbortSignal.timeout(3000) }); }
    catch { continue; }
    if (!response.ok) { await response.body?.cancel(); continue; }
    const history = await response.json();
    reachable = true;
    // Require the exact history key; unrelated history must never be accepted.
    if (!history?.[promptId]) continue;
    const images = extractComfyHistoryImages(history, promptId).filter(image => matchesComfyHistoryImageRequest(image, filters));
    if (images.length) matches.push({ baseUrl, image: images[0], count: images.length });
  }
  if (matches.length > 1) throw new RequestError("Ambiguous job backend. Refresh the job from its gallery.", 409);
  const result = matches[0];
  if (!result) throw new RequestError(reachable ? "This job has no matching saved media yet." : "The job worker is temporarily unavailable.", reachable ? 404 : 503);
  await recordOwnedWorkerMedia(ownerKey, result.baseUrl, result.image, promptId);
  return result;
}

export async function proxyOwnedWorkerMedia(request: NextRequest, baseUrl: string, media: ComfyHistoryImagePayload) {
  validateWorkerMedia(media);
  const url = new URL(`${baseUrl}/view`);
  for (const key of ["filename", "type", "subfolder"] as const) url.searchParams.set(key, media[key]);
  const headers = new Headers();
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  let upstream: Response;
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  let timeout = setTimeout(() => controller.abort(), 30_000);
  const cleanup = () => { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); };
  try { upstream = await fetch(url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, redirect: "error", cache: "no-store", signal: controller.signal }); }
  catch { cleanup(); throw new RequestError("Media worker is temporarily unavailable. Retry the download.", 503); }
  clearTimeout(timeout);
  if (![200, 206, 304, 416].includes(upstream.status)) { cleanup(); await upstream.body?.cancel(); throw new RequestError("Media is not available on its recorded worker.", upstream.status === 404 ? 404 : 502); }
  const out = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name); if (value) out.set(name, value);
  }
  if (request.nextUrl.searchParams.get("download") === "1") out.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(media.filename)}`);
  if (request.method === "HEAD" || upstream.status === 304 || !upstream.body) {
    cleanup(); await upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers: out });
  }
  const reader = upstream.body.getReader();
  // An idle-read timeout, not a total-download deadline: large videos can keep
  // downloading while a slow/paused reader applies normal stream backpressure.
  const body = new ReadableStream<Uint8Array>({
    async pull(destination) {
      timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const item = await reader.read(); clearTimeout(timeout);
        if (item.done) { cleanup(); destination.close(); }
        else destination.enqueue(item.value);
      } catch (error) { cleanup(); destination.error(error); }
    },
    async cancel(reason) { cleanup(); controller.abort(); await reader.cancel(reason).catch(() => {}); },
  });
  return new Response(body, { status: upstream.status, headers: out });
}

export async function serveOwnedComfyMedia(request: NextRequest, owner: OwnerContext): Promise<Response> {
  const q = request.nextUrl.searchParams;
  if (q.get("debug") === "1") {
    const url = new URL(request.url); url.searchParams.delete("debug");
    const response = await serveOwnedComfyMedia(new NextRequest(url, { method: "HEAD", headers: request.headers, signal: request.signal }), owner);
    await response.body?.cancel();
    return Response.json({ ok: response.ok, exists: response.ok, url: url.pathname + url.search }, { status: response.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const media = validateWorkerMedia({ filename: q.get("filename") || q.get("name") || "", type: q.get("type") || "output", subfolder: q.get("subfolder") || "" });
  const promptId = q.get("promptId");
  if (promptId) {
    const result = await ownedHistoryImage(owner.ownerKey, promptId, { filename: media.filename, nodeId: q.get("nodeId") || undefined });
    return proxyOwnedWorkerMedia(request, result.baseUrl, result.image);
  }
  let receipts: Receipt[] = [];
  try { receipts = JSON.parse(await fs.readFile(receiptPath(owner.ownerKey, media), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try {
    const dir = receiptPath(owner.ownerKey, media) + ".d";
    for (const entry of await fs.readdir(dir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
      receipts.push(JSON.parse(await fs.readFile(path.join(dir, entry), "utf8")));
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  receipts = [...new Map(receipts.map(item => [item.baseUrl, item])).values()];
  const requested = normalizeComfyBaseUrl(q.get("comfyBaseUrl") || q.get("endpoint"));
  const authorized = receipts.filter(item => item.ownerKey === owner.ownerKey && item.filename === media.filename && item.type === media.type && item.subfolder === media.subfolder && candidateComfyImageBaseUrls().includes(item.baseUrl) && (!requested || item.baseUrl === requested));
  if (authorized.length > 1) throw new RequestError("Choose the media from its job or gallery to identify the correct GPU output.", 409);
  if (authorized.length === 1) return proxyOwnedWorkerMedia(request, authorized[0].baseUrl, media);
  // Compatibility for already imported owner media; never scan shared worker roots.
  if (media.type === "output" && !requested) {
    const roots = [...new Set([userGalleryDir(owner.ownerKey), userGalleryDir(owner.username || owner.ownerKey)])];
    const files = new Set<string>();
    for (const root of roots) {
      const realRoot = await fs.realpath(root);
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isFile() || !mediaExtension.test(entry.name)) continue;
        const file = path.join(root, entry.name);
        let match = entry.name === media.filename;
        if (!match) {
          try { match = JSON.parse(await fs.readFile(file + ".meta.json", "utf8")).originalName === media.filename; } catch { /* absent legacy metadata */ }
        }
        if (!match) continue;
        const real = await fs.realpath(file);
        const rel = path.relative(realRoot, real);
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) files.add(real);
      }
    }
    if (files.size > 1) throw new RequestError("Multiple owned outputs have this name. Open the exact gallery item.", 409);
    if (files.size === 1) return mediaFileResponse(request, [...files][0], { method: request.method === "HEAD" ? "HEAD" : "GET", cacheControl: "private, no-store", download: q.get("download") === "1" });
  }
  throw new RequestError("Media not found in your gallery or owned jobs.", 404);
}
