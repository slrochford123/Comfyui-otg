import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { resolveFfmpegPath, resolveFfprobePath } from "@/lib/ffmpeg";
import { RequestError } from "@/lib/requestError";
import { characterRefOwnerHash } from "@/lib/h3SpecialModes/characterRefCardAccess";
import type { VideoSourceChoice, VideoSourceInfo } from "./videoSourceContract";

const run = promisify(execFile);
const pending = new Map<string, Promise<VideoSourceInfo & { poster: string }>>();
const waiters: Array<() => void> = [];
let active = 0;

/** IDs depend on the saved entry, so sorting or adding a clip cannot renumber it. */
export function sourceClipId(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase();
}

export function videoSourceChoice(source: { key: string; name: string; createdAt: number }): VideoSourceChoice {
  const query = new URLSearchParams({ source: source.key });
  const endpoint = "/api/experiments/video-characters?" + query;
  return {
    key: source.key,
    name: source.name,
    clipId: sourceClipId(source.key),
    createdAt: source.createdAt,
    posterUrl: endpoint + "&poster=1",
    infoUrl: endpoint + "&inspect=1",
    previewUrl: endpoint + "&preview=1",
  };
}

async function thumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => waiters.push(resolve));
  else active++;
  try { return await task(); }
  finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

/** Cached CPU-only first frame and duration. Source ownership is checked by the route before every read. */
export async function inspectVideoSource(owner: string, source: { key: string; file: string }) {
  const stat = await fs.lstat(source.file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RequestError("Video not found.", 404);
  const cacheKey = createHash("sha256").update([source.key, stat.size, stat.mtimeMs, "first-frame-192-v1"].join("\0")).digest("hex");
  const root = path.join(OTG_DATA_ROOT, "video-character-posters", characterRefOwnerHash(owner));
  const poster = path.join(root, cacheKey + ".webp");
  const metadata = path.join(root, cacheKey + ".json");
  const key = root + "/" + cacheKey;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    try {
      const saved: VideoSourceInfo = JSON.parse(await fs.readFile(metadata, "utf8"));
      if ((await fs.stat(poster)).size > 0) return { ...saved, poster };
    } catch { /* Create this source version once. */ }
    return thumbnailSlot(async () => {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const temporary = path.join(root, cacheKey + "." + randomUUID());
      try {
        const { stdout } = await run(resolveFfprobePath(), [
          "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type", "-of", "json", source.file,
        ], { timeout: 15000, maxBuffer: 256 * 1024 });
        const probe = JSON.parse(stdout);
        const duration = Number(probe.format?.duration);
        if (!probe.streams?.some((stream: { codec_type?: string }) => stream.codec_type === "video") || !Number.isFinite(duration) || duration <= 0) throw new RequestError("Video preview unavailable.", 422);
        await run(resolveFfmpegPath(), [
          "-v", "error", "-nostdin", "-n", "-hwaccel", "none", "-threads", "1", "-protocol_whitelist", "file,pipe", "-i", source.file,
          "-map", "0:v:0", "-frames:v", "1", "-an", "-vf", "scale=192:108:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=192:108:(ow-iw)/2:(oh-ih)/2:black",
          "-c:v", "libwebp", "-quality", "70", "-threads", "1", "-f", "webp", temporary + ".webp",
        ], { timeout: 20000, maxBuffer: 256 * 1024 });
        const after = await fs.stat(source.file);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new RequestError("Video changed. Refresh the video choices.", 409);
        const info: VideoSourceInfo = { clipId: sourceClipId(source.key), duration };
        await fs.writeFile(temporary + ".json", JSON.stringify(info), { mode: 0o600 });
        await fs.chmod(temporary + ".webp", 0o600);
        await fs.rename(temporary + ".webp", poster);
        await fs.rename(temporary + ".json", metadata);
        return { ...info, poster };
      } finally {
        await Promise.all([".webp", ".json"].map(extension => fs.rm(temporary + extension, { force: true })));
      }
    });
  })();
  pending.set(key, work);
  try { return await work; }
  finally { if (pending.get(key) === work) pending.delete(key); }
}
