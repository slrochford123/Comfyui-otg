import fs from "node:fs";
import crypto from "node:crypto";
import { H3_OMNIREF } from "@/lib/h3OmniRef";
import ledger from "@/lib/h3Stage1cLedger.json";
import provenance from "@/lib/h3Stage1cProvenance.json";
import installedStage1c from "@/lib/h3Stage1cInstalled.json";
import { readH3LoraCatalog } from "@/lib/h3LoraCatalogServer";
import { H3_BACKEND_PROFILES, h3TurboLoraForMode } from "@/lib/production/h3Workflows";
import { qualificationEnvironment } from "@/lib/runtime/configPaths";
import { H3_STUDIO_WORKFLOWS, parseH3StudioPlan, studioDimensions, studioBackend, studioGpuPattern, type H3StudioPlan } from "@/lib/h3StudioPlan";
import type { ProductionV2H3BackendId } from "@/lib/production/h3Workflows";
import { H3_STUDIO_COMPILER_VERSION, h3StudioDigest, h3StudioQualificationFingerprint, h3StudioQualificationRequestBinding, stableH3StudioJson, isH3StudioSha256, validH3StudioDependency, type H3StudioDependency } from "@/lib/h3StudioIdentity";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import { h3StudioProduction } from "@/lib/h3StudioAdmission";
import { verifyH3RemoteAssetFiles, type H3RemoteAssetFileIdentity } from "@/lib/h3StudioRemoteInventory";

export type H3StudioRightsClearance = { status: "owner-attested" | "documented"; scope: "private-test";
  environment: "test"; target: "3090" | "5060ti"; ownerKey: string; reference: string };
export type H3StudioAssetEvidence = H3StudioDependency & { rights: H3StudioRightsClearance;
  family: "FL2VA" | "Ref2VA" | "both"; minStrength: number; maxStrength: number;
};
export type H3StudioQualificationRecord = {
  schemaVersion: 2; fingerprint: string; compilerVersion: string; environment: "test"; target: "3090" | "5060ti";
  plan: H3StudioPlan; graphArtifact: { path: string; sha256: string; bytes: number };
  requestDigest: string; requestBinding: ReturnType<typeof h3StudioQualificationRequestBinding>;
  sourceRevision: string; boundGraphDigest: string; templateSha256: string; dependencies: H3StudioDependency[];
  ownerKey: string; jobId: string; promptId: string; gpuUuid: string; completedAt: string;
  output: { sha256: string; bytes: number }; measuredSeconds: number; generationCredits: number;
  outputProbe: { width: number; height: number; fps: number; durationSeconds: number; hasAudio: boolean };
  telemetry: { gpuUuid: string; gpuName: string; totalVramBytes: number; peakVramBytes: number; totalRamBytes: number; peakRamBytes: number; peakSwapBytes: number;
    samples: Array<{ at: string; usedVramBytes: number; usedRamBytes: number; usedSwapBytes: number }> };
  androidPlayback: { acknowledgedBy: string; acknowledgedAt: string; jobId: string; outputSha256: string; played: true };
};
export type H3StudioEvidence = {
  schemaVersion: 2; environment: "test"; target: "3090" | "5060ti"; upstreamAuthorization: H3StudioRightsClearance;
  assets: Record<string, H3StudioDependency & { rights: H3StudioRightsClearance }>;
  loras: Record<string, H3StudioAssetEvidence>;
  qualifications: Record<string, H3StudioQualificationRecord>;
};
export type H3StudioInventory = { backend?: ProductionV2H3BackendId; nodes: Set<string>; models: Set<string>; loras: Set<string>; observedAt: string;
  remoteAssetVerification?: { backend: "rtx5060ti"; checkedAt: string; hashesVerified: true; verifiedFiles?: string[] };
  files?: Set<string>; assets?: Record<string, H3StudioDependency>; assetObservedAt?: string;
  assetFiles?: Record<string, H3StudioAssetFileIdentity>;
  device?: { gpuName: string; gpuUuid?: string; totalVramBytes: number; totalRamBytes: number; freeVramBytes: number; observedAt: string };
  capacity?: { fingerprint: string; gpuUuid: string; gpuName: string; totalVramBytes: number; freeVramBytes: number;
    requiredVramBytes: number; observedAt: string } };
