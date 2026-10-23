import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_H3_STUDIO_PLAN, parseH3StudioPlan, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { H3_STUDIO_ASSET_FIELDS, H3_STUDIO_COMPILER_VERSION, h3StudioDigest, h3StudioBoundGraphDigest,
  h3StudioQualificationFingerprint, stableH3StudioJson } from "@/lib/h3StudioIdentity";
import { h3StudioQualificationRequestBinding, h3StudioQualificationRequestDigest } from "@/lib/h3StudioIdentity";
import { compileH3StudioPlan, h3StudioPreviewInput, H3_STUDIO_CAMERA_PROMPT_MODIFIERS, H3_STUDIO_MOTION_PROMPT_MODIFIERS } from "@/lib/h3StudioCompiler";
import { listH3StudioQualifiedPlans, readH3StudioEvidence, readH3StudioOwnerJson, studioCheckpoint,
  type H3StudioEvidence, type H3StudioInventory, type H3StudioQualificationRecord } from "@/lib/h3StudioRegistry";
import { authorizeH3StudioQualificationJob, hasH3StudioQualificationAdmission, isStudioQualificationJob,
  consumeH3StudioQualificationAdmission, releaseH3StudioQualificationAdmission, captureH3StudioQualificationGraph,
  assertH3StudioQualificationRequest, buildH3StudioQualificationRecord, type H3StudioQualificationLiveCheck, type H3StudioQualificationManifest } from "@/lib/h3StudioQualification";
import type { H3DirectJobInput } from "@/lib/h3DirectJobs";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import stageProvenance from "@/lib/h3Stage1cProvenance.json";
import { h3StudioOwnerExperimental } from "@/lib/h3StudioExperimental";
import { assertH3PlannerCapabilityIdentity, h3PlannerSchema } from "@/lib/h3StudioPlanner";

const plan = { ...DEFAULT_H3_STUDIO_PLAN, prompt: "An empty landscape", originalPrompt: "An empty landscape" };
const sha = "a".repeat(64);
function jobRequest(): H3DirectJobInput { return { studioPlan: plan, mode: "h3-text-to-video", quality: "lq", orientation: "landscape", durationSeconds: 5,
  prompt: plan.prompt, seed: plan.seed, optionalLoras: [], firstImage: null, lastImage: null, images: [], videos: [], audios: [], rifeInterpolation60Fps: false }; }
