import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3DirectJobInput, H3DirectReference } from "@/lib/h3DirectJobs";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import { h3CharacterVoicesQualificationBinding, h3StudioBoundGraphDigest, h3StudioDigest } from "@/lib/h3StudioIdentity";
import { authorizeH3CharacterVoicesQualificationJob, assertH3StudioQualificationRequest, bindH3StudioLeasedSubmission, captureH3StudioQualificationGraph,
  consumeH3StudioQualificationAdmission, releaseH3StudioQualificationAdmission, runH3StudioLeasedSubmission, type H3CharacterVoicesQualificationApproval } from "@/lib/h3StudioQualification";
import { uploadH3InputToBaseUrl } from "@/lib/production/h3Comfy";
import { h3DirectQualificationFilenames, buildH3CharacterVoiceSubmission } from "@/lib/h3CharacterVoicesServer";
import { normalizeH3AdvancedSettings } from "@/lib/production/h3Settings";

const sourceRevision = "a".repeat(64);
vi.mock("@/lib/h3StudioIdentity", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/h3StudioIdentity")>(), computeH3CharacterVoicesSourceRevision: () => "a".repeat(64) }));
const jobId = "h3-direct-a197a461-ad70-4c05-8a6d-eb2d68f66d9c";
const ownerKey = "pilot-owner";
const gpuUuid = "GPU-exact-3090";
const bridgeRoute = { build: "pinned-test-build", pid: 1234, environment: "TEST" as const, port: 3001 as const };
const requiredVramBytes = 12 * 1024 ** 3;
const approvedPrompt = "<Subject 1> uses <Picture 1>. <Audio 1> is its voice.";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
let directory: string, approvalFile: string, voice: H3DirectReference, request: H3DirectJobInput, graph: H3PromptGraph, approval: H3CharacterVoicesQualificationApproval;
const originalArgv = process.argv;

beforeEach(() => {
  vi.stubEnv("OTG_ENV", "test");
  process.argv = [process.execPath, path.resolve("scripts/h3-studio/qualification.cjs"), "--execute"];
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "h3-exact-approval-"));
  approvalFile = path.join(directory, "approval.json");
  const image = { path: path.join(directory, "picture.png"), name: "Picture", description: "Pinned image" };
  voice = { path: path.join(directory, "voice.wav"), name: "Voice", description: "Pinned WAV" };
  fs.writeFileSync(image.path, "image", { mode: 0o600 }); fs.writeFileSync(voice.path, "voice", { mode: 0o600 });
  request = { mode: "h3-reference-to-video", targetBackend: "rtx3090", quality: "lq", orientation: "landscape", durationSeconds: 5,
    prompt: approvedPrompt, promptFormat: "minimax-official-v1", preserveExactPrompt: true, seed: 4242424243,
    h3Settings: normalizeH3AdvancedSettings({ renderMode: "native" }, 1), optionalLoras: [], firstImage: null, lastImage: null, images: [image], videos: [], audios: [voice],
    characterVoices: { recipe: "native", references: [{ tag: "<Picture 1>", name: "Picture", kind: "image", source: "image", description: "Pinned image" },
      { tag: "<Audio 1>", name: "Voice", kind: "audio", source: "media", description: "Pinned WAV" }], bindings: [], events: [], refMods: [],
      inputHashes: { [image.path]: hash("image"), [voice.path]: hash("voice") }, voiceTargets: [{ characterId: "pilot", modelId: "voice", sample: voice, sha256: hash("voice") }] } };
  graph = buildH3CharacterVoiceSubmission(request, "rtx3090", h3DirectQualificationFilenames(jobId, request)).graph;
  const requestDigest = h3StudioDigest(h3CharacterVoicesQualificationBinding(request)), boundGraphDigest = h3StudioBoundGraphDigest(graph);
  approval = { schemaVersion: 2, kind: "character-voices", environment: "test", target: "3090", maxJobs: 1, approvalId: "owner-exact-approval-0001",
    ownerKey, jobId, sourceRevision, gpuUuid, requiredVramBytes, bridgeRoute, requestDigest, boundGraphDigest, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    fingerprint: h3StudioDigest({ requestDigest, boundGraphDigest }) };
  fs.writeFileSync(approvalFile, JSON.stringify(approval), { mode: 0o600 });
});

afterEach(() => {
  releaseH3StudioQualificationAdmission(jobId, ownerKey);
  fs.rmSync(directory, { recursive: true, force: true });
  process.argv = originalArgv;
  vi.unstubAllEnvs();
});

function authorize(overrides = {}) {
  return authorizeH3CharacterVoicesQualificationJob({ approvalFile, jobId, ownerKey, sourceRevision, requiredVramBytes, bridgeRoute, request, boundGraphDigest: approval.boundGraphDigest, ...overrides });
}

