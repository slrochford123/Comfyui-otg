import { NextRequest, NextResponse } from "next/server";
import { fastH3LoraBlockReason } from "@/lib/h3FastLora";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { h3StudioCatalog, h3Stage1cDecisions, inspectH3StudioInventory, readH3StudioEvidence, listH3StudioQualifiedPlans, H3_UPSTREAM_OWNER_ATTESTATION } from "@/lib/h3StudioRegistry";
import { assertH3StudioAvailable, h3StudioProduction } from "@/lib/h3StudioAdmission";
import { parseH3StudioPlan, reconcileH3StudioPlan, H3_STUDIO_WORKFLOWS } from "@/lib/h3StudioPlan";
import { h3StudioOwnerExperimental } from "@/lib/h3StudioExperimental";
import type { H3PlannerCapability } from "@/lib/h3StudioPlanner";
import { compileH3StudioPlan, sanitizeH3StudioGraph } from "@/lib/h3StudioCompiler";
import { h3PlannerQuote, planH3WithDirector } from "@/lib/h3StudioPlanner";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { resolveStudioMedia, studioBoundCompilerInput, studioPlannerReferences, validateStudioMediaPlan } from "@/lib/h3StudioMedia";
import { createStudioReview, studioReviewedExecutionDigest } from "@/lib/h3StudioReview";
import { createStudioPlannerConsent, consumeStudioPlannerConsent } from "@/lib/h3StudioPlannerConsent";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  const status = error instanceof SessionInvalidError ? 401 : Number((error as { status?: number })?.status || 400);
  // Never serialize upstream HTTP internals, hostnames or filesystem errors.
  return json({ ok: false, error: status === 401 ? "Sign in to use H3 Studio." : "H3 plan could not be validated. Check the selected workflow, installed models and required media." }, status);
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request); assertH3StudioAvailable();
    const backend = request.nextUrl.searchParams.get("backend") ?? "rtx3090";
    if (backend !== "rtx3090" && backend !== "rtx5060ti") return json({ ok: false, error: "Choose RTX 3090 or RTX 5060 Ti." }, 400);
    const inventory = await inspectH3StudioInventory(undefined, backend);
    const decisions = h3Stage1cDecisions();
    return json({ ok: true, catalog: h3StudioCatalog(inventory), workflows: H3_STUDIO_WORKFLOWS,
      counts: { selected: decisions.selected.length, maybe: decisions.maybe.length, skip: decisions.skipped.length, undecided: decisions.undecided.length },
      observedAt: inventory.observedAt, ...(!h3StudioProduction() ? { upstreamAuthorization: H3_UPSTREAM_OWNER_ATTESTATION } : {}), experimental: h3StudioOwnerExperimental(user.ownerKey, backend), directGeneration: h3StudioProduction(), qualificationState: h3StudioProduction() ? "installed-workflow-validation" : "per-plan-validation-required", backend, gpu: backend === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti" });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request); assertH3StudioAvailable();
    const body = await readH3StudioJson(request, 20_000);
    if (!["preview", "quote", "director"].includes(String(body.action))) return json({ ok: false, error: "Unknown H3 planning action." }, 400);
    if (Object.keys(body).some(k => !["action", "plan", "mediaIds", "externalMediaConsent", "quoteId", "plannerConsent"].includes(k))) throw new Error("Unknown planning field.");
    if (body.externalMediaConsent !== undefined && typeof body.externalMediaConsent !== "boolean") throw new Error("Invalid media consent.");
    const scope = await videoTrimSession(request);
    const plan = parseH3StudioPlan(body.plan);
    const media = await resolveStudioMedia(user.ownerKey, scope.session, body.mediaIds || [], true);
    validateStudioMediaPlan(plan, media);
    const inventory = await inspectH3StudioInventory(undefined, plan.backend);
    const evidence = readH3StudioEvidence(plan.backend);
    const boundInput = studioBoundCompilerInput(plan, media);
    const access = { ownerKey: user.ownerKey };
    const experimental = h3StudioOwnerExperimental(user.ownerKey, plan.backend);
    const built = compileH3StudioPlan(plan, boundInput, inventory, evidence, access);
    if (body.action === "preview") {
      const review = await createStudioReview(user.ownerKey, scope.session, plan, media.fingerprint, built.manifest.qualificationFingerprint, built.manifest.submissionGraphSha256,
        { executionDigest: studioReviewedExecutionDigest(built.graph), credits: built.manifest.estimatedCredits, seconds: built.manifest.estimatedSeconds });
      return json({ ok: true, review: { id: review.id, mediaFingerprint: media.fingerprint, expiresAt: review.expiresAt }, manifest: built.manifest, graph: sanitizeH3StudioGraph(built.graph),
      estimate: { generationCredits: built.manifest.estimatedCredits, generationSeconds: built.manifest.estimatedSeconds,
        explanation: h3StudioProduction() ? "Installed workflow. Local GPU credit cost is 0; processing time is an estimate, not a measurement. No generation has been submitted." : built.manifest.experimental ? "Owner Experimental Mode: installed configuration, not physically qualified. Local GPU credit cost is 0; runtime is a rough existing-engine estimate, not a measurement. No generation has been submitted." : built.manifest.executable ? "Estimate from the recorded qualification for this configuration; actual runtime may vary. No generation has been submitted." : "This configuration is not yet executable. No generation has been submitted; missing measurements are not estimated by AI." } });
    }
    // Enumerate only actually qualified, recorded configurations, never a speculative
    // Cartesian product of checkpoint/LoRA/profile choices.
    const candidates: unknown[] = [plan, ...listH3StudioQualifiedPlans(evidence)];
    if (experimental || h3StudioProduction()) for (const workflow of H3_STUDIO_WORKFLOWS) for (const checkpoint of ["standard", "singularity", "singularity-v1.3", "fasth3", "selflift"] as const) for (const profile of ["native", "ref2va-8step", "fl2va-8step"] as const) {
      try { candidates.push(reconcileH3StudioPlan(plan, { workflowId: workflow.id, checkpoint, profile, loras: [] })); } catch { /* Strict registered combinations only. */ }
    }
    const available: H3PlannerCapability[] = [];
    for (const value of candidates.slice(0, 256)) {
      try {
        const candidate = parseH3StudioPlan({ ...(value as object), backend: plan.backend, prompt: plan.prompt, originalPrompt: plan.originalPrompt, seed: plan.seed });
        validateStudioMediaPlan(candidate, media);
        const result = compileH3StudioPlan(candidate, studioBoundCompilerInput(candidate, media), inventory, evidence, access);
        const family = H3_STUDIO_WORKFLOWS.find(w => w.id === candidate.workflowId)!.family;
        if (result.manifest.executable && !available.some(c => c.id === result.manifest.qualificationFingerprint)) available.push({ id: result.manifest.qualificationFingerprint, plan: candidate, qualificationFingerprint: result.manifest.qualificationFingerprint,
          ...(experimental || h3StudioProduction() ? { experimental, installedWorkflow: h3StudioProduction(), allowedLoras: h3StudioCatalog(inventory, evidence).filter(l => !l.blockedReasons.length && (l.family === family || l.family === "both") && l.strength && (!["fasth3", "selflift"].includes(candidate.checkpoint) || !fastH3LoraBlockReason(l.filename))).map(l => ({ id: l.id, name: l.name, minStrength: l.strength!.min, maxStrength: l.strength!.max, recommendedStrength: l.defaultStrength, triggerWords: l.triggerWords })) } : {}) });
      } catch { /* Unavailable/incompatible records are not offered to the director. */ }
    }
    const references = await studioPlannerReferences(media, false);
    const imageCount = body.externalMediaConsent === true ? Math.min(3, media.items.filter(i => i.asset.kind !== "audio").length) : 0;
    const quote = h3PlannerQuote({ intent: plan.originalPrompt, settings: plan, media: references, availableCapabilities: available }, imageCount);
    const quotedRequest = { plan, mediaFingerprint: media.fingerprint, available, externalMediaConsent: body.externalMediaConsent === true, quote };
    if (body.action === "quote") {
      const id = await createStudioPlannerConsent(user.ownerKey, scope.session, quotedRequest);
      return json({ ok: true, quote: { ...quote, id }, qualified: available.length > 0, unavailable: built.manifest.blockedReasons });
    }
    if (!available.length) throw new Error("No qualified configuration is available for planning.");
    await consumeStudioPlannerConsent(user.ownerKey, scope.session, String(body.quoteId || ""), quotedRequest, body.plannerConsent === true);
    const consentedReferences = await studioPlannerReferences(media, body.externalMediaConsent === true);
    request.signal.throwIfAborted();
    if ((await resolveStudioMedia(user.ownerKey, scope.session, body.mediaIds || [], true)).fingerprint !== media.fingerprint) throw new Error("References changed before the director call.");
    const reply = await planH3WithDirector(user.ownerKey, plan, consentedReferences, available, true);
    if (reply.plan) {
      validateStudioMediaPlan(reply.plan, media);
      if (!compileH3StudioPlan(reply.plan, studioBoundCompilerInput(reply.plan, media), inventory, evidence, access).manifest.executable) throw new Error("Director returned an unavailable configuration.");
    }
    return json({ ok: true, reply, plan: reply.plan, requiresClarification: !!reply.question || !!reply.unavailable });
  } catch (error) { return failure(error); }
}
