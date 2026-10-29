import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { readVideoTrim } from "@/lib/h3VideoTrim";
import { probeVideoInfo } from "@/lib/videoFrame";
import { parseSimpleVideoEdit, simpleVideoEditPlan } from "@/lib/h3SimpleVideoEdit";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
import { inspectH3StudioInventory, readH3StudioEvidence } from "@/lib/h3StudioRegistry";
import { assertH3StudioAvailable } from "@/lib/h3StudioAdmission";
import { registerStudioMedia, removeStudioMedia, resolveStudioMedia, studioBoundCompilerInput } from "@/lib/h3StudioMedia";
import { compileH3StudioPlan } from "@/lib/h3StudioCompiler";
import { createStudioReview, studioReviewedExecutionDigest } from "@/lib/h3StudioReview";
import { executeH3Studio } from "@/lib/h3StudioExecution";
import { listH3DirectJobs, h3DirectPublicStatus } from "@/lib/h3DirectJobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const preparing = new Set<string>();
export async function POST(request: NextRequest) {
  let owner = "", session = "", mediaId = "", locked = false;
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    owner = scope.owner; session = scope.session;
    const input = parseSimpleVideoEdit(await readH3StudioJson(request));
    if (preparing.has(owner)) return NextResponse.json({ error: "A video edit is being prepared." }, { status: 409, headers });
    preparing.add(owner); locked = true;
    const prior = (await listH3DirectJobs(owner)).find(job => job.input.studioMedia?.requestId === input.requestId);
    if (prior) {
      if (prior.input.studioMedia?.simpleEdit?.requestFingerprint !== input.requestFingerprint) return NextResponse.json({ error: "This request ID belongs to a different edit. Start a new edit." }, { status: 409, headers });
      return NextResponse.json({ ok: true, job: h3DirectPublicStatus(prior) }, { headers });
    }
    const source = await readVideoTrim(owner, session, input.sourceId);
    const probe = await probeVideoInfo(source.path, { uploadedVideo: true });
    let plan = simpleVideoEditPlan(input, probe);
    const stat = await fs.stat(source.path);
    if (stat.size > 128 * 1024 ** 2) throw Error("The selected clip exceeds 128 MB. Trim a smaller clip.");
    request.signal.throwIfAborted();
    const asset = await registerStudioMedia(owner, session, new File([await fs.readFile(source.path)], `selection${path.extname(source.path)}`, { type: "video/mp4" }), { role: "reference", description: "Selected source video to edit", includeAudio: false, clipStartSeconds: 0 }, request.signal);
    mediaId = asset.id;
    const media = await resolveStudioMedia(owner, session, [mediaId], true);
    plan = await (await import("@/lib/h3MediaGpuRouting")).routeH3MediaPlan(plan,media,owner);
    const compiled = compileH3StudioPlan(plan, studioBoundCompilerInput(plan, media), await inspectH3StudioInventory(undefined, plan.backend), readH3StudioEvidence(plan.backend), { ownerKey: owner });
    if (!compiled.manifest.executable) return NextResponse.json({ error: "This edit configuration is unavailable. Check the required clip, installed H3 models and worker status.", reasons: compiled.manifest.blockedReasons }, { status: 400, headers });
    if (!Object.values(compiled.graph).some(node => node.class_type === "ModelPreviewOverrideKJ")) throw Error("Generation preview is unavailable.");
    // Internal exact-input receipt, not a second user-facing review or approval step.
    const review = await createStudioReview(owner, session, plan, media.fingerprint, compiled.manifest.qualificationFingerprint, compiled.manifest.submissionGraphSha256,
      { executionDigest: studioReviewedExecutionDigest(compiled.graph), credits: compiled.manifest.estimatedCredits, seconds: compiled.manifest.estimatedSeconds });
    return await executeH3Studio(request, { plan, mediaIds: [mediaId], reviewId: review.id, requestId: input.requestId, generationConsent: true }, { sourceId: input.sourceId, requestFingerprint: input.requestFingerprint });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const auth = /session|unauthorized/i.test(message);
    const safe = /^(Choose |Select |Enter |Trim |Invalid video edit|Unsupported video edit|The selected clip)/.test(message);
    return NextResponse.json({ error: auth ? "Sign in to edit video." : safe ? message : "The video edit could not be prepared. Check the source and retry." }, { status: auth ? 401 : 400, headers });
  } finally {
    if (mediaId) await removeStudioMedia(owner, session, mediaId).catch(() => {});
    if (locked) preparing.delete(owner);
  }
}
