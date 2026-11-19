import path from "node:path";
import fs from "node:fs";
import type { NextRequest } from "next/server";
import type { H3DirectJobInput } from "@/lib/h3DirectJobs";
import { buildH3CharacterVoiceSubmission, h3DirectQualificationFilenames, pinH3CharacterVoiceInputs, prepareH3CharacterVoices } from "@/lib/h3CharacterVoicesServer";
import { verifyH3QualificationBridgeRoute } from "@/lib/h3QualificationBridgeRoute";
import { computeH3CharacterVoicesSourceRevision, h3CharacterVoicesQualificationBinding, h3StudioBoundGraphDigest, h3StudioDigest } from "@/lib/h3StudioIdentity";
import { assertH3StudioTest, readH3StudioOwnerJson } from "@/lib/h3StudioRegistry";
import { authorizeH3CharacterVoicesQualificationJob, h3CharacterVoicesQualificationOnly, h3StudioQualificationFailureSnapshot, releaseH3StudioQualificationAdmission, type H3CharacterVoicesQualificationApproval } from "@/lib/h3StudioQualification";
import { inspectStudioQualificationRuntime } from "@/lib/h3StudioRuntime";
import { GPU_UUIDS } from "@/lib/mediaGpuRouting";
import { dataRoot } from "@/lib/runtime/configPaths";
import { getOwnerContext } from "@/lib/ownerKey";
import { requireTestingVoiceTools } from "@/lib/testingVoiceToolsAccess";

export type H3CharacterVoicesQualificationProposal = {
  schemaVersion: 2; kind: "character-voices"; ownerKey: string; jobId: string; requiredVramBytes: number; jobInput: H3DirectJobInput;
};

const isolatedResearch = "/home/shawn-rochford/AI/research/h3-character-voices-test";

function requireIsolatedPilot(proposalFile: string, approvalFile: string) {
  const root = dataRoot(), pilot = path.dirname(root);
  if (!h3CharacterVoicesQualificationOnly() || process.env.OTG_DATA_DIR !== root || path.basename(root) !== "data"
    || path.dirname(pilot) !== isolatedResearch || !/^pilot-3090-[a-zA-Z0-9_-]+$/.test(path.basename(pilot))
    || [process.env.OTG_MEDIA_GPU_QUEUE_DB, process.env.OTG_WORKER_CONTROL_STORE_DIR, process.env.OTG_DEVICE_OUTPUT_ROOT].some(Boolean)) {
    throw Error("Qualification must use its dedicated TEST research pilot data with no storage overrides.");
  }
  for (const directory of [pilot, root]) {
    const stat = fs.lstatSync(directory);
    if (fs.realpathSync(directory) !== directory || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700)
      throw Error("The isolated pilot requires real owner-only directories.");
  }
  if (proposalFile === approvalFile || [proposalFile, approvalFile].some(file => path.dirname(file) !== pilot || fs.realpathSync(file) !== file))
    throw Error("Keep the two owner-only qualification files together in the isolated pilot directory.");
  for (const name of ["h3-direct", "media-gpu-queue", "worker-control"]) {
    const directory = path.join(root, name);
    if (fs.existsSync(directory) && (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory()))
      throw Error("An isolated pilot storage path is not a regular directory.");
  }
}

/** Local fixture/operator preparation only. Cookies are consumed in memory and never returned. */
export async function prepareCharacterVoicesQualificationProposal(request: NextRequest, body: Record<string, unknown>, parameters: { jobId: string; requiredVramBytes: number }) {
  await requireTestingVoiceTools(request);
  const owner = await getOwnerContext(request);
  const { input, seed, preview } = await prepareH3CharacterVoices(request, owner.ownerKey, body);
  if (seed === undefined) throw Error("Choose an exact qualification seed before preparing media.");
  const jobInput = await pinH3CharacterVoiceInputs(owner.ownerKey, input, seed);
  const proposal: H3CharacterVoicesQualificationProposal = { schemaVersion: 2, kind: "character-voices", ownerKey: owner.ownerKey, ...parameters, jobInput };
  return { proposal, preview };
}

export function characterVoicesQualificationPreimage(proposal: H3CharacterVoicesQualificationProposal) {
  if (proposal?.schemaVersion !== 2 || proposal.kind !== "character-voices" || !proposal.ownerKey?.trim()
    || !/^h3-direct-[a-f0-9-]{36}$/.test(proposal.jobId) || !Number.isSafeInteger(proposal.requiredVramBytes) || proposal.requiredVramBytes <= 0) throw Error("A single exact local TEST Character Voices proposal is required.");
  const input = proposal.jobInput;
  const requestBinding = h3CharacterVoicesQualificationBinding(input);
  const filenames = h3DirectQualificationFilenames(proposal.jobId, input);
  const built = buildH3CharacterVoiceSubmission(input, "rtx3090", filenames);
  const requestDigest = h3StudioDigest(requestBinding), boundGraphDigest = h3StudioBoundGraphDigest(built.graph);
  return { requestBinding, requestDigest, boundGraphDigest, fingerprint: h3StudioDigest({ requestDigest, boundGraphDigest }), graph: built.graph, sourceRevision: computeH3CharacterVoicesSourceRevision() };
}

