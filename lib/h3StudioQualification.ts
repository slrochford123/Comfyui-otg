/** Server/local CLI only. No HTTP handler may expose the authorizer. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveFfprobePath } from "@/lib/ffmpeg";
import { qualificationEnvironment } from "@/lib/runtime/configPaths";
import { readH3StudioOwnerJson, exactH3StudioQualification, type H3StudioEvidence, type H3StudioQualificationRecord } from "@/lib/h3StudioRegistry";
import { H3_STUDIO_COMPILER_VERSION, computeH3StudioSourceRevision, h3StudioBoundGraphDigest, h3StudioDigest, h3StudioQualificationRequestBinding, h3StudioQualificationFingerprint, stableH3StudioJson, isH3StudioSha256, type H3StudioDependency } from "@/lib/h3StudioIdentity";
import type { H3DirectJobInput } from "@/lib/h3DirectJobs";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import { parseH3StudioPlan, type H3StudioPlan } from "@/lib/h3StudioPlan";

export type H3StudioQualificationManifest = {
  qualificationFingerprint: string; boundGraphDigest: string; templateSha256: string;
  dependencies: H3StudioDependency[]; readyForQualification: boolean;
  plan: H3StudioPlan;
  requiredVramBytes: number | null;
};
export type H3StudioQualificationApproval = {
  schemaVersion: 2; approvalId: string; environment: "test"; target: "3090"; ownerKey: string;
  fingerprint: string; requestDigest: string; sourceRevision: string; gpuUuid: string; expiresAt: string; maxJobs: 1;
};
export type H3StudioQualificationLiveCheck = {
  queueRunning: number; queuePending: number; gpuUuid: string; gpuName: string;
  freeVramBytes: number; requiredVramBytes: number; checkedAt: string;
  // Runner must acquire the existing physical mutex and disable peer /free before calling consume.
  physicalMutexHeld: true; peerReleaseDisabled: true;
};
type Pending = { approval: H3StudioQualificationApproval; jobId: string; lockFile: string; consumed: boolean; requiredVramBytes: number;
  plan: H3StudioPlan; requestBinding: ReturnType<typeof h3StudioQualificationRequestBinding>; checkedBeforeUpload: boolean };
// Module-private map and object identity: JSON/HTTP flags cannot manufacture a capability.
const pending = new Map<string, Pending>();
const admissions = new WeakSet<object>();
const consumedAdmissions = new Map<string, H3StudioQualificationAdmission>();
const submittedGraphs = new Map<string, H3PromptGraph>();
export type H3StudioQualificationAdmission = Readonly<{ jobId: string; ownerKey: string; fingerprint: string;
  sourceRevision: string; requestDigest: string; boundGraphDigest: string; gpuUuid: string; admittedAt: string }>;
function localCliOnly() {
  const entry = process.argv[1] && path.resolve(process.argv[1]);
  if (qualificationEnvironment() !== "test" || !process.getuid || process.getuid() === 0 || !process.argv.includes("--execute")
    || entry !== path.resolve(process.cwd(), "scripts/h3-studio/qualification.cjs") || !fs.existsSync(entry) || fs.realpathSync(entry) !== entry) {
    throw new Error("Qualification authorization is available only to the explicit local TEST CLI.");
  }
}
function validLive(live: H3StudioQualificationLiveCheck, gpuUuid: string) {
  const age = Date.now() - Date.parse(live?.checkedAt);
  return live?.physicalMutexHeld === true && live.peerReleaseDisabled === true && live.queueRunning === 0 && live.queuePending === 0
    && live.gpuUuid === gpuUuid && !!gpuUuid && /RTX\s*3090/i.test(live.gpuName) && age >= 0 && age <= 5_000
    && Number.isSafeInteger(live.freeVramBytes) && Number.isSafeInteger(live.requiredVramBytes)
    && live.requiredVramBytes > 0 && live.freeVramBytes >= live.requiredVramBytes;
}
/** Called by the local CLI after job creation, before startH3DirectJob. Consumes approval on disk once. */
export function authorizeH3StudioQualificationJob(input: {
  approvalFile: string; jobId: string; ownerKey: string; sourceRevision: string; manifest: H3StudioQualificationManifest;
  request: H3DirectJobInput;
}) {
  localCliOnly();
  if (pending.size) throw new Error("A local qualification job is already active.");
  const file = path.resolve(input.approvalFile);
  const directory = fs.statSync(path.dirname(file));
  if (file !== input.approvalFile || fs.realpathSync(path.dirname(file)) !== path.dirname(file) || directory.uid !== process.getuid!()
    || (directory.mode & 0o777) !== 0o700) throw new Error("Approval requires an owner-only mode-700 directory without symlinks.");
  const a = readH3StudioOwnerJson(file, 16_000) as H3StudioQualificationApproval;
  const requestBinding = h3StudioQualificationRequestBinding(input.manifest.plan, input.request);
  if (a.schemaVersion !== 2 || a.environment !== "test" || a.target !== "3090" || a.maxJobs !== 1
    || !/^[a-zA-Z0-9-]{16,100}$/.test(a.approvalId) || a.ownerKey !== input.ownerKey || !a.ownerKey?.trim()
    || !isH3StudioSha256(a.fingerprint) || a.fingerprint !== input.manifest.qualificationFingerprint || !input.manifest.readyForQualification
    || !isH3StudioSha256(a.requestDigest) || a.requestDigest !== h3StudioDigest(requestBinding)
    || !Number.isSafeInteger(input.manifest.requiredVramBytes) || input.manifest.requiredVramBytes! <= 0
    || !isH3StudioSha256(a.sourceRevision) || a.sourceRevision !== input.sourceRevision || !a.gpuUuid?.trim()
    || !Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= Date.now() || Date.parse(a.expiresAt) - Date.now() > 60 * 60_000
    || !/^h3-direct-[a-f0-9-]{36}$/.test(input.jobId)) throw new Error("Approval does not bind this exact TEST owner, GPU, fingerprint, source and single job.");
  const lockFile = path.join(path.dirname(file), ".qualification-active");
  const lock = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  fs.closeSync(lock);
  try {
    // Durable one-shot marker. Never remove/reuse this marker, including on failure.
    const used = fs.openSync(path.join(path.dirname(file), `.${a.approvalId}.consumed`), fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(used, JSON.stringify({ jobId: input.jobId, fingerprint: a.fingerprint, requestDigest: a.requestDigest, sourceRevision: a.sourceRevision, consumedAt: new Date().toISOString() }));
    fs.fsyncSync(used); fs.closeSync(used);
    pending.set(input.jobId, { approval: structuredClone(a), jobId: input.jobId, lockFile, consumed: false, requiredVramBytes: input.manifest.requiredVramBytes!,
      plan: structuredClone(input.manifest.plan), requestBinding, checkedBeforeUpload: false });
  } catch (error) { fs.unlinkSync(lockFile); throw error; }
}
/** Detection is server-local. Never infer qualification mode from job.input or request JSON. */
export function hasH3StudioQualificationAdmission(jobId: string, ownerKey: string) {
  const p = pending.get(jobId);
  return !!p && p.approval.ownerKey === ownerKey && (p.consumed || Date.parse(p.approval.expiresAt) > Date.now());
}
export function isStudioQualificationJob(jobId: string, fingerprint: string) {
  const p = pending.get(jobId);
  return !!p && p.approval.fingerprint === fingerprint && Date.parse(p.approval.expiresAt) > Date.now();
}
export const qualificationAllowed = isStudioQualificationJob;
export function assertH3StudioQualificationRequest(jobId: string, ownerKey: string, request: H3DirectJobInput) {
  const p = pending.get(jobId);
  if (!p || p.consumed || !hasH3StudioQualificationAdmission(jobId, ownerKey)
    || h3StudioDigest(h3StudioQualificationRequestBinding(request.studioPlan || p.plan, request)) !== p.approval.requestDigest) throw new Error("Exact approved qualification request changed before upload.");
  p.checkedBeforeUpload = true;
}
export function getH3StudioQualificationRequiredVramBytes(jobId: string, ownerKey: string): number | null {
  return hasH3StudioQualificationAdmission(jobId, ownerKey) ? pending.get(jobId)!.requiredVramBytes : null;
}
export function getH3StudioQualificationContext(jobId: string, ownerKey: string) {
  const p = pending.get(jobId);
  return p && hasH3StudioQualificationAdmission(jobId, ownerKey) ? { fingerprint: p.approval.fingerprint, requiredVramBytes: p.requiredVramBytes, gpuUuid: p.approval.gpuUuid } : null;
}
/** Invoke once, inside the physical mutex, immediately before submitting the freshly compiled graph. */
export function consumeH3StudioQualificationAdmission(input: {
  jobId: string; ownerKey: string; fingerprint: string; sourceRevision: string; boundGraphDigest: string;
  readyForQualification: boolean; live: H3StudioQualificationLiveCheck;
  request: H3DirectJobInput;
}): H3StudioQualificationAdmission | null {
  const p = pending.get(input.jobId);
  if (qualificationEnvironment() !== "test" || !p || p.consumed || !p.checkedBeforeUpload || p.approval.ownerKey !== input.ownerKey
    || p.approval.fingerprint !== input.fingerprint || p.approval.sourceRevision !== input.sourceRevision
    || Date.parse(p.approval.expiresAt) <= Date.now() || !input.readyForQualification || !isH3StudioSha256(input.boundGraphDigest)
    || input.live?.requiredVramBytes !== p.requiredVramBytes || !validLive(input.live, p.approval.gpuUuid)) return null;
  try { if (h3StudioDigest(h3StudioQualificationRequestBinding(input.request.studioPlan || p.plan, input.request)) !== p.approval.requestDigest) return null; } catch { return null; }
  p.consumed = true; // synchronous: competing calls cannot both consume.
  const admission = Object.freeze({ jobId: input.jobId, ownerKey: input.ownerKey, fingerprint: input.fingerprint,
    sourceRevision: input.sourceRevision, requestDigest: p.approval.requestDigest, boundGraphDigest: input.boundGraphDigest, gpuUuid: p.approval.gpuUuid, admittedAt: new Date().toISOString() });
  admissions.add(admission);
  consumedAdmissions.set(input.jobId, admission);
  return admission;
}
export function releaseH3StudioQualificationAdmission(jobId: string, ownerKey: string) {
  const p = pending.get(jobId);
  if (!p || p.approval.ownerKey !== ownerKey) return;
  fs.unlinkSync(p.lockFile); pending.delete(jobId);
  const a = consumedAdmissions.get(jobId);
  if (a) admissions.delete(a);
  consumedAdmissions.delete(jobId);
  submittedGraphs.delete(jobId);
}
/** Capture the actual graph immediately before submit, not a preview or sanitized graph. */
export function captureH3StudioQualificationGraph(input: { jobId: string; ownerKey: string; graph: H3PromptGraph }) {
  const a = consumedAdmissions.get(input.jobId);
  if (!a || !admissions.has(a) || a.ownerKey !== input.ownerKey || submittedGraphs.has(input.jobId)
    || h3StudioBoundGraphDigest(input.graph) !== a.boundGraphDigest) throw new Error("Exact consumed admission and final graph required.");
  submittedGraphs.set(input.jobId, structuredClone(input.graph));
}
/** Local failure artifact only; never a runtime qualification or reusable capability. */
export function h3StudioQualificationFailureSnapshot(jobId: string, ownerKey: string) {
  const p = pending.get(jobId);
  if (!p || p.approval.ownerKey !== ownerKey) return null;
  return { jobId, fingerprint: p.approval.fingerprint, sourceRevision: p.approval.sourceRevision,
    requestDigest: p.approval.requestDigest, requestBinding: p.requestBinding,
    admissionConsumed: p.consumed, admission: consumedAdmissions.get(jobId) || null, graph: submittedGraphs.get(jobId) || null };
}
/** Recording also requires the actual capability object; a serialized clone is rejected. */
export function buildH3StudioQualificationRecord(input: {
  admission: H3StudioQualificationAdmission; manifest: H3StudioQualificationManifest;
  job: { id: string; ownerKey: string; status: string; backend: string | null; promptId: string | null;
    outputPath: string | null; startedAt: string | null; completedAt: string | null };
  androidPlayback: H3StudioQualificationRecord["androidPlayback"];
  graphArtifact: H3StudioQualificationRecord["graphArtifact"];
  telemetry: H3StudioQualificationRecord["telemetry"];
}): H3StudioQualificationRecord {
  const { admission: a, manifest: m, job: j } = input;
  const graph = submittedGraphs.get(j.id);
  if (input.androidPlayback?.played !== true || input.androidPlayback.acknowledgedBy !== a.ownerKey || input.androidPlayback.jobId !== j.id) throw new Error("Successful manual Android playback acknowledgement required; no pass record created.");
  if (!admissions.has(a) || !m.readyForQualification || m.qualificationFingerprint !== a.fingerprint || m.boundGraphDigest !== a.boundGraphDigest
    || !graph || h3StudioQualificationFingerprint({ plan: parseH3StudioPlan(m.plan), graph, templateSha256: m.templateSha256, dependencies: m.dependencies }) !== a.fingerprint
    || j.id !== a.jobId || j.ownerKey !== a.ownerKey || j.status !== "completed" || j.backend !== "rtx3090"
    || !j.promptId || !j.outputPath || !j.startedAt || !j.completedAt || Date.parse(j.completedAt) < Date.parse(a.admittedAt)) throw new Error("Real admitted completed job required.");
  const fd = fs.openSync(j.outputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let output: H3StudioQualificationRecord["output"];
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.uid !== process.getuid?.()) throw new Error("Completed owner output is missing.");
    const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0, n)); }
    output = { sha256: hash.digest("hex"), bytes: stat.size };
  } finally { fs.closeSync(fd); }
  const record: H3StudioQualificationRecord = { schemaVersion: 2, fingerprint: a.fingerprint, compilerVersion: H3_STUDIO_COMPILER_VERSION,
    requestDigest: a.requestDigest, requestBinding: pending.get(j.id)!.requestBinding,
    plan: parseH3StudioPlan(m.plan), graphArtifact: input.graphArtifact,
    telemetry: structuredClone(input.telemetry), outputProbe: probeH3StudioQualificationOutput(j.outputPath),
    environment: "test", target: "3090", sourceRevision: a.sourceRevision, boundGraphDigest: a.boundGraphDigest,
    templateSha256: m.templateSha256, dependencies: structuredClone(m.dependencies), ownerKey: a.ownerKey,
    jobId: j.id, promptId: j.promptId, gpuUuid: a.gpuUuid, completedAt: j.completedAt, output,
    measuredSeconds: (Date.parse(j.completedAt) - Date.parse(j.startedAt)) / 1000, generationCredits: 0, androidPlayback: input.androidPlayback };
  // Reuse the exact same evidence validator used by the normal compiler.
  const envelope = { schemaVersion: 2, environment: "test", target: "3090", upstreamAuthorization: {
    status: "owner-attested", scope: "private-test", environment: "test", target: "3090", ownerKey: a.ownerKey, reference: "record validation only" },
    assets: {}, loras: {}, qualifications: { [a.fingerprint]: record } } as H3StudioEvidence;
  if (!exactH3StudioQualification(envelope, { fingerprint: a.fingerprint, templateSha256: m.templateSha256, dependencies: m.dependencies })) throw new Error("Exact output-bound manual Android playback acknowledgement required.");
  admissions.delete(a); // record only once
  return record;
}
/** Inspect actual finalized media, never caller-supplied metadata or filename extensions. */
export function probeH3StudioQualificationOutput(file: string): H3StudioQualificationRecord["outputProbe"] {
  const parsed = JSON.parse(execFileSync(resolveFfprobePath(), ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8", timeout: 20_000, maxBuffer: 1_000_000 }));
  const streams = parsed.streams as Array<Record<string, unknown>>;
  const video = streams?.find(s => s.codec_type === "video");
  const [n, d = "1"] = String(video?.avg_frame_rate || "0/0").split("/");
  return { width: Number(video?.width), height: Number(video?.height), fps: Number(n) / Number(d),
    durationSeconds: Number(parsed.format?.duration), hasAudio: streams?.some(s => s.codec_type === "audio") || false };
}
/** Local CLI only; main runner need only consume admission and persist the actual manifest/job. */
export function recordH3StudioLocalQualification(input: Omit<Parameters<typeof buildH3StudioQualificationRecord>[0], "admission" | "graphArtifact"> & { sourceRevision: string }) {
  localCliOnly();
  const admission = consumedAdmissions.get(input.job.id);
  if (!admission || admission.sourceRevision !== input.sourceRevision || computeH3StudioSourceRevision() !== input.sourceRevision) throw new Error("Source revision/admission changed.");
  const file = process.env.OTG_H3_STUDIO_EVIDENCE_FILE;
  if (!file) throw new Error("Explicit owner evidence file required.");
  const dir = path.dirname(file), stat = fs.statSync(dir);
  if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700 || fs.realpathSync(dir) !== dir) throw new Error("Evidence directory must be owner-only mode 700 without symlinks.");
  const evidence = readH3StudioOwnerJson(file, 32_000_000) as H3StudioEvidence;
  if (evidence.schemaVersion !== 2 || evidence.upstreamAuthorization?.ownerKey !== admission.ownerKey || !evidence.qualifications) throw new Error("Existing v2 provenance envelope required.");
  const graph = submittedGraphs.get(input.job.id);
  if (!graph || h3StudioBoundGraphDigest(graph) !== admission.boundGraphDigest) throw new Error("Submitted graph capture missing.");
  const graphText = stableH3StudioJson(graph);
  const graphPath = path.join(dir, `graph-${input.job.id}.json`);
  const graphFd = fs.openSync(graphPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(graphFd, graphText); fs.fsyncSync(graphFd); } finally { fs.closeSync(graphFd); }
  const record = buildH3StudioQualificationRecord({ ...input, admission,
    graphArtifact: { path: graphPath, sha256: admission.boundGraphDigest, bytes: Buffer.byteLength(graphText) } });
  const temporary = path.join(dir, `.qualification-${crypto.randomUUID()}.json`);
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ ...evidence, qualifications: { ...evidence.qualifications, [record.fingerprint]: record } }, null, 2));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  consumedAdmissions.delete(input.job.id);
  submittedGraphs.delete(input.job.id);
  return record;
}