const rights = { status: "owner-attested", scope: "private-test", environment: "test", target: "3090", ownerKey: "owner", reference: "Owner's private TEST authorization; no reviewed written license" } as const;
let temporary: string;
let savedArgv: string[];
const registered = new Set<string>();
beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "h3-studio-phase3-")); fs.chmodSync(temporary, 0o700);
  savedArgv = process.argv;
  vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_H3_STUDIO_EVIDENCE_FILE", "");
});
afterEach(() => {
  for (const id of registered) releaseH3StudioQualificationAdmission(id, "owner"); registered.clear();
  process.argv = savedArgv; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(temporary, { recursive: true, force: true });
});
function ownerFile(name: string, value: unknown) { const file = path.join(temporary, name); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 }); return file; }
function identity(graph: H3PromptGraph, patch = {}, templateSha256 = sha, dependencies = [{ filename: "model", sha256: sha, bytes: 42 }]) {
  return h3StudioQualificationFingerprint({ graph, plan: { ...plan, ...patch }, templateSha256, dependencies });
}
const graph: H3PromptGraph = {
  conditioning: { class_type: "MiniMaxH3ReferenceToVideo", inputs: { prompt: "A landscape", width: 1056, "ref_images.ref_image_0": ["image", 0] } },
  image: { class_type: "LoadImage", inputs: { image: "first.png" } }, noise: { class_type: "RandomNoise", inputs: { noise_seed: 123 } },
  save: { class_type: "SaveVideo", inputs: { filename_prefix: "private/job" } },
};
describe("Phase3 reconciliation and exact graph identity", () => {
  it("compiles registered camera and motion into the real conditioning prompt for both controllers", () => {
    const empty: H3StudioInventory = { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: new Date().toISOString() };
    const baseline = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), empty, null);
    expect(baseline.graph["39"].inputs.prompt).toBe(plan.prompt);
    for (const camera of Object.keys(H3_STUDIO_CAMERA_PROMPT_MODIFIERS) as Array<keyof typeof H3_STUDIO_CAMERA_PROMPT_MODIFIERS>) {
      for (const motion of Object.keys(H3_STUDIO_MOTION_PROMPT_MODIFIERS) as Array<keyof typeof H3_STUDIO_MOTION_PROMPT_MODIFIERS>) {
        const p = { ...plan, camera, motion }, compiled = compileH3StudioPlan(p, h3StudioPreviewInput(p), empty, null);
        const prompt = String(compiled.graph["39"].inputs.prompt);
        expect(prompt).toContain(plan.prompt);
        if (camera !== "none") expect(prompt).toContain(H3_STUDIO_CAMERA_PROMPT_MODIFIERS[camera]);
        if (motion !== "none") expect(prompt).toContain(H3_STUDIO_MOTION_PROMPT_MODIFIERS[motion]);
        if (camera !== "none" || motion !== "none") {
          expect(compiled.manifest.qualificationFingerprint).not.toBe(baseline.manifest.qualificationFingerprint);
          expect(compiled.manifest.submissionGraphSha256).not.toBe(baseline.manifest.submissionGraphSha256);
        }
      }
    }
  });
  it("defaults only added fields when reading an old plan", () => {
    const old = { ...plan } as Record<string, unknown>; for (const k of ["camera", "motion", "sampler", "scheduler", "steps"]) delete old[k];
    expect(parseH3StudioPlan(old)).toEqual(plan);
    delete old.attention; expect(() => parseH3StudioPlan(old)).toThrow(/Incomplete/);
  });
  it("cleans workflow/checkpoint/profile/audio/Combat and incompatible LoRAs in one patch", () => {
    const p = reconcileH3StudioPlan(plan, { workflowId: "reference-edit", checkpoint: "singularity", combatEnabled: true, profile: "ref2va-8step", audio: "original" });
    expect([p.sampler, p.scheduler, p.steps]).toEqual(["euler", "simple", 8]);
    const loras = [{ id: "civitai-1-2", enabled: true, strength: 1 }];
    const next = reconcileH3StudioPlan({ ...p, loras }, { workflowId: "native-t2v" }, [{ id: loras[0].id, family: "Ref2VA", strength: { min: 0, max: 2 } }]);
    expect([next.checkpoint, next.combatEnabled, next.profile, next.audio, next.steps, next.loras.length]).toEqual(["standard", false, "native", "generated", 20, 0]);
    expect(p.combatEnabled).toBe(true);
  });
  it.each(["pan", "dolly", "tracking", "static", "none"])("accepts registered camera %s", camera => expect(parseH3StudioPlan({ ...plan, camera }).camera).toBe(camera));
  it("rejects unregistered sampler settings and camera/motion values", () => {
    for (const patch of [{ sampler: "euler" }, { steps: 8 }, { scheduler: "karras" }, { motion: "fast" }, { camera: "orbit" }]) expect(() => parseH3StudioPlan({ ...plan, ...patch })).toThrow();
  });
  it("reuses prompt/seed/media-name/prefix fingerprint but binds every final input", () => {
    const changed = structuredClone(graph); changed.conditioning.inputs.prompt = "Another scene"; changed.noise.inputs.noise_seed = 456;
    changed.image.inputs.image = "uploaded-uuid.png"; changed.save.inputs.filename_prefix = "another/job";
    expect(identity(changed, { seed: 987, prompt: "Another scene", originalPrompt: "New intent" })).toBe(identity(graph));
    expect(h3StudioBoundGraphDigest(changed)).not.toBe(h3StudioBoundGraphDigest(graph));
    expect(h3StudioBoundGraphDigest(graph)).toBe(crypto.createHash("sha256").update(stableH3StudioJson(graph)).digest("hex"));
  });
  it("retains media counts/types/conditioning links and unknown material prompt/seed fields", () => {
    const patches = [
      (g: H3PromptGraph) => { g.conditioning.inputs["ref_images.ref_image_0"] = ["image", 1]; },
      (g: H3PromptGraph) => { g.extra = { class_type: "LoadAudio", inputs: { audio: "clip.wav" } }; },
      (g: H3PromptGraph) => { g.image.class_type = "LoadVideo"; },
      (g: H3PromptGraph) => { g.conditioning.inputs.width = 608; },
      (g: H3PromptGraph) => { g.material = { class_type: "CustomNode", inputs: { seed: 1, prompt: "material" } }; },
      (g: H3PromptGraph) => { g.conditioning.inputs["ref_audios.ref_audio_0"] = ["image", 0]; },
    ];
    for (const patch of patches) { const g = structuredClone(graph); patch(g); expect(identity(g)).not.toBe(identity(graph)); }
    expect(() => h3StudioBoundGraphDigest({ x: { class_type: "bad", inputs: { missing: undefined } } })).toThrow(/omitted/);
  });
  it("binds Combat/audio/automaticRealism and ordered optional LoRA enabled states/strengths", () => {
    const loras = [{ id: "civitai-1-2", enabled: true, strength: 1 }, { id: "civitai-3-4", enabled: true, strength: 0.6 }];
    const original = identity(graph, { loras });
    for (const patch of [{ combatEnabled: true }, { audio: "mute" }, { checkpoint: "singularity" }, { loras: [...loras].reverse() },
      { loras: [{ ...loras[0], strength: 0.9 }, loras[1]] }, { loras: [{ ...loras[0], enabled: false }, loras[1]] }]) {
      expect(identity(graph, { loras, ...patch })).not.toBe(original);
    }
    expect(identity(graph, {}, "b".repeat(64))).not.toBe(identity(graph));
    expect(identity(graph, {}, sha, [{ filename: "model", sha256: "b".repeat(64), bytes: 42 }])).not.toBe(identity(graph));
    expect(identity(graph, {}, sha, [{ filename: "model", sha256: sha, bytes: 43 }])).not.toBe(identity(graph));
    expect(h3StudioQualificationFingerprint({ graph, plan, templateSha256: sha, dependencies: [], compilerVersion: "changed" })).not.toBe(identity(graph));
  });
});