export async function runH3CharacterVoicesQualification(file: string, approvalFile: string | undefined, execute: boolean) {
  assertH3StudioTest();
  const proposal = readH3StudioOwnerJson(file) as H3CharacterVoicesQualificationProposal;
  const reviewed = characterVoicesQualificationPreimage(proposal);
  const approvalFields = { schemaVersion: 2, kind: "character-voices", environment: "test", target: "3090", ownerKey: proposal.ownerKey,
    jobId: proposal.jobId, requiredVramBytes: proposal.requiredVramBytes, gpuUuid: GPU_UUIDS.rtx3090, maxJobs: 1,
    fingerprint: reviewed.fingerprint, requestDigest: reviewed.requestDigest, boundGraphDigest: reviewed.boundGraphDigest, sourceRevision: reviewed.sourceRevision } as const;
  if (!execute) {
    const bridgeRoute = await verifyH3QualificationBridgeRoute().catch(() => null);
    console.log(JSON.stringify({ execution: "NONE", bridgeRoute, ...reviewed,
      approval: { ...approvalFields, bridgeRoute, approvalId: "OWNER-CHOOSE-UNIQUE-ID", expiresAt: "OWNER-ISO-EXPIRY-WITHIN-ONE-HOUR" } }, null, 2));
    return;
  }
  if (!approvalFile || process.env.OTG_ENV !== "test" || !process.env.OTG_DATA_DIR || !path.isAbsolute(process.env.OTG_DATA_DIR)
    || !process.stdin.isTTY || !process.stdout.isTTY) throw Error("Execution requires the explicit local TEST owner terminal, separate mode-600 approval and pinned TEST data directory.");
  requireIsolatedPilot(file, approvalFile);
  const approval = readH3StudioOwnerJson(approvalFile, 16_000) as H3CharacterVoicesQualificationApproval;
  if (!approval?.bridgeRoute || Object.entries(approvalFields).some(([key, value]) => approval[key as keyof typeof approval] !== value)) throw Error("The owner approval changed or has no verified installed TEST bridge route.");
  // The authority is the installed bridge guard, even when this app is built in isolation.
  const bridgeRoute = await verifyH3QualificationBridgeRoute(approval.bridgeRoute);
  const { requireH3QualificationSharedQueue } = await import("@/lib/workers/mediaGpuQueue");
  requireH3QualificationSharedQueue(bridgeRoute);
  const live = await inspectStudioQualificationRuntime(proposal.requiredVramBytes, false, approval.gpuUuid);
  if (live.queueRunning || live.queuePending || live.freeVramBytes < proposal.requiredVramBytes) throw Error("The approved 3090 has no idle capacity; no job was created.");
  const engine = await import("@/lib/h3DirectJobs");
  const request = engine.validateH3DirectInput({ ...proposal.jobInput, studioQualification: { kind: "character-voices", fingerprint: reviewed.fingerprint } }, proposal.ownerKey);
  authorizeH3CharacterVoicesQualificationJob({ approvalFile, ...approvalFields, bridgeRoute, request });
  const { jobId, ownerKey } = proposal;
  try {
    const job = await engine.createH3DirectJob(ownerKey, request, null, false, jobId);
    engine.startH3DirectJob(job);
    const abort = () => { void engine.cancelH3DirectJob(ownerKey, jobId); };
    process.once("SIGINT", abort); process.once("SIGTERM", abort);
    try {
      const deadline = Date.now() + 60 * 60_000;
      for (;;) {
        const terminal = await engine.getH3DirectJob(ownerKey, jobId);
        if (!terminal || ["completed", "failed", "canceled"].includes(terminal.status)) {
          console.log(JSON.stringify({ job: terminal && engine.h3DirectPublicStatus(terminal), submission: h3StudioQualificationFailureSnapshot(jobId, ownerKey) }, null, 2));
          if (terminal?.status !== "completed") process.exitCode = 1;
          return;
        }
        if (Date.now() > deadline) { await engine.cancelH3DirectJob(ownerKey, jobId); throw Error("The approved job timed out. Cancellation was requested; review the original receipt before any retry."); }
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    } finally { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
  } finally { releaseH3StudioQualificationAdmission(jobId, ownerKey); }
}
