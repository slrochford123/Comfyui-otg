import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createInterface } from "node:readline/promises";
import { compileH3StudioPlan } from "@/lib/h3StudioCompiler";
import { parseH3StudioPlan, H3_STUDIO_WORKFLOWS } from "@/lib/h3StudioPlan";
import { readH3StudioOwnerJson, assertH3StudioTest, inspectH3StudioInventory, readH3StudioEvidence, type H3StudioInventory } from "@/lib/h3StudioRegistry";
import { computeH3StudioSourceRevision, h3StudioDigest, h3StudioQualificationRequestDigest } from "@/lib/h3StudioIdentity";
import { authorizeH3StudioQualificationJob, releaseH3StudioQualificationAdmission, recordH3StudioLocalQualification, hasH3StudioQualificationAdmission, h3StudioQualificationFailureSnapshot } from "@/lib/h3StudioQualification";
import type { H3WorkflowBuildInput } from "@/lib/production/h3Workflows";
import type { H3DirectJob, H3DirectJobInput } from "@/lib/h3DirectJobs";
import { prepareH3StudioQualificationInventory, readH3StudioQualificationTelemetry, summarizeH3StudioQualificationTelemetry,
  type H3StudioQualificationSample } from "./qualification-inventory";
import type { H3StudioRightsClearance } from "@/lib/h3StudioRegistry";
import { inspectStudioQualificationRuntime } from "@/lib/h3StudioRuntime";

/**
 * Proposal JSON: {ownerKey, plan, compilerInput, inventory:{nodes:[],models:[],loras:[],files:[],assets,assetObservedAt,capacity}, evidence, jobInput}.
 * compilerInput MUST represent the real media topology (first/last, every image,
 * audio/video and includeAudio). Never use h3StudioPreviewInput placeholders.
 * jobInput uses existing local H3DirectReference paths. The runner recompiles after
 * upload; topology/material mismatches fail the fingerprint check inside its mutex.
 */