function readyFixture() {
  const inventory: H3StudioInventory = { nodes: new Set(), models: new Set([studioCheckpoint(plan)]), loras: new Set(), files: new Set(), assets: {}, assetFiles: {}, observedAt: new Date().toISOString(), assetObservedAt: new Date().toISOString() };
  const first = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
  const evidence: H3StudioEvidence = { schemaVersion: 2, environment: "test", target: "3090", upstreamAuthorization: rights, assets: {}, loras: {}, qualifications: {} };
  for (const node of Object.values(first.graph)) {
    inventory.nodes.add(node.class_type);
    const field = H3_STUDIO_ASSET_FIELDS[node.class_type]; if (!field) continue;
    const filename = String(node.inputs[field]);
    const asset = { filename, sha256: sha, bytes: 42 };
    const assetPath = ownerFile(`${crypto.randomUUID()}.asset`, "x".repeat(42)); const stat = fs.statSync(assetPath);
    inventory.assetFiles![filename] = { path: assetPath, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
    inventory.assets![filename] = asset; inventory.files!.add(filename);
    evidence.assets[filename] = { ...asset, rights };
  }
  const second = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence);
  inventory.capacity = { fingerprint: second.manifest.qualificationFingerprint, gpuUuid: "GPU-3090", gpuName: "NVIDIA GeForce RTX 3090", freeVramBytes: 24, requiredVramBytes: 20, totalVramBytes: 24, observedAt: new Date().toISOString() };
  inventory.device = { gpuName: "NVIDIA RTX 3090", gpuUuid: "GPU-3090", totalVramBytes: 24, totalRamBytes: 100, freeVramBytes: 1, observedAt: new Date().toISOString() };
  return { inventory, evidence, built: compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence) };
}
describe("v2 provenance, runtime and physical graph evidence are independent", () => {
  it("allows explicit TEST owner experimentation without forging qualification or bypassing integrity", () => {
    vi.stubEnv("OTG_H3_STUDIO_EXPERIMENTAL_FILE", ownerFile("experimental.json", { schemaVersion: 1, enabled: true, environment: "test", target: "3090", ownerKeys: ["owner"], authorizationReference: "Explicit owner testing authorization" }));
    const { inventory, evidence } = readyFixture();
    expect(h3StudioOwnerExperimental("owner")).toBe(true); expect(h3StudioOwnerExperimental("another-user")).toBe(false);
    const compile = (ownerKey = "owner") => compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence, { ownerKey });
    expect(compile().manifest).toMatchObject({ executable: true, experimental: true, executionBasis: "owner-experimental", estimatedCredits: 0 });
    expect(evidence.qualifications).toEqual({}); expect(compile("another-user").manifest.executable).toBe(false);
    const file = Object.values(inventory.assetFiles!)[0]; fs.appendFileSync(file.path, "changed");
    expect(compile().manifest.executable).toBe(false);
    vi.stubEnv("OTG_ENV", "prod"); expect(h3StudioOwnerExperimental("owner")).toBe(false);
    vi.stubEnv("OTG_ENV", ""); expect(h3StudioOwnerExperimental("owner")).toBe(false);
  });
  it("denies permissive, symlinked or browser-inferred owner experimental policies", () => {
    const policy = ownerFile("unsafe.json", { schemaVersion: 1, enabled: true, environment: "test", target: "3090", ownerKeys: ["owner"], authorizationReference: "Owner" });
    fs.chmodSync(policy, 0o644); vi.stubEnv("OTG_H3_STUDIO_EXPERIMENTAL_FILE", policy); expect(h3StudioOwnerExperimental("owner")).toBe(false);
    fs.chmodSync(policy, 0o600); const link = path.join(temporary, "link.json"); fs.symlinkSync(policy, link);
    vi.stubEnv("OTG_H3_STUDIO_EXPERIMENTAL_FILE", link); expect(h3StudioOwnerExperimental("owner")).toBe(false);
  });
  it("lets the owner director order only registered experimental styles and strengths", () => {
    const capabilities = [{ id: "owner-experiment", plan, qualificationFingerprint: sha, experimental: true,
      allowedLoras: [{ id: "civitai-1-2", name: "Installed style", minStrength: .5, maxStrength: 1 }] }];
    const selected = { ...plan, camera: "pan", motion: "dynamic", loras: [{ id: "civitai-1-2", strength: .7, enabled: true }] };
    expect(assertH3PlannerCapabilityIdentity(selected, capabilities).experimental).toBe(true);
    expect(() => assertH3PlannerCapabilityIdentity({ ...selected, loras: [{ ...selected.loras[0], strength: 1.1 }] }, capabilities)).toThrow();
    expect(() => assertH3PlannerCapabilityIdentity({ ...selected, loras: [{ ...selected.loras[0], id: "civitai-8-9" }] }, capabilities)).toThrow();
    expect(() => assertH3PlannerCapabilityIdentity({ ...selected, quality: "1" }, capabilities)).toThrow();
    expect(JSON.stringify(h3PlannerSchema(capabilities, plan.originalPrompt))).toContain("civitai-1-2");
  });
  it("allows a separately cleared installed LoRA's first qualification without prior runtime proof", () => {
    const { inventory, evidence } = readyFixture();
    const record = stageProvenance.entries.find(e => e.modelId === 2966038 && e.versionId === 3360700)!;
    const source = record.files.find(f => f.primary)!; const id = `civitai-${record.modelId}-${record.versionId}`;
    const filename = `MiniMax-H3/${source.name}`, local = ownerFile("sparse-lora-identity-fixture", "fixture only");
    // Sparse stat fixture, never a model or a generated qualification.
    fs.truncateSync(local, source.bytes); const stat = fs.statSync(local);
    const asset = { filename, bytes: source.bytes, sha256: source.sha256!.toLowerCase() };
    inventory.assets![filename] = asset; inventory.files!.add(filename); inventory.loras.add(filename); inventory.nodes.add("LoraLoaderModelOnly");
    inventory.assetFiles![filename] = { path: local, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
    evidence.assets[filename] = { ...asset, rights };
    evidence.loras[id] = { ...asset, rights, family: "both", minStrength: 0, maxStrength: 2 };
    vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", ownerFile("canonical-policy.json", { version: 1, maxSelections: 3, entries: [{ id: "fixture-policy", filename,
      enabled: true, approvedForH3: true, approvedForT2V: true, approvedForI2V: true, approvedForR2V: true, minStrength: 0, maxStrength: 2,
      compatibilityStatus: "approved", discoveredOn: ["rtx3090"] }] }));
    const p = { ...plan, loras: [{ id, strength: 0.7, enabled: true }] };
    const preview = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, evidence);
    inventory.capacity!.fingerprint = preview.manifest.qualificationFingerprint;
    const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, evidence);
    expect(result.manifest.readyForQualification).toBe(true); expect(result.manifest.executable).toBe(false);
    expect(evidence.qualifications).toEqual({});
    evidence.loras[id].rights = { ...rights, ownerKey: "other-owner" };
    expect(() => compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, evidence)).toThrow(/not available/);
  });
  it("permits first qualification prerequisites without marking executable and includes tiny VAE", () => {
    const { built } = readyFixture(); expect(built.manifest.readyForQualification).toBe(true); expect(built.manifest.executable).toBe(false);
    const node = Object.values(built.graph).find(n => n.class_type === "ModelPreviewOverrideKJ");
    expect(node).toBeDefined(); expect(built.manifest.dependencies.some(d => d.filename === node!.inputs.tiny_vae)).toBe(true);
    expect(built.manifest.submissionGraphSha256).toBe(h3StudioBoundGraphDigest(built.graph));
  });
  it("requires exact output-bound Android acceptance and a real canonical graph artifact", () => {
    const { inventory, evidence, built } = readyFixture(); const m = built.manifest;
    const graphText = stableH3StudioJson(built.graph); const graphPath = ownerFile("submitted-graph.json", graphText);
    const record: H3StudioQualificationRecord = { schemaVersion: 2, fingerprint: m.qualificationFingerprint, compilerVersion: H3_STUDIO_COMPILER_VERSION,
      requestBinding: h3StudioQualificationRequestBinding(plan, jobRequest()), requestDigest: h3StudioQualificationRequestDigest(plan, jobRequest()),
      plan, graphArtifact: { path: graphPath, sha256: m.boundGraphDigest, bytes: Buffer.byteLength(graphText) },
      sourceRevision: sha, boundGraphDigest: m.boundGraphDigest, templateSha256: m.templateSha256, dependencies: m.dependencies,
      environment: "test", target: "3090", ownerKey: "owner", jobId: "fixture-real-completed-job", promptId: "fixture-prompt", gpuUuid: "GPU-3090",
      completedAt: "2026-01-01T00:00:00Z", output: { sha256: sha, bytes: 10 }, measuredSeconds: 100, generationCredits: 0,
      outputProbe: { width: m.width, height: m.height, fps: 24, durationSeconds: 5, hasAudio: true },
      telemetry: { gpuUuid: "GPU-3090", gpuName: "NVIDIA RTX 3090", totalVramBytes: 24, peakVramBytes: 20, totalRamBytes: 100, peakRamBytes: 60, peakSwapBytes: 0,
        samples: [{ at: "2025-12-31T23:59:00Z", usedVramBytes: 20, usedRamBytes: 60, usedSwapBytes: 0 }, { at: "2026-01-01T00:00:00Z", usedVramBytes: 10, usedRamBytes: 50, usedSwapBytes: 0 }] },
      androidPlayback: { acknowledgedBy: "owner", acknowledgedAt: "2026-01-01T00:01:00Z", jobId: "fixture-real-completed-job", outputSha256: sha, played: true } };
    evidence.qualifications[m.qualificationFingerprint] = record;
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.executable).toBe(true);
    expect(listH3StudioQualifiedPlans(evidence)).toEqual([plan]);
    for (const patch of [{ width: 1 }, { fps: 60 }, { durationSeconds: 20 }, { hasAudio: false }]) {
      const previous = { ...record.outputProbe }; Object.assign(record.outputProbe, patch);
      expect(listH3StudioQualifiedPlans(evidence)).toEqual([]); record.outputProbe = previous;
    }
    record.androidPlayback.outputSha256 = "b".repeat(64);
    expect(listH3StudioQualifiedPlans(evidence)).toEqual([]);
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.executable).toBe(false);
    record.androidPlayback.outputSha256 = sha;
    // Old first-run capacity and nearly-full resident VRAM do not expire a qualified plan.
    inventory.capacity!.observedAt = "2020-01-01";
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.executable).toBe(true);
    fs.appendFileSync(graphPath, " ");
    expect(listH3StudioQualifiedPlans(evidence)).toEqual([]);
  });
  it("does not admit stale first-run capacity, changed file identity, bad hashes or old evidence", () => {
    const { inventory, evidence, built } = readyFixture(); inventory.capacity!.observedAt = "2026-01-01";
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.readyForQualification).toBe(false);
    inventory.capacity!.observedAt = new Date().toISOString(); inventory.assetObservedAt = "2020-01-01";
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.readyForQualification).toBe(true);
    fs.appendFileSync(inventory.assetFiles![built.manifest.model].path, "changed");
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.readyForQualification).toBe(false);
    inventory.assets![built.manifest.model].sha256 = "b".repeat(64);
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, evidence).manifest.readyForQualification).toBe(false);
    const file = ownerFile("v1.json", { version: "h3-studio-v1", environment: "test", target: "3090", workflows: { anything: { validationJob: "fake proof" } } });
    vi.stubEnv("OTG_H3_STUDIO_EVIDENCE_FILE", file); expect(readH3StudioEvidence()).toBeNull();
  });
});