describe("exact Character Voices owner approval", () => {
  it("rejects a web-only or changed owner, source, bridge, prompt, seed, graph, or media", () => {
    process.argv = originalArgv;
    expect(() => authorize()).toThrow(/explicit local TEST CLI/);
    process.argv = [process.execPath, path.resolve("scripts/h3-studio/qualification.cjs"), "--execute"];
    expect(() => authorize({ ownerKey: "different" })).toThrow(/does not match/);
    expect(() => authorize({ sourceRevision: "b".repeat(64) })).toThrow(/does not match/);
    expect(() => authorize({ bridgeRoute: { ...bridgeRoute, pid: 1235 } })).toThrow(/does not match/);
    expect(() => authorize({ request: { ...request, prompt: "different" } })).toThrow(/does not match/);
    expect(() => authorize({ request: { ...request, seed: request.seed + 1 } })).toThrow(/does not match/);
    expect(() => authorize({ boundGraphDigest: "c".repeat(64) })).toThrow(/does not match/);
    fs.writeFileSync(voice.path, "changed bytes");
    expect(() => authorize()).toThrow(/Pinned pilot reference bytes/);
  });

  it("requires unchanged uploaded filenames and permits a single exact lease consumption", async () => {
    authorize();
    expect(() => assertH3StudioQualificationRequest(jobId, ownerKey, { ...request, seed: request.seed + 1 })).toThrow(/changed before upload/);
    assertH3StudioQualificationRequest(jobId, ownerKey, request);
    const changed = structuredClone(graph);
    Object.values(changed).find(node => node.class_type === "LoadAudio")!.inputs.audio = "changed-name.wav";
    expect(() => bindH3StudioLeasedSubmission(jobId, ownerKey, changed, async () => {})).toThrow(/differs from/);

    const lease = bindH3StudioLeasedSubmission(jobId, ownerKey, graph, async () => {
      const consume = (uuid: string) => consumeH3StudioQualificationAdmission({ jobId, ownerKey, sourceRevision, request,
        fingerprint: approval.fingerprint, boundGraphDigest: approval.boundGraphDigest, readyForQualification: true,
        live: { queueRunning: 0, queuePending: 0, gpuUuid: uuid, gpuName: "RTX 3090", freeVramBytes: requiredVramBytes,
          requiredVramBytes, checkedAt: new Date().toISOString(), physicalMutexHeld: true, peerReleaseDisabled: true } });
      expect(consume("wrong-gpu")).toBeNull();
      expect(consume(gpuUuid)).not.toBeNull();
      captureH3StudioQualificationGraph({ jobId, ownerKey, graph });
    });
    await expect(runH3StudioLeasedSubmission(lease, changed)).rejects.toThrow(/no longer available/);
    await expect(runH3StudioLeasedSubmission(lease, graph)).resolves.toBeUndefined();
    await expect(runH3StudioLeasedSubmission(lease, graph)).rejects.toThrow(/no longer available/);
    releaseH3StudioQualificationAdmission(jobId, ownerKey);
    expect(() => authorize()).toThrow(/EEXIST/);
  });

  it("verifies the actual upload buffer before any network function runs", async () => {
    const fetcher = vi.fn();
    await expect(uploadH3InputToBaseUrl({ baseUrl: "http://mock:8189", mediaType: "audio", sourcePath: voice.path, uploadName: "voice", expectedSha256: hash("different"), fetcher })).rejects.toThrow(/exact bytes selected for upload/);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json({ name: "voice.wav" }));
    await expect(uploadH3InputToBaseUrl({ baseUrl: "http://mock:8189", mediaType: "audio", sourcePath: voice.path, uploadName: "voice", expectedSha256: hash("voice"), fetcher })).resolves.toBe("voice.wav");
    expect(fetcher).toHaveBeenCalledWith("http://mock:8189/upload/image", expect.objectContaining({ redirect: "error" }));
  });

  it("binds the Standard I2V opening frame and rejects fabricated native audio sockets", () => {
    const opening = request.images[0];
    const i2v: H3DirectJobInput = {
      ...request, mode: "h3-image-to-video", firstImage: opening, images: [], audios: [],
      prompt: "Camera holds the opening composition. Amelia says <d>Wait.</d>",
      h3Settings: normalizeH3AdvancedSettings({ renderMode: "native" }, 0),
      characterVoices: { ...request.characterVoices!, references: [], inputHashes: { [opening.path]: hash("image") } },
    };
    const exact = h3CharacterVoicesQualificationBinding(i2v);
    const exactGraph = buildH3CharacterVoiceSubmission(i2v, "rtx3090", h3DirectQualificationFilenames(jobId, i2v)).graph;
    expect(exact.firstImage?.sha256).toBe(hash("image"));
    expect(exactGraph["39"].class_type).toBe("MiniMaxH3ImageToVideo");
    expect(Object.values(exactGraph).some(node => node.class_type === "LoadAudio")).toBe(false);
    expect(() => h3CharacterVoicesQualificationBinding({ ...i2v, audios: [voice] })).toThrow(/opening frame and native dialogue/);
  });
});
