import { NextRequest, NextResponse } from "next/server";
import { routeH3MediaPlan } from "@/lib/h3MediaGpuRouting";
import { h3StudioDigest } from "@/lib/h3StudioIdentity";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { inspectH3StudioInventory, readH3StudioEvidence } from "@/lib/h3StudioRegistry";
import { assertH3StudioAvailable } from "@/lib/h3StudioAdmission";
import { automaticH3Plan, parseH3StudioPlan } from "@/lib/h3StudioPlan";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
import { resolveStudioMedia, studioBoundCompilerInput, validateStudioMediaPlan } from "@/lib/h3StudioMedia";
import { compileH3StudioPlan } from "@/lib/h3StudioCompiler";
import { createStudioReview, studioReviewedExecutionDigest } from "@/lib/h3StudioReview";
import { executeH3Studio } from "@/lib/h3StudioExecution";
import { listH3DirectJobs, h3DirectPublicStatus } from "@/lib/h3DirectJobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const preparing = new Set<string>();
export async function POST(request: NextRequest) {
  let lockedOwner = "";
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    const body = await readH3StudioJson(request);
    if (Object.keys(body).some(k => !["plan", "mediaIds", "requestId"].includes(k)) || typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)) throw Error("Invalid automatic video request.");
    const draft = parseH3StudioPlan(body.plan);
    if (!Array.isArray(body.mediaIds) || body.mediaIds.some(id => typeof id !== "string")) throw Error("Invalid media identities.");
    const fingerprint = h3StudioDigest({ plan: draft, mediaIds: body.mediaIds });
    if (preparing.has(scope.owner)) return NextResponse.json({ error: "A video is being prepared." }, { status: 409, headers });
    preparing.add(scope.owner); lockedOwner = scope.owner;
    const prior = (await listH3DirectJobs(scope.owner)).find(job => job.input.studioMedia?.requestId === body.requestId);
    if (prior) {
      if (prior.input.studioMedia?.autoRequestFingerprint !== fingerprint) return NextResponse.json({ error: "This request ID belongs to different inputs. Start a new video." }, { status: 409, headers });
      return NextResponse.json({ ok: true, job: h3DirectPublicStatus(prior), plan: prior.input.studioPlan }, { headers });
    }
    const media = await resolveStudioMedia(scope.owner, scope.session, body.mediaIds, true);
    const workflow = media.items.some(i => i.asset.kind === "video") ? "reference-edit"
      : media.items.some(i => i.asset.role === "first") ? "native-i2v" : media.items.length ? "native-r2v" : "native-t2v";
    // Browser/manual/AI settings cannot disable Auto's SLA + family-matched Turbo 8.
    const plan = await routeH3MediaPlan(automaticH3Plan(draft, workflow),media,scope.owner);
    validateStudioMediaPlan(plan, media);
    const built = compileH3StudioPlan(plan, studioBoundCompilerInput(plan, media), await inspectH3StudioInventory(undefined, plan.backend), readH3StudioEvidence(plan.backend), { ownerKey: scope.owner });
    if (!built.manifest.executable) return NextResponse.json({ error: "These inputs are not ready to generate. Check the required media, installed models and worker status.", reasons: built.manifest.blockedReasons }, { status: 400, headers });
    const receipt = { executionDigest: studioReviewedExecutionDigest(built.graph), credits: built.manifest.estimatedCredits, seconds: built.manifest.estimatedSeconds };
    // Preserve exact-input authorization internally; Create Video itself is consent
    // for one local generation. Paid AI/media-sharing consent stays separate.
    const review = await createStudioReview(scope.owner, scope.session, plan, media.fingerprint, built.manifest.qualificationFingerprint, built.manifest.submissionGraphSha256, receipt);
    const response = await executeH3Studio(request, { plan, mediaIds: body.mediaIds, reviewId: review.id, requestId: body.requestId, generationConsent: true }, undefined, fingerprint);
    const result = await response.json();
    return NextResponse.json({ ...result, ...(response.ok ? { plan, settings: { manifest: built.manifest, estimate: { generationCredits: receipt.credits, generationSeconds: receipt.seconds, explanation: built.manifest.experimental ? "Owner experimental configuration; video quality is not yet verified." : "Recorded configuration. Actual processing time may vary." } } } : {}) }, { status: response.status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const auth = /session|unauthorized/i.test(message);
    return NextResponse.json({ error: auth ? "Sign in to create a video." : "Could not prepare this video. Check your inputs and try again." }, { status: auth ? 401 : 400, headers });
  } finally { if (lockedOwner) preparing.delete(lockedOwner); }
}
