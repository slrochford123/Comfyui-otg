import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { getOwnerContext } from "@/lib/ownerKey";
import { parseH3StudioPlan, studioTemplateDuration } from "@/lib/h3StudioPlan";
import { inspectH3StudioInventory, readH3StudioEvidence, h3StudioCatalog } from "@/lib/h3StudioRegistry";
import { assertH3StudioAvailable, h3StudioProduction } from "@/lib/h3StudioAdmission";
import { compileH3StudioPlan } from "@/lib/h3StudioCompiler";
import { resolveStudioMedia, studioBoundCompilerInput, studioFileSha256, validateStudioMediaPlan } from "@/lib/h3StudioMedia";
import { createStudioReview, validateStudioReview, claimStudioReview, studioReviewedExecutionDigest } from "@/lib/h3StudioReview";
import { createH3DirectJob, h3DirectPublicStatus, listH3DirectJobs, startH3DirectJob, validateH3DirectInput, type H3DirectReference } from "@/lib/h3DirectJobs";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { DEFAULT_H3_ADVANCED_SETTINGS } from "@/lib/production/h3Settings";
import { prepareH3StudioReferenceClip } from "@/lib/h3StudioAudio";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
const headers = { "Cache-Control": "private, no-store" };
const pending = new Set<string>();
export type StudioExecutionRequest = { plan: unknown; mediaIds: unknown; reviewId?: string; requestId: string; generationConsent?: boolean };
export async function executeH3Studio(request: NextRequest, suppliedBody?: StudioExecutionRequest, simpleEdit?: { sourceId: string; requestFingerprint: string }, autoRequestFingerprint?: string) {
  let lockedOwner = "", directory = "", accepted = false, releaseReview: (() => Promise<void>) | undefined;
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    const owner = await getOwnerContext(request);
    if (pending.has(scope.owner)) return NextResponse.json({ error: "An H3 submission is being prepared." }, { status: 409, headers });
    pending.add(scope.owner); lockedOwner = scope.owner;
    const body = suppliedBody ?? await readH3StudioJson(request) as StudioExecutionRequest;
    if (Object.keys(body).some(k => !["plan", "mediaIds", "reviewId", "requestId", "generationConsent"].includes(k)) || !h3StudioProduction() && body.generationConsent !== true || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || "")) throw new Error("Invalid generation request.");
    const priorJobs = await listH3DirectJobs(scope.owner);
    const prior = priorJobs.find(j => j.input.studioMedia?.requestId === body.requestId);
    if (prior) {
      const { studioRequestHash } = await import("@/lib/h3StudioReview");
      const priorMedia = prior.input.studioMedia!;
      const currentMedia = await resolveStudioMedia(scope.owner, scope.session, body.mediaIds, true);
      if (studioRequestHash(parseH3StudioPlan(body.plan)) !== priorMedia.planHash || currentMedia.fingerprint !== priorMedia.fingerprint) return NextResponse.json({ error: "This request ID belongs to different inputs. Start a new video." }, { status: 409, headers });
      return NextResponse.json({ ok: true, job: h3DirectPublicStatus(prior) }, { headers });
    }
    if (priorJobs.some(j => j.input.studioPlan && ["submitting", "unknown"].includes(j.studioSubmissionState || "") && !j.promptId)) throw new Error("An earlier backend submission is unresolved. Reconcile it before submitting again.");
    const plan = parseH3StudioPlan(body.plan);
    const media = await resolveStudioMedia(scope.owner, scope.session, body.mediaIds, true);
    validateStudioMediaPlan(plan, media);
    const inventory = await inspectH3StudioInventory(undefined, plan.backend), evidence = readH3StudioEvidence(plan.backend);
    const compiled = compileH3StudioPlan(plan, studioBoundCompilerInput(plan, media), inventory, evidence, { ownerKey: scope.owner });
    if (!compiled.manifest.executable) throw new Error("The required models, worker or workflow inputs are unavailable.");
    const receipt = { executionDigest: studioReviewedExecutionDigest(compiled.graph), credits: compiled.manifest.estimatedCredits, seconds: compiled.manifest.estimatedSeconds };
    if (h3StudioProduction() && !suppliedBody) {
      // Create Video binds the exact validated inputs internally. This receipt is
      // an anti-stale/replay safeguard, not an acceptance checkbox or qualification.
      body.reviewId = (await createStudioReview(scope.owner, scope.session, plan, media.fingerprint, compiled.manifest.qualificationFingerprint, compiled.manifest.submissionGraphSha256, receipt)).id;
    }
    await validateStudioReview(scope.owner, scope.session, String(body.reviewId || ""), plan, media.fingerprint, compiled.manifest.qualificationFingerprint, compiled.manifest.submissionGraphSha256, receipt);
    releaseReview = await claimStudioReview(scope.owner, String(body.reviewId));
    directory = path.join(OTG_DATA_ROOT, "h3-direct", safeSegment(scope.owner), "uploads", crypto.randomUUID());
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const refs: Array<{ ref: H3DirectReference; kind: string; role: string }> = [];
    const files: Array<{ path: string; sha256: string }> = [];
    for (const item of media.items) {
      request.signal.throwIfAborted();
      const file = path.join(directory, `${item.asset.id}${path.extname(item.asset.filename)}`);
      await fs.copyFile(item.path, file); await fs.chmod(file, 0o600);
      if (await studioFileSha256(file) !== item.asset.sha256) throw new Error("Reference content changed.");
      let input = file;
      if (item.asset.kind === "video") {
        const prepared = await prepareH3StudioReferenceClip(file, item.asset.clipStartSeconds, plan.durationSeconds, compiled.manifest.width, compiled.manifest.height, item.asset.includeAudio || plan.audio === "original");
        input = prepared.outputPath;
      }
      files.push({ path: input, sha256: await studioFileSha256(input) });
      refs.push({ ref: { path: input, name: item.asset.name, description: item.asset.description, includeAudio: item.asset.includeAudio }, kind: item.asset.kind, role: item.asset.role });
    }
    // Catch same-ID version edits/removal while CPU preparation was in progress.
    const latest = await resolveStudioMedia(scope.owner, scope.session, body.mediaIds, true);
    if (latest.fingerprint !== media.fingerprint) throw new Error("References changed while preparing. Preview a fresh plan.");
    request.signal.throwIfAborted();
    const catalog = h3StudioCatalog(inventory, evidence);
    const optionalLoras = plan.loras.filter(l => l.enabled).map(l => ({ id: catalog.find(c => c.id === l.id)!.legacyPolicyId!, strength: l.strength }));
    const mode = plan.workflowId === "native-t2v" ? "h3-text-to-video" : plan.workflowId === "native-i2v" ? "h3-image-to-video" : "h3-reference-to-video";
    const input = validateH3DirectInput({ studioPlan: plan, studioMedia: { requestId: body.requestId, reviewId: body.reviewId!, fingerprint: media.fingerprint, qualificationFingerprint: compiled.manifest.qualificationFingerprint, receipt, planHash: (await import("@/lib/h3StudioReview")).studioRequestHash(plan), directory, files, ...(simpleEdit ? { simpleEdit } : {}), ...(autoRequestFingerprint ? { autoRequestFingerprint } : {}) },
      mode, quality: plan.quality === "0.2" ? "sh" : plan.quality === "0.6" ? "lq" : "hq", orientation: plan.orientation, durationSeconds: studioTemplateDuration(plan.durationSeconds), prompt: plan.prompt, seed: plan.seed, optionalLoras,
      h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode: plan.profile === "native" ? "native" : "turbo", checkpointMode: plan.checkpoint, combatLoraEnabled: plan.combatEnabled }, rifeInterpolation60Fps: false,
      firstImage: refs.find(r => r.role === "first")?.ref || null, lastImage: refs.find(r => r.role === "last")?.ref || null,
      images: refs.filter(r => r.role === "reference" && r.kind === "image").map(r => r.ref),
      videos: refs.filter(r => r.kind === "video").map(r => r.ref), audios: refs.filter(r => r.kind === "audio").map(r => r.ref),
    });
    const job = await createH3DirectJob(scope.owner, input, owner); accepted = true; startH3DirectJob(job);
    return NextResponse.json({ ok: true, job: h3DirectPublicStatus(job) }, { status: 202, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const auth = /session|unauthorized/i.test(message);
    return NextResponse.json({ ok: false, error: auth ? "Sign in to generate." : /earlier backend submission/.test(message) ? "An earlier backend submission is unresolved. Reconcile it before submitting again." : "The video could not start. Check the prompt, references, installed models and worker status, then retry." }, { status: auth ? 401 : 400, headers });
  } finally {
    if (!accepted && directory) await fs.rm(directory, { recursive: true, force: true });
    if (!accepted) await releaseReview?.();
    if (lockedOwner) pending.delete(lockedOwner);
  }
}
