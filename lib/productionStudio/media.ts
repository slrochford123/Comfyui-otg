import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Asset, AssetKind } from "./model";
import { StudioError, type StudioStore } from "./store";
const exec = promisify(execFile);
export async function probe(file: string) {
  const { stdout } = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ],
    { timeout: 30000, maxBuffer: 2_000_000 },
  );
  return JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      start_time?: string;
      duration?: string;
      sample_rate?: string;
      channels?: number;
    }>;
    format: { duration?: string };
  };
}
export function assetDirectory(s: StudioStore, project: string) {
  const dir = path.join(s.root, "media", project);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export async function snapshotFile(
  s: StudioStore,
  owner: string,
  project: string,
  source: string,
  name: string,
  kind: AssetKind,
  metadata: Record<string, unknown> = {},
) {
  s.get(owner, project);
  const id = randomUUID(),
    ext = path.extname(source).toLowerCase();
  if (!/^\.[a-z0-9]{1,12}$/.test(ext))
    throw new StudioError("Unsupported media extension.");
  const dest = path.join(assetDirectory(s, project), id + ext);
  await fsp.copyFile(source, dest, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(dest, 0o600);
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(dest)) hash.update(chunk);
  const stat = await fsp.stat(dest);
  const mime =
    (
      {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".safetensors": "application/octet-stream",
        ".json": "application/json",
      } as Record<string, string>
    )[ext] || "application/octet-stream";
  const a: Asset = {
    id,
    projectId: project,
    name: name.slice(0, 200),
    kind,
    sha256: hash.digest("hex"),
    mime,
    bytes: stat.size,
    createdAt: new Date().toISOString(),
    metadata,
  };
  s.addAsset(owner, project, a, dest);
  return a;
}
export async function upload(
  s: StudioStore,
  owner: string,
  project: string,
  file: File,
) {
  s.get(owner, project);
  if (!file.size || file.size > 512 * 1024 * 1024)
    throw new StudioError("Choose a non-empty file up to 512 MB.", 413);
  const ext = path.extname(file.name).toLowerCase();
  if (
    ![
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".mp4",
      ".webm",
      ".mov",
      ".wav",
      ".mp3",
      ".m4a",
      ".ogg",
    ].includes(ext)
  )
    throw new StudioError(
      "Choose a supported image, video, or audio file.",
      415,
    );
  const temp = path.join(
    assetDirectory(s, project),
    `upload-${randomUUID()}${ext}`,
  );
  try {
    await fsp.writeFile(temp, Buffer.from(await file.arrayBuffer()), {
      flag: "wx",
      mode: 0o600,
    });
    const p = await probe(temp);
    const image = [".png", ".jpg", ".jpeg", ".webp"].includes(ext),
      video = p.streams.some((s) => s.codec_type === "video"),
      audio = p.streams.some((s) => s.codec_type === "audio");
    if (!video && !audio)
      throw new StudioError("This file has no readable media.", 415);
    return await snapshotFile(
      s,
      owner,
      project,
      temp,
      file.name,
      image ? "image" : video ? "video" : "audio",
      {
        duration: Number(p.format.duration) || 0,
        width: p.streams[0]?.width,
        height: p.streams[0]?.height,
      },
    );
  } finally {
    await fsp.unlink(temp).catch(() => {});
  }
}
export async function assertAssetIntact(
  s: StudioStore,
  owner: string,
  project: string,
  id: string,
) {
  const entry = s.asset(owner, project, id);
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(entry.path)) hash.update(chunk);
  if (hash.digest("hex") !== entry.asset.sha256)
    throw new StudioError(
      "An approved asset changed on disk. Rendering stopped to protect identity.",
      409,
    );
  return entry;
}