const manifest = (): H3StudioQualificationManifest => ({ plan, requiredVramBytes: 20, readyForQualification: true, qualificationFingerprint: identity(graph), boundGraphDigest: h3StudioBoundGraphDigest(graph), templateSha256: sha, dependencies: [{ filename: "model", sha256: sha, bytes: 42 }] });
function authorize(overrides: Record<string, unknown> = {}) {
  process.argv = ["node", path.resolve("scripts/h3-studio/qualification.cjs"), "--execute"];
  const m = manifest(), jobId = `h3-direct-${crypto.randomUUID()}`;
  const approval = { schemaVersion: 2, approvalId: crypto.randomUUID(), environment: "test", target: "3090", ownerKey: "owner",
    fingerprint: m.qualificationFingerprint, requestDigest: h3StudioQualificationRequestDigest(plan, jobRequest()), sourceRevision: sha, gpuUuid: "GPU-3090", expiresAt: new Date(Date.now() + 60_000).toISOString(), maxJobs: 1, ...overrides };
  const approvalFile = ownerFile(`${crypto.randomUUID()}.json`, approval);
  const request = { approvalFile, jobId, ownerKey: "owner", sourceRevision: sha, manifest: m, request: jobRequest() };
  registered.add(jobId);
  return { request, approval, run: (checkBeforeUpload = true) => { authorizeH3StudioQualificationJob(request); if (checkBeforeUpload) assertH3StudioQualificationRequest(jobId, "owner", request.request); } };
}
function live(): H3StudioQualificationLiveCheck { return { queueRunning: 0, queuePending: 0, gpuUuid: "GPU-3090", gpuName: "NVIDIA RTX 3090", freeVramBytes: 24, requiredVramBytes: 20, checkedAt: new Date().toISOString(), physicalMutexHeld: true, peerReleaseDisabled: true }; }
function consumeInput(jobId: string) { return { jobId, ownerKey: "owner", fingerprint: manifest().qualificationFingerprint, sourceRevision: sha, boundGraphDigest: manifest().boundGraphDigest, readyForQualification: true, live: live(), request: jobRequest() }; }
describe("local-only one-shot qualification admission", () => {
  it("retains the graph artifact and creates no pass when Android playback fails", () => {
    const a = authorize(); a.run(); const admission = consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId))!;
    captureH3StudioQualificationGraph({ jobId: a.request.jobId, ownerKey: "owner", graph });
    const graphText = stableH3StudioJson(graph), artifact = ownerFile("retained-failed-review-graph.json", graphText);
    expect(() => buildH3StudioQualificationRecord({ admission, manifest: manifest(), job: { id: a.request.jobId, ownerKey: "owner", status: "completed", backend: "rtx3090", promptId: "fixture", outputPath: null, startedAt: null, completedAt: null },
      graphArtifact: { path: artifact, sha256: manifest().boundGraphDigest, bytes: Buffer.byteLength(graphText) }, telemetry: {} as never,
      androidPlayback: { played: false } as never })).toThrow(/no pass/);
    expect(fs.existsSync(artifact)).toBe(true);
  });
  it("binds prompt/seed/reference bytes before upload and again at final admission", () => {
    const a = authorize(); a.run(false);
    expect(consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId))).toBeNull();
    expect(() => assertH3StudioQualificationRequest(a.request.jobId, "owner", { ...jobRequest(), prompt: "Changed" })).toThrow(/changed/);
    assertH3StudioQualificationRequest(a.request.jobId, "owner", jobRequest());
    expect(consumeH3StudioQualificationAdmission({ ...consumeInput(a.request.jobId), request: { ...jobRequest(), seed: 999 } })).toBeNull();
    expect(consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId))).not.toBeNull();
  });
  it("detects changed reference bytes even at the same path with the same byte count", () => {
    const file = ownerFile("reference.png", "before");
    const request = { ...jobRequest(), images: [{ path: file, name: "reference.png", description: "QA reference" }] };
    const original = h3StudioQualificationRequestDigest(plan, request);
    fs.writeFileSync(file, "after!");
    expect(h3StudioQualificationRequestDigest(plan, request)).not.toBe(original);
    expect(h3StudioQualificationRequestDigest(plan, { ...request, images: [{ ...request.images[0], description: "Changed conditioning" }] })).not.toBe(h3StudioQualificationRequestDigest(plan, request));
  });
  it("rejects browser flags, unknown jobs, cloned capabilities and normal server authorizers", () => {
    expect(consumeH3StudioQualificationAdmission(consumeInput("forged"))).toBeNull();
    const a = authorize(); process.argv = savedArgv; expect(a.run).toThrow(/local TEST CLI/);
    expect(() => buildH3StudioQualificationRecord({ admission: JSON.parse(JSON.stringify(consumeInput("forged"))), manifest: manifest(), job: {} } as never)).toThrow();
  });
  it.each([{ maxJobs: 2 }, { environment: "prod" }, { target: "5060ti" }, { ownerKey: "intruder" }, { sourceRevision: "b".repeat(64) },
    { fingerprint: "b".repeat(64) }, { expiresAt: "2020-01-01" }])("rejects nonexact approval %j", patch => { const a = authorize(patch); expect(a.run).toThrow(); });
  it("rejects insecure permissions, symlinks and hardlinks", () => {
    const a = authorize(); fs.chmodSync(a.request.approvalFile, 0o644); expect(a.run).toThrow(/mode 600/);
    fs.chmodSync(a.request.approvalFile, 0o600); const link = path.join(temporary, "symlink.json"); fs.symlinkSync(a.request.approvalFile, link);
    expect(() => readH3StudioOwnerJson(link)).toThrow(); fs.linkSync(a.request.approvalFile, path.join(temporary, "hardlink.json")); expect(a.run).toThrow(/single-link/);
  });
  it("admits once and prevents reuse and concurrent jobs", () => {
    const a = authorize(); a.run(); expect(hasH3StudioQualificationAdmission(a.request.jobId, "owner")).toBe(true);
    expect(isStudioQualificationJob(a.request.jobId, manifest().qualificationFingerprint)).toBe(true);
    expect(isStudioQualificationJob(a.request.jobId, "b".repeat(64))).toBe(false);
    const b = authorize(); expect(b.run).toThrow(/already active/);
    const admission = consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId)); expect(admission).not.toBeNull();
    expect(consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId))).toBeNull();
    expect(() => captureH3StudioQualificationGraph({ jobId: a.request.jobId, ownerKey: "owner", graph })).not.toThrow();
    releaseH3StudioQualificationAdmission(a.request.jobId, "owner"); expect(a.run).toThrow();
  });
  it("requires idle queue, same GPU, capacity, fresh mutex-held check and unchanged owner/source/config", () => {
    const a = authorize(); a.run();
    for (const patch of [{ queueRunning: 1 }, { queuePending: 1 }, { gpuUuid: "GPU-other" }, { gpuName: "RTX 5060 Ti" }, { physicalMutexHeld: false },
      { peerReleaseDisabled: false }, { freeVramBytes: 1 }, { checkedAt: "2020-01-01" }]) {
      expect(consumeH3StudioQualificationAdmission({ ...consumeInput(a.request.jobId), live: { ...live(), ...patch } } as never)).toBeNull();
    }
    for (const patch of [{ ownerKey: "intruder" }, { sourceRevision: "b".repeat(64) }, { fingerprint: "b".repeat(64) }, { readyForQualification: false }]) expect(consumeH3StudioQualificationAdmission({ ...consumeInput(a.request.jobId), ...patch })).toBeNull();
    expect(consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId))).not.toBeNull();
  });
  it("fails expiry at consumption even after valid authorization", () => {
    vi.useFakeTimers(); const a = authorize(); a.run(); vi.advanceTimersByTime(60_001);
    expect(consumeH3StudioQualificationAdmission(consumeInput(a.request.jobId))).toBeNull();
    expect(hasH3StudioQualificationAdmission(a.request.jobId, "owner")).toBe(false);
  });
});
