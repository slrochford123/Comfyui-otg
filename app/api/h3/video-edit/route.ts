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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const submitting = new Set<string>();
export async function POST(request: NextRequest) {
  let lockedOwner = "";
  try {
    await requireSessionUser(request);
    const owner = await getOwnerContext(request);
    if (submitting.has(owner.ownerKey)) return NextResponse.json({ error: "A video edit submission is already being prepared." }, { status: 409 });
    submitting.add(owner.ownerKey); lockedOwner = owner.ownerKey;
    const form = await request.formData();
    const videos = form.getAll("video");
    const file = videos[0];
    const prompt = String(form.get("prompt") || "").trim();
    if (videos.length !== 1 || !(file instanceof File) || !/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name) || (file.type && !file.type.startsWith("video/"))) throw new Error("Choose exactly one supported video file (MP4, MOV, MKV, WebM or M4V).");
    if (!file.size || file.size > 128 * 1024 * 1024) throw new Error("Choose a non-empty video smaller than 128 MB.");
    if (!prompt || prompt.length > 8000) throw new Error("Enter an edit prompt between 1 and 8000 characters.");
    const requestId = String(form.get("requestId") || "");
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error("Invalid video edit request ID.");
    const prior = (await listH3DirectJobs(owner.ownerKey)).find(job => (job.input.videoEdit as { requestId?: string } | undefined)?.requestId === requestId);
    if (prior) return NextResponse.json({ ok: true, job: h3DirectPublicStatus(prior) });
    const directory = safeJoin(OTG_DATA_ROOT, "h3-direct", safeSegment(owner.ownerKey), "uploads", crypto.randomUUID());
    await fs.mkdir(directory, { recursive: true });
    const source = path.join(directory, `source${path.extname(file.name).toLowerCase()}`);
    await fs.writeFile(source, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const probe = await probeVideoInfo(source);
    h3VideoEditFrameCount(probe.durationSeconds ?? NaN);
    const canvas = h3VideoEditCanvas(probe.width ?? 0, probe.height ?? 0);
    const job = await createH3DirectJob(owner.ownerKey, {
      mode: "h3-text-to-video", quality: "sh", orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
      durationSeconds: (probe.durationSeconds ?? 0) <= 5 ? 5 : 10,
      prompt, seed: crypto.randomInt(0, 2147483647),
      h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode: "native", combatLoraEnabled: false },
      optionalLoras: [], firstImage: null, lastImage: null, images: [], videos: [], audios: [],
      videoEdit: { requestId, source: { path: source, name: path.basename(file.name), description: "Source video to edit" }, durationSeconds: probe.durationSeconds!, ...canvas },
    }, owner);
    startH3DirectJob(job);
    return NextResponse.json({ ok: true, job: h3DirectPublicStatus(job) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video edit failed.";
    return NextResponse.json({ error: message }, { status: /session|auth/i.test(message) ? 401 : 400 });
  } finally { if (lockedOwner) submitting.delete(lockedOwner); }
}
