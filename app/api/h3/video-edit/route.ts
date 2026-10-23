import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getOwnerContext } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { probeVideoInfo } from "@/lib/videoFrame";
import { h3VideoEditFrameCount, h3VideoEditCanvas } from "@/lib/h3VideoEdit";
import { createH3DirectJob, h3DirectPublicStatus, listH3DirectJobs, startH3DirectJob } from "@/lib/h3DirectJobs";
import { DEFAULT_H3_ADVANCED_SETTINGS } from "@/lib/production/h3Settings";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { readVideoTrim } from "@/lib/h3VideoTrim";
import { limitedFormData } from "@/lib/limitedRequestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const submitting = new Set<string>();
export async function POST(request: NextRequest) {
  let lockedOwner = "";
  let uploadDirectory = "";
  let accepted = false;
  try {
    await requireSessionUser(request);
    const owner = await getOwnerContext(request);
    if (submitting.has(owner.ownerKey)) return NextResponse.json({ error: "A video edit submission is already being prepared." }, { status: 409 });
    submitting.add(owner.ownerKey); lockedOwner = owner.ownerKey;
    const json = request.headers.get("content-type")?.includes("application/json") ? await request.json() : null;
    const form = json ? new FormData() : await limitedFormData(request, 128 * 1024 ** 2 + 64 * 1024);
    const videos = form.getAll("video");
    const file = videos[0];
    const prompt = String(json?.prompt || form.get("prompt") || "").trim();
    if (!json && (videos.length !== 1 || !(file instanceof File) || !/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name) || (file.type && !file.type.startsWith("video/")))) throw new Error("Choose exactly one supported video file (MP4, MOV, MKV, WebM or M4V).");
    if (!json && (!(file instanceof File) || !file.size || file.size > 128 * 1024 * 1024)) throw new Error("Choose a non-empty video smaller than 128 MB.");
    if (!prompt || prompt.length > 8000) throw new Error("Enter an edit prompt between 1 and 8000 characters.");
    const requestId = String(json?.requestId || form.get("requestId") || "");
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error("Invalid video edit request ID.");
    const prior = (await listH3DirectJobs(owner.ownerKey)).find(job => (job.input.videoEdit as { requestId?: string } | undefined)?.requestId === requestId || job.input.studioSource?.requestId === requestId);
    if (prior) return NextResponse.json({ ok: true, job: h3DirectPublicStatus(prior) });
    const directory = safeJoin(OTG_DATA_ROOT, "h3-direct", safeSegment(owner.ownerKey), "uploads", crypto.randomUUID());
    uploadDirectory = directory;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    let name: string, source: string;
    if (json) {
      const scope = await videoTrimSession(request);
      const ready = await readVideoTrim(owner.ownerKey, scope.session, String(json.sourceId || ""));
      name = ready.asset.name;
      source = path.join(directory, ready.asset.filename);
      await fs.copyFile(ready.path, source);
      await fs.chmod(source, 0o600);
    } else {
      name = (file as File).name;
      source = path.join(directory, `source${path.extname(name).toLowerCase()}`);
      await fs.writeFile(source, Buffer.from(await (file as File).arrayBuffer()), { mode: 0o600 });
    }
    const probe = await probeVideoInfo(source, { uploadedVideo: true });
    if (!probe.codec || !probe.width || !probe.height) throw new Error("Choose a readable video file.");
    h3VideoEditFrameCount(probe.durationSeconds ?? NaN);
    const canvas = h3VideoEditCanvas(probe.width ?? 0, probe.height ?? 0);
    if (json?.studioPlan !== undefined) {
      throw new Error("Choose the H3 Studio reference-guided editor and preview its exact media-bound plan before generation.");
    }
    const job = await createH3DirectJob(owner.ownerKey, {
      mode: "h3-text-to-video", quality: "sh", orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
      durationSeconds: (probe.durationSeconds ?? 0) <= 5 ? 5 : 10,
      prompt, seed: crypto.randomInt(0, 2147483647),
      h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode: "native", combatLoraEnabled: false },
      optionalLoras: [], firstImage: null, lastImage: null, images: [], videos: [], audios: [],
      videoEdit: { requestId, source: { path: source, name: path.basename(name), description: "Source video to edit" }, durationSeconds: probe.durationSeconds!, ...canvas, ...(json ? { temporarySource: true } : {}) },
    }, owner);
    accepted = true;
    startH3DirectJob(job);
    return NextResponse.json({ ok: true, job: h3DirectPublicStatus(job) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video edit failed.";
    const auth = /session|auth/i.test(message);
    const safe = /^(Choose |Enter |Invalid video edit|Video source|Source video|A video edit)/.test(message);
    return NextResponse.json({ error: auth ? "Please sign in again." : safe ? message : "Video edit could not be prepared. Select the video again and retry." }, { status: auth ? 401 : 400 });
  } finally {
    if (!accepted && uploadDirectory) await fs.rm(uploadDirectory, { recursive: true, force: true });
    if (lockedOwner) submitting.delete(lockedOwner);
  }
}
