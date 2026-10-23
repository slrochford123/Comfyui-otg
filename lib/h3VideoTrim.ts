import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { probeVideoInfo } from "@/lib/videoFrame";
import { resolveFfmpegPath } from "@/lib/ffmpeg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const VIDEO_TRIM_TTL_MS = 2 * 60 * 60 * 1000;
let janitor: ReturnType<typeof setInterval> | undefined;
function startJanitor() {
  if (janitor) return;
  janitor = setInterval(() => {
    void (async () => {
      const root = path.join(OTG_DATA_ROOT, "h3-video-trim");
      for (const owner of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!owner.isDirectory() || !/^[0-9a-f]{64}$/.test(owner.name)) continue;
        const ownerRoot = path.join(root, owner.name);
        for (const entry of await fs.readdir(ownerRoot, { withFileTypes: true }).catch(() => [])) {
          if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
          const dir = path.join(ownerRoot, entry.name);
          const stat = await fs.stat(dir).catch(() => null);
          if (stat && stat.mtimeMs < Date.now() - VIDEO_TRIM_TTL_MS) await fs.rm(dir, { recursive: true, force: true });
        }
      }
    })().catch(() => { /* Cleanup retries next minute; never remove user media. */ });
  }, 60_000);
  janitor.unref();
}
export function videoTrimLimits() {
  const limit = (key: string, fallback: number, ceiling: number) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value >= 10 ? Math.min(value, ceiling) : fallback;
  };
  return { maxBytes: limit("OTG_H3_VIDEO_SOURCE_MAX_BYTES", 512 * 1024 ** 2, 512 * 1024 ** 2), maxSeconds: limit("OTG_H3_VIDEO_SOURCE_MAX_SECONDS", 600, 3600) };
}
export function validateVideoSelection(sourceDuration: number, start: unknown, end: unknown) {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(sourceDuration) || start < 0 || end <= start || end > sourceDuration || end - start < 2 || end - start > 10) {
    throw new Error("Select 2.00–10.00 seconds within the source video.");
  }
  return { start, end, duration: end - start };
}
export type TrimAsset = { id: string; name: string; filename: string; duration: number; width: number; height: number; expiresAt: number; session: string };
export function videoTrimRoot(owner: string) {
  return path.join(OTG_DATA_ROOT, "h3-video-trim", crypto.createHash("sha256").update(owner).digest("hex"));
}
export function videoTrimDirectory(owner: string, id: string) {
  if (!UUID.test(id)) throw new Error("Video source unavailable. Select the video again.");
  return path.join(videoTrimRoot(owner), id);
}
export async function pruneVideoTrims(owner: string) {
  const root = videoTrimRoot(owner);
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const dir = videoTrimDirectory(owner, entry.name);
    const stat = await fs.stat(dir).catch(() => null);
    if (stat && stat.mtimeMs < Date.now() - VIDEO_TRIM_TTL_MS) await fs.rm(dir, { recursive: true, force: true });
  }
}
export async function readVideoTrim(owner: string, session: string, id: string) {
  const dir = videoTrimDirectory(owner, id);
  let asset: TrimAsset;
  try { asset = JSON.parse(await fs.readFile(path.join(dir, "asset.json"), "utf8")) as TrimAsset; }
  catch { throw new Error("Video source unavailable. Select the video again."); }
  if (asset.id !== id || asset.session !== session || asset.expiresAt <= Date.now() || !/^source\.(mp4|mov|mkv|webm|m4v)$/i.test(asset.filename)) throw new Error("Video source unavailable. Select the video again.");
  return { asset, path: path.join(dir, asset.filename), dir };
}
export async function registerVideoTrim(owner: string, session: string, source: string, name: string) {
  startJanitor();
  const stat = await fs.stat(source);
  const limits = videoTrimLimits();
  if (!stat.isFile() || !stat.size || stat.size > limits.maxBytes) throw new Error(`Video must be smaller than ${Math.round(limits.maxBytes / 1024 ** 2)} MB.`);
  const info = await probeVideoInfo(source, { uploadedVideo: true });
  if (!info.codec || !info.width || !info.height || !info.durationSeconds || info.durationSeconds < 2 || info.durationSeconds > limits.maxSeconds) throw new Error(`Choose a readable video between 2 and ${limits.maxSeconds} seconds.`);
  await pruneVideoTrims(owner);
  const id = crypto.randomUUID();
  const dir = videoTrimDirectory(owner, id);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const filename = `source${path.extname(name).toLowerCase()}`;
  if (!/^source\.(mp4|mov|mkv|webm|m4v)$/.test(filename)) { await fs.rm(dir, { recursive: true, force: true }); throw new Error("Unsupported video format."); }
  try {
    await fs.copyFile(source, path.join(dir, filename));
    await fs.chmod(path.join(dir, filename), 0o600);
    const asset: TrimAsset = { id, filename, name: path.basename(name), duration: info.durationSeconds, width: info.width, height: info.height, expiresAt: Date.now() + VIDEO_TRIM_TTL_MS, session };
    await fs.writeFile(path.join(dir, "asset.json"), JSON.stringify(asset), { mode: 0o600 });
    return asset;
  } catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
}
export function publicVideoTrim(asset: TrimAsset) {
  return { id: asset.id, name: asset.name, duration: asset.duration, width: asset.width, height: asset.height, expiresAt: asset.expiresAt, url: `/api/h3/video-edit/source?id=${asset.id}` };
}