export async function qualificationCli(args: string[]) {
  const allowed = new Set(["--execute", "--proposal", "--approval", "--prepare"]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error("Unknown qualification option.");
    if (!["--execute", "--prepare"].includes(args[i]) && !args[++i]) throw new Error("Option requires an absolute local file.");
  }
  const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const file = option("--proposal");
  if (!file) throw new Error("Pass --proposal /absolute/owner-mode600/proposal.json. No execution is the default.");
  const proposal = readH3StudioOwnerJson(file) as { ownerKey: string; plan: unknown; compilerInput: H3WorkflowBuildInput;
    inventory: Omit<H3StudioInventory, "nodes" | "models" | "loras" | "files"> & { nodes: string[]; models: string[]; loras: string[]; files: string[] };
    evidence: NonNullable<Parameters<typeof compileH3StudioPlan>[3]>; jobInput: H3DirectJobInput;
    assetPaths: Record<string, string>; assetRights: Record<string, H3StudioRightsClearance>; requiredVramBytes?: number | null };
  const plan = parseH3StudioPlan(proposal.plan);
  const inventory: H3StudioInventory = { ...proposal.inventory, nodes: new Set(proposal.inventory.nodes), models: new Set(proposal.inventory.models),
    loras: new Set(proposal.inventory.loras), files: new Set(proposal.inventory.files) };
  const sourceRevision = computeH3StudioSourceRevision();
  const requestDigest = h3StudioQualificationRequestDigest(plan, proposal.jobInput);
  const preparing = args.includes("--prepare");
  let built = compileH3StudioPlan(preparing ? { ...plan, loras: [] } : plan, proposal.compilerInput, inventory, proposal.evidence);
  if (args.includes("--prepare")) {
    if (args.includes("--execute")) throw new Error("Prepare and execute are separate invocations; prepare never runs a job.");
    assertH3StudioTest();
    const approvalFile = option("--approval");
    if (!approvalFile) throw new Error("Asset hashing requires a separate explicit owner --approval and idle queues.");
    const a = readH3StudioOwnerJson(approvalFile) as Record<string, unknown>;
    const approvalDirectory = path.dirname(approvalFile), approvalStat = fs.statSync(approvalDirectory);
    if (approvalStat.uid !== process.getuid?.() || (approvalStat.mode & 0o777) !== 0o700 || fs.realpathSync(approvalDirectory) !== approvalDirectory) throw new Error("Preparation approval directory must be owner-only mode 700 without symlinks.");
    if (a.schemaVersion !== 2 || a.action !== "prepare-assets" || a.environment !== "test" || a.target !== "3090" || a.ownerKey !== proposal.ownerKey
      || a.requestDigest !== requestDigest || a.sourceRevision !== sourceRevision || a.assetPathsDigest !== h3StudioDigest(proposal.assetPaths)
      || a.assetRightsDigest !== h3StudioDigest(proposal.assetRights)
      || a.maxRuns !== 1 || typeof a.expiresAt !== "string" || Date.parse(a.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(a.expiresAt))) throw new Error("Exact owner asset-preparation approval required.");
    const idle = await inspectStudioQualificationRuntime(0);
    if (idle.queueRunning || idle.queuePending) throw new Error("Both shared 3090 queues must be idle before selected asset hashing.");
    fs.writeFileSync(`${approvalFile}.prepare-consumed`, JSON.stringify({ requestDigest, sourceRevision, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    const dependencyGraph = structuredClone(built.graph);
    for (const [index, selected] of plan.loras.filter(l => l.enabled).entries()) {
      const proof = proposal.evidence.loras[selected.id];
      if (!proof?.filename) throw new Error(`Separate optional LoRA provenance/rights required: ${selected.id}`);
      dependencyGraph[`prepare_optional_${index}`] = { class_type: "LoraLoaderModelOnly", inputs: { lora_name: proof.filename } };
    }
    const prepared = prepareH3StudioQualificationInventory({ graph: dependencyGraph, assetPaths: proposal.assetPaths, assetRights: proposal.assetRights, evidence: proposal.evidence });
    Object.assign(inventory, prepared.inventory); proposal.evidence = prepared.evidence;
    built = compileH3StudioPlan(plan, proposal.compilerInput, inventory, proposal.evidence);
    console.log(JSON.stringify({ execution: "NONE: selected asset hashing only", inventory: { ...proposal.inventory, ...prepared.inventory }, evidence: prepared.evidence,
      instructions: "Save inventory and provenance as separate owner mode-600 files; configure OTG_H3_STUDIO_INVENTORY_FILE and OTG_H3_STUDIO_EVIDENCE_FILE for this TEST process. Reuse while exact inode/size/mtime/ctime still match. No runtime qualification is created." }, null, 2));
  }
  console.log(JSON.stringify({ execution: "NONE: proposal only", sourceRevision, requestDigest, manifest: built.manifest,
    preparationApproval: { schemaVersion: 2, action: "prepare-assets", environment: "test", target: "3090", ownerKey: proposal.ownerKey, requestDigest, sourceRevision,
      assetPathsDigest: h3StudioDigest(proposal.assetPaths), assetRightsDigest: h3StudioDigest(proposal.assetRights), expiresAt: "OWNER_REVIEW_REQUIRED", maxRuns: 1 },
    approval: { schemaVersion: 2, approvalId: "OWNER-CHOOSE-UNIQUE-ID", environment: "test", target: "3090", ownerKey: proposal.ownerKey,
      fingerprint: built.manifest.qualificationFingerprint, requestDigest, sourceRevision, gpuUuid: "OWNER-EXACT-3090-UUID", expiresAt: "OWNER-ISO-EXPIRY-WITHIN-ONE-HOUR", maxJobs: 1 } }, null, 2));
  if (!args.includes("--execute")) return;
  assertH3StudioTest();
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Execution requires a local interactive owner terminal for Android acknowledgement.");
  const approvalFile = option("--approval");
  if (!approvalFile) throw new Error("--execute also requires --approval /absolute/mode600/owner-approval.json.");
  const approval = readH3StudioOwnerJson(approvalFile) as { fingerprint: string; requestDigest: string; sourceRevision: string; ownerKey: string };
  if (approval.fingerprint !== built.manifest.qualificationFingerprint || approval.requestDigest !== requestDigest || approval.sourceRevision !== sourceRevision || approval.ownerKey !== proposal.ownerKey) throw new Error("Approval/proposal mismatch.");
  // No engine import, job creation, worker request or mutation occurs in proposal mode.
  const engine = await import("@/lib/h3DirectJobs");
  const freshInventory = await inspectH3StudioInventory();
  const requiredVramBytes = built.manifest.requiredVramBytes ?? proposal.requiredVramBytes ?? proposal.inventory.capacity?.requiredVramBytes;
  if (!Number.isSafeInteger(requiredVramBytes) || requiredVramBytes! <= 0) throw new Error("Explicit first-run capacity budget required in the owner proposal.");
  const runtime = await inspectStudioQualificationRuntime(requiredVramBytes!);
  if (runtime.queueRunning || runtime.queuePending) throw new Error("Both shared 3090 queues must be idle; no job created.");
  freshInventory.capacity = { fingerprint: built.manifest.qualificationFingerprint, gpuUuid: runtime.gpuUuid, gpuName: runtime.gpuName,
    requiredVramBytes: requiredVramBytes!, freeVramBytes: runtime.freeVramBytes, totalVramBytes: runtime.freeVramBytes + runtime.telemetry.usedVramBytes,
    observedAt: runtime.checkedAt };
  const fresh = compileH3StudioPlan(plan, proposal.compilerInput, freshInventory, readH3StudioEvidence());
  if (!fresh.manifest.readyForQualification || fresh.manifest.qualificationFingerprint !== built.manifest.qualificationFingerprint) throw new Error("Provenance/configuration/capacity changed; no job created.");
  const workflow = H3_STUDIO_WORKFLOWS.find(w => w.id === plan.workflowId)!;
  if (!proposal.jobInput || proposal.jobInput.mode !== workflow.mode || proposal.jobInput.prompt !== plan.prompt || proposal.jobInput.seed !== plan.seed
    || proposal.jobInput.durationSeconds !== plan.durationSeconds) throw new Error("Existing-engine job input does not match the proposal.");
  const job = await engine.createH3DirectJob(proposal.ownerKey, { ...proposal.jobInput, studioPlan: plan,
    studioQualification: { fingerprint: built.manifest.qualificationFingerprint }, rifeInterpolation60Fps: false });
  const samples: H3StudioQualificationSample[] = [];
  try {
    authorizeH3StudioQualificationJob({ approvalFile, jobId: job.id, ownerKey: job.ownerKey, sourceRevision, manifest: fresh.manifest, request: job.input });
    samples.push(await readH3StudioQualificationTelemetry(fresh.manifest.requiredVramBytes!));
    engine.startH3DirectJob(job);
    let terminal: H3DirectJob | null = job;
    const abort = () => { void engine.cancelH3DirectJob(job.ownerKey, job.id); };
    process.once("SIGINT", abort); process.once("SIGTERM", abort);
    try {
      const deadline = Date.now() + 60 * 60_000;
      while (terminal && !["completed", "failed", "canceled"].includes(terminal.status)) {
        if (Date.now() > deadline) { await engine.cancelH3DirectJob(job.ownerKey, job.id); throw new Error("Qualification timed out; cancellation requested through existing engine."); }
        await new Promise(resolve => setTimeout(resolve, 2000));
        samples.push(await readH3StudioQualificationTelemetry(fresh.manifest.requiredVramBytes!));
        terminal = await engine.getH3DirectJob(job.ownerKey, job.id);
      }
    } finally { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
    if (!terminal || terminal.status !== "completed" || !terminal.outputPath) throw new Error("Qualification did not produce a completed output; no evidence recorded.");
    const outputSha256 = crypto.createHash("sha256").update(fs.readFileSync(terminal.outputPath)).digest("hex");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let response: string;
    try { response = await rl.question(`Play ${terminal.outputPath} on the physical Android device. Only after successful playback type: ANDROID PLAYED ${job.id} ${outputSha256}\n`); }
    finally { rl.close(); }
    if (response !== `ANDROID PLAYED ${job.id} ${outputSha256}`) throw new Error("Android playback was not acknowledged; no qualification record.");
    if (computeH3StudioSourceRevision() !== sourceRevision) throw new Error("Source changed during qualification; output retained without evidence.");
    if (!hasH3StudioQualificationAdmission(job.id, job.ownerKey)) throw new Error("Admission registration was released before local completion; no evidence recorded.");
    recordH3StudioLocalQualification({ job: terminal, sourceRevision, telemetry: summarizeH3StudioQualificationTelemetry(samples), manifest: terminal.studioManifest as ReturnType<typeof compileH3StudioPlan>["manifest"],
      androidPlayback: { acknowledgedBy: job.ownerKey, acknowledgedAt: new Date().toISOString(), jobId: job.id, outputSha256, played: true } });
    console.log("Exact v2 evidence recorded after real completion and manual Android playback.");
  } catch (error) {
    await engine.cancelH3DirectJob(job.ownerKey, job.id).catch(() => undefined);
    const failure = pathForFailure(approvalFile, job.id);
    fs.writeFileSync(failure, JSON.stringify({ schemaVersion: 2, outcome: "failed-or-unaccepted", jobId: job.id, sourceRevision,
      fingerprint: built.manifest.qualificationFingerprint, recordedAt: new Date().toISOString(), samples,
      submission: h3StudioQualificationFailureSnapshot(job.id, job.ownerKey),
      job: await engine.getH3DirectJob(job.ownerKey, job.id), error: error instanceof Error ? error.message : String(error) }, null, 2), { mode: 0o600, flag: "wx" });
    throw error;
  }
  finally { releaseH3StudioQualificationAdmission(job.id, job.ownerKey); }
}
function pathForFailure(approvalFile: string, jobId: string) { return `${approvalFile}.${jobId}.failure.json`; }