export type H3StudioAssetFileIdentity = { path: string; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
export function matchesH3StudioAssetFile(identity: H3StudioAssetFileIdentity | undefined, bytes: number) {
  if (!identity || !identity.path.startsWith("/")) return false;
  try {
    const stat = fs.lstatSync(identity.path);
    return stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino && stat.size === identity.size && stat.size === bytes
      && stat.mtimeMs === identity.mtimeMs && stat.ctimeMs === identity.ctimeMs;
  } catch { return false; }
}
/** A remote model path must never be stat'ed on the web host as local evidence.
 * TEST remote receipts are owner-only and hash-verified. Current file identity
 * checks are refreshed automatically, not an expiring user qualification gate.
 * These are installation checks, NOT physical generation qualifications. */
export function matchesH3StudioInventoryAsset(inventory: H3StudioInventory, filename: string, bytes: number) {
  if (inventory.backend !== "rtx5060ti") return matchesH3StudioAssetFile(inventory.assetFiles?.[filename], bytes);
  const proof = inventory.remoteAssetVerification;
  const age = proof ? Date.now() - Date.parse(proof.checkedAt) : NaN;
  return !!proof && proof.backend === inventory.backend && proof.hashesVerified === true && age >= 0 && age <= 30_000 && proof.verifiedFiles?.includes(filename) === true
    && inventory.assets?.[filename]?.bytes === bytes && validH3StudioDependency(inventory.assets?.[filename]);
}
// Owner statement in this TEST implementation conversation, not a verified license document
// and not a grant covering any third-party adapter or public/commercial rollout.
export const H3_UPSTREAM_OWNER_ATTESTATION = { status: "owner-attested", date: "2026-10-23", scope: "private TEST installation only", documentReviewed: false, coversThirdPartyLoras: false } as const;
export type H3StudioCatalogItem = {
  id: string; modelId: number; versionId: number; name: string; version: string; category: string; categories: string[];
  source: string; filename: string | null; estimatedBytes: number; installation: "listed-by-worker" | "not-located" | "filename-unresolved";
  sha256: string | null; rights: "unresolved" | "documented" | "owner-attested"; runtime: "unverified" | "evidence-recorded";
  family: "FL2VA" | "Ref2VA" | "both" | null; strength: { min: number; max: number } | null;
  legacyPolicyId: string | null; blockedReasons: string[];
  sourceDeclaredSha256: string | null; filenameConflict: boolean; licenseMetadataAvailable: boolean;
  defaultStrength?: number; triggerWords?: string[]; guidance?: { source: string; notes: string; strengthStatus: string; triggerStatus: string };
};
export function assertH3StudioTest() {
  if (qualificationEnvironment() !== "test") throw Object.assign(new Error("H3 Auto/Manual is available in TEST only."), { status: 404 });
}
export function validH3StudioRights(value: unknown, ownerKey?: string): value is H3StudioRightsClearance {
  const r = value as H3StudioRightsClearance | null;
  return !!r && ["owner-attested", "documented"].includes(r.status) && r.scope === "private-test" && r.environment === "test"
    && ["3090", "5060ti"].includes(r.target) && typeof r.ownerKey === "string" && !!r.ownerKey.trim() && (!ownerKey || r.ownerKey === ownerKey)
    && typeof r.reference === "string" && !!r.reference.trim();
}
export function isH3StudioEvidenceV2(value: unknown): value is H3StudioEvidence {
  const e = value as H3StudioEvidence | null;
  const map = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  return !!e && e.schemaVersion === 2 && e.environment === "test" && ["3090", "5060ti"].includes(e.target) && validH3StudioRights(e.upstreamAuthorization) && e.target === e.upstreamAuthorization.target
    && map(e.assets) && map(e.loras) && map(e.qualifications);
}
/** Owner-only local files; never follow links or accept a browser-selected path. */
export function readH3StudioOwnerBytes(file: string, maxBytes = 1_000_000): Buffer {
  if (!file.startsWith("/") || !process.getuid || process.getuid() === 0) throw new Error("Local owner file required.");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > maxBytes) throw new Error("Owner file must be regular, mode 600 and single-link.");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
export function readH3StudioOwnerJson(file: string, maxBytes = 1_000_000): unknown {
  return JSON.parse(readH3StudioOwnerBytes(file, maxBytes).toString("utf8"));
}
export function readH3StudioEvidence(backend: ProductionV2H3BackendId = "rtx3090"): H3StudioEvidence | null {
  // Never read or import a TEST permission/qualification file in PROD.
  if (h3StudioProduction()) return null;
  assertH3StudioTest();
  const file = backend === "rtx3090" ? process.env.OTG_H3_STUDIO_EVIDENCE_FILE : process.env.OTG_H3_STUDIO_5060TI_EVIDENCE_FILE;
  if (!file) return null;
  try {
    const evidence = readH3StudioOwnerJson(file, 32_000_000);
    return isH3StudioEvidenceV2(evidence) && evidence.target === (backend === "rtx3090" ? "3090" : "5060ti") ? evidence : null;
  } catch { return null; }
}
export async function inspectH3StudioInventory(qualificationJob?: { qualificationJobId: string; ownerKey: string }, backend: ProductionV2H3BackendId = "rtx3090"): Promise<H3StudioInventory> {
  // Fixed existing backend mapping; no client URLs, SSH, downloads or mutations.
  if (!["rtx3090", "rtx5060ti"].includes(backend)) throw new Error("Invalid H3 GPU target.");
  if (qualificationJob && backend !== "rtx3090") throw new Error("The local qualification harness is 3090-only; ordinary jobs use their selected worker.");
  const base = H3_BACKEND_PROFILES[backend].baseUrl;
  const response = await fetch(`${base}/object_info`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("H3 worker inventory is unavailable; no job was submitted.");
  const info = await response.json();
  function choices(node: string, input: string): string[] {
    const value = info[node]?.input?.required?.[input];
    return Array.isArray(value?.[0]) ? value[0].filter((v: unknown) => typeof v === "string") : [];
  }
  // object_info cannot prove hashes/capacity. Absent owner inspection receipt fails closed.
  let receipt: Partial<H3StudioInventory> = {};
  const receiptFile = backend === "rtx3090" ? process.env.OTG_H3_STUDIO_INVENTORY_FILE : process.env.OTG_H3_STUDIO_5060TI_INVENTORY_FILE;
  try { if (!h3StudioProduction() && receiptFile) receipt = readH3StudioOwnerJson(receiptFile) as Partial<H3StudioInventory>; } catch { /* blocked below */ }
  if (receipt.backend && receipt.backend !== backend) receipt = {};
  let remoteAssetVerification: H3StudioInventory["remoteAssetVerification"];
  if (!h3StudioProduction() && backend === "rtx5060ti" && receipt.remoteAssetVerification?.hashesVerified === true && receipt.remoteAssetVerification.backend === backend) {
    try {
      const verifiedFiles = await verifyH3RemoteAssetFiles((receipt.assetFiles || {}) as Record<string, H3RemoteAssetFileIdentity>);
      remoteAssetVerification = { backend, checkedAt: new Date().toISOString(), hashesVerified: true, verifiedFiles };
    } catch { /* No fallback: missing/changed remote files fail integrity below. */ }
  }
  let device: H3StudioInventory["device"];
  try {
    const response = await fetch(`${base}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (response.ok) {
      const stats = await response.json();
      const gpu = stats.devices?.find((d: { name?: string }) => studioGpuPattern(backend).test(d.name || ""));
      if (gpu) device = { gpuName: gpu.name, gpuUuid: gpu.uuid, totalVramBytes: gpu.vram_total, totalRamBytes: stats.system?.ram_total, freeVramBytes: gpu.vram_free, observedAt: new Date().toISOString() };
    }
  } catch { /* live capacity unavailable: no normal admission */ }
  let capacity = receipt?.capacity;
  if (qualificationJob) {
    const { getH3StudioQualificationContext } = await import("@/lib/h3StudioQualification");
    const context = getH3StudioQualificationContext(qualificationJob.qualificationJobId, qualificationJob.ownerKey);
    if (context) {
      const { inspectStudioQualificationRuntime } = await import("@/lib/h3StudioRuntime");
      const runtime = await inspectStudioQualificationRuntime(context.requiredVramBytes);
      if (runtime.gpuUuid !== context.gpuUuid) throw new Error("Qualification GPU identity changed.");
      capacity = { fingerprint: context.fingerprint, gpuUuid: runtime.gpuUuid, gpuName: runtime.gpuName, requiredVramBytes: context.requiredVramBytes,
        freeVramBytes: runtime.freeVramBytes, totalVramBytes: runtime.freeVramBytes + runtime.telemetry.usedVramBytes, observedAt: runtime.checkedAt };
    }
  }
  return { backend, remoteAssetVerification, nodes: new Set(Object.keys(info)), models: new Set(choices("UNETLoader", "unet_name")),
    loras: new Set(choices("LoraLoaderModelOnly", "lora_name")), observedAt: new Date().toISOString(),
    files: new Set([...choices("UNETLoader", "unet_name"), ...choices("CLIPLoader", "clip_name"), ...choices("VAELoader", "vae_name"), ...choices("LoraLoaderModelOnly", "lora_name"), ...choices("ModelPreviewOverrideKJ", "tiny_vae")]),
    assets: receipt?.assets, assetFiles: receipt?.assetFiles, assetObservedAt: receipt?.assetObservedAt, capacity, device };
}
export const h3Stage1cDecisions = () => ({ selected: ledger.decisions.filter(d => d.decision === "SELECT"),
  maybe: ledger.decisions.filter(d => d.decision === "MAYBE"), skipped: ledger.decisions.filter(d => d.decision === "SKIP"), undecided: ledger.unreviewedCatalogVersions });
function validAssetEvidence(value: H3StudioAssetEvidence | undefined): value is H3StudioAssetEvidence {
  return validH3StudioDependency(value) && validH3StudioRights(value.rights) && ["FL2VA", "Ref2VA", "both"].includes(value.family)
    && Number.isFinite(value.minStrength) && Number.isFinite(value.maxStrength) && value.minStrength >= 0 && value.maxStrength <= 2 && value.minStrength <= value.maxStrength;
}
/** Enrich the existing canonical policy store; never create a second writable catalog. */
export function h3StudioCatalog(inventory: H3StudioInventory, evidence = readH3StudioEvidence(inventory.backend)): H3StudioCatalogItem[] {
  evidence = isH3StudioEvidenceV2(evidence) ? evidence : null;
  const policies = readH3LoraCatalog().entries;
  return h3Stage1cDecisions().selected.map(entry => {
    const id = `civitai-${entry.modelId}-${entry.versionId}`;
    const proof = evidence?.loras?.[id];
    const record = provenance.entries.find(p => p.versionId === entry.versionId && p.modelId === entry.modelId);
    const sourceFile = record?.files.find(file => file.primary) || (record?.files.length === 1 ? record.files[0] : undefined);
    const proofSource = record?.files.find(file => proof && file.name === proof.filename.split("/").at(-1));
    const valid = validAssetEvidence(proof) && validH3StudioRights(proof.rights, evidence?.upstreamAuthorization.ownerKey) && !!proofSource && proofSource.bytes === proof.bytes && proofSource.sha256?.toLowerCase() === proof.sha256;
    const production = h3StudioProduction();
    const installedVersion = installedStage1c.entries.find(model => model.versionId === entry.versionId && model.modelId === entry.modelId);
    const registered = production ? policies.find(policy => policy.id === `stage1c-${entry.versionId}` || policy.filename === installedVersion?.filename) : undefined;
    const filename = production && registered ? registered.filename : valid ? proof.filename : entry.fileNames || sourceFile?.name || null;
    // Exact path first; basename is only a discovery lead, never an enablement grant.
    const matches = filename ? [...inventory.loras].filter(name => name === filename || name.split("/").at(-1) === filename) : [];
    const installed = matches.length > 0;
    const legacy = (valid || production) ? policies.find(policy => policy.filename === filename && policy.enabled && policy.approvedForH3 && policy.compatibilityStatus === "approved") : undefined;
    const reasons: string[] = [];
    if (!filename) reasons.push("FILENAME_UNRESOLVED");
    else if (!installed) reasons.push(inventory.backend === "rtx5060ti" ? "NOT_LOCATED_ON_5060TI" : "NOT_LOCATED_ON_3090");
    if (!valid && !production) reasons.push("HASH_AND_SEPARATE_LORA_RIGHTS_REQUIRED");
    if (production && filename && !inventory.loras.has(filename)) reasons.push("EXACT_WORKER_PATH_NOT_LISTED");
    if (valid && !inventory.loras.has(proof.filename)) reasons.push("EXACT_WORKER_PATH_NOT_LISTED");
    if (!legacy) reasons.push("CANONICAL_POLICY_REVIEW_REQUIRED");
    if ([3219346, 3219337, 3297123, 3294126].includes(entry.versionId)) reasons.push("ACCELERATION_ADAPTER_USE_MATCHING_PROFILE_NOT_STYLE_STACK");
    return { id, modelId: entry.modelId, versionId: entry.versionId, name: entry.modelName, version: entry.versionName,
      category: entry.category, categories: [...new Set([entry.category, ...entry.catalogCategories])], source: entry.url,
      filename, estimatedBytes: Math.round(entry.sizeMB * 1024 * 1024), installation: !filename ? "filename-unresolved" : installed ? "listed-by-worker" : "not-located",
      sha256: valid ? proof.sha256 : null, rights: valid ? proof.rights.status : "unresolved", runtime: "unverified",
      family: production && legacy ? legacy.approvedForR2V && (legacy.approvedForT2V || legacy.approvedForI2V) ? "both" : legacy.approvedForR2V ? "Ref2VA" : "FL2VA" : valid ? proof.family : null,
      strength: legacy ? { min: legacy.minStrength, max: legacy.maxStrength } : valid ? { min: proof.minStrength, max: proof.maxStrength } : null,
      defaultStrength: installedVersion?.defaultStrength ?? legacy?.defaultStrength ?? 1,
      triggerWords: installedVersion?.triggerWords ?? legacy?.triggerWords ?? [],
      ...(installedVersion ? { guidance: installedVersion.guidance } : {}),
      sourceDeclaredSha256: sourceFile?.sha256 || null, filenameConflict: record?.filenameConflict || false,
      licenseMetadataAvailable: !!record && !("error" in record.licenseMetadata),
      legacyPolicyId: legacy?.id || null, blockedReasons: reasons };
  });
}
export function studioCheckpoint(plan: H3StudioPlan) {
  if (plan.checkpoint === "fasth3") return H3_OMNIREF.checkpoint;
  if (plan.checkpoint === "singularity") return "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors";
  const family = H3_STUDIO_WORKFLOWS.find(w => w.id === plan.workflowId)!.family;
  return family === "Ref2VA" ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors" : "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
}
export const H3_REF2VA_8STEP_FILE = "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors";
export const H3_FL2VA_8STEP_FILE = h3TurboLoraForMode("h3-text-to-video");
export function studioEvidenceKey(plan: H3StudioPlan) { return [plan.workflowId, plan.checkpoint, plan.profile, plan.attention, plan.quality, plan.orientation, plan.audio, plan.durationSeconds].join(":"); }
export const studioTemplateHash = h3StudioDigest;
export function exactH3StudioQualification(evidence: H3StudioEvidence | null, identity: { fingerprint: string; templateSha256: string; dependencies: H3StudioDependency[]; backend?: ProductionV2H3BackendId }): H3StudioQualificationRecord | null {
  if (!isH3StudioEvidenceV2(evidence)) return null;
  try {
    const q = evidence.qualifications[identity.fingerprint];
    const date = (s: unknown) => typeof s === "string" && Number.isFinite(Date.parse(s)) && Date.parse(s) <= Date.now();
    const sorted = (d: H3StudioDependency[]) => [...d].sort((a,b) => a.filename.localeCompare(b.filename));
    if (!q || q.schemaVersion !== 2 || q.fingerprint !== identity.fingerprint || q.compilerVersion !== H3_STUDIO_COMPILER_VERSION
      || q.environment !== "test" || q.target !== (identity.backend === "rtx5060ti" ? "5060ti" : "3090") || !isH3StudioSha256(q.sourceRevision) || !isH3StudioSha256(q.boundGraphDigest)
      || !isH3StudioSha256(q.requestDigest) || h3StudioDigest(q.requestBinding) !== q.requestDigest || h3StudioDigest(q.requestBinding.plan) !== h3StudioDigest(q.plan)
      || q.templateSha256 !== identity.templateSha256 || !Array.isArray(q.dependencies) || !q.dependencies.every(validH3StudioDependency)
      || h3StudioDigest(sorted(q.dependencies)) !== h3StudioDigest(sorted(identity.dependencies))
      || q.ownerKey !== evidence.upstreamAuthorization.ownerKey || !q.jobId.trim() || !q.promptId.trim() || !q.gpuUuid.trim() || !date(q.completedAt)
      || !isH3StudioSha256(q.output?.sha256) || !Number.isSafeInteger(q.output.bytes) || q.output.bytes <= 0
      || !Number.isFinite(q.measuredSeconds) || q.measuredSeconds <= 0 || !Number.isFinite(q.generationCredits) || q.generationCredits < 0
      || q.androidPlayback?.played !== true || q.androidPlayback.jobId !== q.jobId || q.androidPlayback.outputSha256 !== q.output.sha256
      || q.androidPlayback.acknowledgedBy !== q.ownerKey || !date(q.androidPlayback.acknowledgedAt)
      || Date.parse(q.androidPlayback.acknowledgedAt) < Date.parse(q.completedAt)) return null;
    const graphBytes = readH3StudioOwnerBytes(q.graphArtifact.path, 4_000_000);
    const graph = JSON.parse(graphBytes.toString("utf8")) as H3PromptGraph;
    if (q.graphArtifact.sha256 !== q.boundGraphDigest || !Number.isSafeInteger(q.graphArtifact.bytes) || q.graphArtifact.bytes < 1
      || graphBytes.byteLength !== q.graphArtifact.bytes || crypto.createHash("sha256").update(graphBytes).digest("hex") !== q.graphArtifact.sha256
      || Buffer.byteLength(stableH3StudioJson(graph)) !== q.graphArtifact.bytes || h3StudioDigest(graph) !== q.boundGraphDigest
      || h3StudioQualificationFingerprint({ plan: parseH3StudioPlan(q.plan), graph, templateSha256: q.templateSha256, dependencies: q.dependencies }) !== q.fingerprint) return null;
    const dimensions = studioDimensions(q.plan), probe = q.outputProbe, t = q.telemetry;
    if (!probe || probe.width !== dimensions.width || probe.height !== dimensions.height || Math.abs(probe.fps - 24) > 0.05
      || !Number.isFinite(probe.durationSeconds) || Math.abs(probe.durationSeconds - q.plan.durationSeconds) > 0.12
      || typeof probe.hasAudio !== "boolean" || (q.plan.audio === "mute" ? probe.hasAudio : !probe.hasAudio)
      || !t || t.gpuUuid !== q.gpuUuid || !studioGpuPattern(identity.backend ?? "rtx3090").test(t.gpuName) || !Array.isArray(t.samples) || t.samples.length < 2
      || !Number.isSafeInteger(t.totalVramBytes) || t.totalVramBytes <= 0 || !Number.isSafeInteger(t.totalRamBytes) || t.totalRamBytes <= 0
      || !Number.isSafeInteger(t.peakVramBytes) || t.peakVramBytes <= 0 || t.peakVramBytes > t.totalVramBytes
      || !Number.isSafeInteger(t.peakRamBytes) || t.peakRamBytes <= 0 || t.peakRamBytes > t.totalRamBytes
      || !Number.isSafeInteger(t.peakSwapBytes) || t.peakSwapBytes < 0
      || t.samples.some((s, i) => !date(s.at) || (i > 0 && Date.parse(s.at) <= Date.parse(t.samples[i-1].at))
        || !Number.isSafeInteger(s.usedVramBytes) || s.usedVramBytes < 0 || s.usedVramBytes > t.peakVramBytes
        || !Number.isSafeInteger(s.usedRamBytes) || s.usedRamBytes < 0 || s.usedRamBytes > t.peakRamBytes
        || !Number.isSafeInteger(s.usedSwapBytes) || s.usedSwapBytes < 0 || s.usedSwapBytes > t.peakSwapBytes)
      || Math.max(...t.samples.map(s => s.usedVramBytes)) !== t.peakVramBytes || Math.max(...t.samples.map(s => s.usedRamBytes)) !== t.peakRamBytes
      || Math.max(...t.samples.map(s => s.usedSwapBytes)) !== t.peakSwapBytes) return null;
    return q;
  } catch { return null; }
}
/** Bounded by recorded exact configurations, never a Cartesian capability search. */
export function listH3StudioQualifiedPlans(evidence: H3StudioEvidence | null): H3StudioPlan[] {
  if (!isH3StudioEvidenceV2(evidence)) return [];
  return Object.entries(evidence.qualifications).slice(-256).flatMap(([fingerprint, q]) => {
    try {
      const valid = exactH3StudioQualification(evidence, { fingerprint, templateSha256: q.templateSha256, dependencies: q.dependencies, backend: q.plan.backend });
      return valid ? [parseH3StudioPlan(valid.plan)] : [];
    } catch { return []; }
  });
}
export function validateStudioReadiness(plan: H3StudioPlan, inventory: H3StudioInventory, evidence: H3StudioEvidence | null, templateHash: string) {
  const reasons: string[] = [];
  if (!inventory.models.has(studioCheckpoint(plan))) reasons.push(studioBackend(plan) === "rtx5060ti" ? "CHECKPOINT_NOT_LISTED_ON_5060TI" : "CHECKPOINT_NOT_LISTED_ON_3090");
  if (!h3StudioProduction() && evidence?.target !== (studioBackend(plan) === "rtx5060ti" ? "5060ti" : "3090")) reasons.push("TARGET_ASSET_PROVENANCE_REQUIRED");
  if (plan.checkpoint !== "fasth3" && plan.profile === "ref2va-8step" && !inventory.loras.has(H3_REF2VA_8STEP_FILE)) reasons.push("MATCHING_REF2VA_8STEP_ADAPTER_MISSING");
  if (plan.attention === "vsa" && !inventory.nodes.has("BlockSparseAttention")) reasons.push("VSA_NODE_MISSING");
  if (plan.profile === "fl2va-8step" && !inventory.loras.has(H3_FL2VA_8STEP_FILE)) reasons.push("MATCHING_FL2VA_8STEP_ADAPTER_MISSING");
  if (plan.attention === "project-sla" && !inventory.nodes.has("H3SLAAttention")) reasons.push("PROJECT_SLA_NODE_MISSING");
  if (!h3StudioProduction() && !isH3StudioEvidenceV2(evidence)) reasons.push("ASSET_PROVENANCE_AND_PRIVATE_TEST_AUTHORIZATION_REQUIRED");
  const catalog = h3StudioCatalog(inventory, evidence);
  const family = H3_STUDIO_WORKFLOWS.find(w => w.id === plan.workflowId)!.family;
  for (const selection of plan.loras.filter(l => l.enabled)) {
    const entry = catalog.find(l => l.id === selection.id);
    if (!entry || entry.blockedReasons.length) reasons.push(`LORA_NOT_QUALIFIED:${selection.id}`);
    else if (entry.family !== "both" && entry.family !== family) reasons.push(`LORA_FAMILY_MISMATCH:${selection.id}`);
    else if (!entry.strength || selection.strength < entry.strength.min || selection.strength > entry.strength.max) reasons.push(`LORA_STRENGTH_OUT_OF_RANGE:${selection.id}`);
  }
  return [...new Set(reasons)];
}