/** Accurate input seeking + re-encoding; never keyframe-only copying or upscaling. */
export async function encodeVideoSelection(source: string, output: string, start: number, duration: number, signal: AbortSignal, cancelFile?: string) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-ss", start.toFixed(6), "-i", source, "-t", duration.toFixed(6), "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stopped = false;
    const stop = () => { stopped = true; child.kill("SIGKILL"); };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const timer = setTimeout(stop, 120_000);
    const poll = cancelFile ? setInterval(() => { void fs.access(cancelFile).then(stop, () => {}); }, 200) : null;
    child.stderr.resume(); // Never surface ffmpeg filesystem paths to the browser.
    const cleanup = () => { clearTimeout(timer); if (poll) clearInterval(poll); signal.removeEventListener("abort", stop); };
    child.once("error", () => { cleanup(); reject(new Error("Video trimming could not start.")); });
    child.once("close", code => { cleanup(); if (stopped || signal.aborted) reject(new Error("Video trim cancelled or timed out.")); else if (code !== 0) reject(new Error("Video trimming failed. Choose another video or retry.")); else resolve(); });
  }).catch(async error => { await fs.rm(output, { force: true }); throw error; });
}
export async function trimVideoAsset(owner: string, session: string, id: string, start: unknown, end: unknown, signal: AbortSignal) {
  const source = await readVideoTrim(owner, session, id);
  // Re-probe disk media: neither client metadata nor persisted client fields confer authority.
  const probe = await probeVideoInfo(source.path, { uploadedVideo: true });
  const selection = validateVideoSelection(probe.durationSeconds ?? NaN, start, end);
  const lock = path.join(source.dir, "trimming");
  await fs.mkdir(lock).catch(() => { throw new Error("This source is already trimming. Wait or cancel first."); });
  const output = path.join(lock, "selection.mp4");
  try {
    await encodeVideoSelection(source.path, output, selection.start, selection.duration, signal, path.join(lock, "cancel"));
    const result = await probeVideoInfo(output);
    if (!result.durationSeconds || Math.abs(result.durationSeconds - selection.duration) > 0.12) throw new Error("Trim duration could not be verified. Please retry.");
    signal.throwIfAborted();
    return await registerVideoTrim(owner, session, output, "selection.mp4");
  } finally { await fs.rm(lock, { recursive: true, force: true }); }
}
export async function cancelVideoTrim(owner: string, session: string, id: string) {
  const source = await readVideoTrim(owner, session, id);
  const lock = path.join(source.dir, "trimming");
  if (!await fs.stat(lock).catch(() => null)) return;
  await fs.writeFile(path.join(lock, "cancel"), "cancel", { mode: 0o600 });
  const until = Date.now() + 15_000;
  while (await fs.stat(lock).catch(() => null)) {
    if (Date.now() >= until) throw new Error("Cancellation requested; trimming has not yet stopped. Please retry shortly.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
