import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  assertAssetIntact,
  assetDirectory,
  snapshotFile,
  probe,
} from "./media";
import type { StudioStore } from "./store";
export async function playbackProxy(
  s: StudioStore,
  owner: string,
  project: string,
  id: string,
  jobId: string,
  canceled: () => boolean,
) {
  const source = await assertAssetIntact(s, owner, project, id),
    info = await probe(source.path),
    file = path.join(assetDirectory(s, project), `${jobId}-proxy.mp4`),
    controller = new AbortController();
  const timer = setInterval(() => {
    if (canceled()) controller.abort();
  }, 500);
  try {
    await promisify(execFile)(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source.path,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale='min(640,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "26",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        file,
      ],
      { signal: controller.signal, timeout: 600000, maxBuffer: 1_000_000 },
    );
    return snapshotFile(
      s,
      owner,
      project,
      file,
      source.asset.name + " · playback proxy.mp4",
      "video",
      { proxyFor: id, duration: Number(info.format.duration) },
    );
  } finally {
    clearInterval(timer);
  }
}
