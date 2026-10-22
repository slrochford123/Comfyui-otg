import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Store = typeof import("../../../lib/storyCreator/store");
type Audio = typeof import("../../../lib/storyCreator/audioProduction");
type Voices = typeof import("../../../lib/voicesStudio");

let store: Store;
let audio: Audio;
let voices: Voices;
let tempRoot = "";
let ownerKey = "phase7-owner";
let projectId = "";
let planVersion = 0;
let assignmentId = "";
const previousDataDir = process.env.OTG_DATA_DIR;
const previousDataRoot = process.env.OTG_DATA_ROOT;

describe("Story Creator Phase 7 audio production behavior", () => {
  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-story-phase7-"));
    process.env.OTG_DATA_DIR = tempRoot;
    process.env.OTG_DATA_ROOT = tempRoot;
    vi.resetModules();
    store = await import("../../../lib/storyCreator/store");
    audio = await import("../../../lib/storyCreator/audioProduction");
    voices = await import("../../../lib/voicesStudio");

    const project = store.createStoryCreatorProject({ ownerKey, title: "Atheria", format: "feature", genre: "fantasy" });
    projectId = project.id;
    const entity = store.createStoryBibleEntity({ ownerKey, projectId, entityType: "character", name: "Jorog", sourceRole: "user" });
    store.saveStoryProductionPlan({
      ownerKey,
      projectId,
      sourceRole: "user",
      plan: {
        title: "Atheria", format: "feature", summary: "Temple dialogue", targetDurationSeconds: 10,
        acts: [{ id: "act-1", order: 1, title: "Act 1", summary: "", scenes: [{
          id: "scene-1", order: 1, sceneNumber: "1", title: "Temple", purpose: "Arrival",
          location: "Ruined temple", timeOfDay: "night", characters: ["Jorog", "Zeltroi"], action: "They meet",
          dialogue: [], emotionalTone: "tense", continuityRequirements: ["same voices"],
          durationTargetSeconds: 10, screenplaySource: "INT. TEMPLE - NIGHT", shots: [{
            id: "shot-1", order: 1, shotNumber: "1", screenplayExcerpt: "JOROG: We leave before dawn.",
            description: "Jorog warns Zeltroi.", cameraFraming: "close", cameraMovement: "locked", characterActions: "Jorog turns",
            dialogue: [
              { speaker: "Jorog", line: "We leave before dawn.", delivery: "serious" },
              { speaker: "Zeltroi", line: "Then we leave now.", delivery: "angry" },
            ],
            referenceAssetIds: [], generationApproach: "image-to-video", requestedDurationSeconds: 5,
            status: "approved", acceptedTakeId: null, takes: [],
          }],
        }] }],
      },
    });
    planVersion = store.approveStoryProductionPlan({ ownerKey, projectId }).version;

    voices.upsertVoice(ownerKey, {
      voiceId: "voice-jorog", name: "Jorog Voice", tags: ["authorized"], type: "cloned",
      refText: "Authorized fixture", refAudioRel: "samples/jorog.wav", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    assignmentId = audio.saveStoryVoiceAssignment({
      ownerKey, projectId, characterName: "Jorog", entityId: entity.id, voiceId: "voice-jorog",
      authorizedReference: true, speakingStyle: "measured", stability: 0.8,
    }).id;
  });

  afterAll(() => {
    audio.setStoryAudioProductionStorePathForTests(null);
    if (previousDataDir === undefined) delete process.env.OTG_DATA_DIR;
    else process.env.OTG_DATA_DIR = previousDataDir;
    if (previousDataRoot === undefined) delete process.env.OTG_DATA_ROOT;
    else process.env.OTG_DATA_ROOT = previousDataRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("persists authorized character voice identity separately from delivery", () => {
    const context = audio.getStoryAudioShotContext({ ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1" });
    expect(context.voiceAssignments[0]?.voiceId).toBe("voice-jorog");
    expect(context.voiceAssignments[0]?.authorizedReference).toBe(true);
    expect(context.shot.dialogue).toHaveLength(2);
    expect(context.capabilities.music).toContain("ACE-Step");
  });

  it("preserves exact dialogue and flags timing conflicts", () => {
    const asset = audio.prepareStoryAudioAsset({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-1",
      kind: "dialogue", speakerName: "Jorog", exactText: "We leave before dawn.",
      emotion: "serious", delivery: "Pause before dawn.", durationSeconds: 6,
      voiceAssignmentId: assignmentId, idempotencyKey: "dialogue-one",
    });
    expect(asset.exactText).toBe("We leave before dawn.");
    expect(asset.providerContract.endpoint).toBe("/api/voice/tts");
    expect(asset.providerContract.request.text).toBe("We leave before dawn.");
    expect(asset.timingConflict).toBe(true);
    expect(asset.status).toBe("prepared");
  });

  it("requires an authorized voice instead of silently substituting speakers", () => {
    expect(() => audio.prepareStoryAudioAsset({
      ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-1",
      kind: "dialogue", speakerName: "Zeltroi", exactText: "Then we leave now.", idempotencyKey: "missing-voice",
    })).toThrow(/assign an authorized character voice/i);
  });

  it("maps music, effects, mixing, and LTX audio-driven video to verified contracts", () => {
    const music = audio.prepareStoryAudioAsset({ ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1", kind: "music", prompt: "Low strings, tense, 90 BPM", durationSeconds: 10, idempotencyKey: "music-one" });
    const sfx = audio.prepareStoryAudioAsset({ ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1", kind: "sound-effect", prompt: "Distant thunder", startSeconds: 2, durationSeconds: 2, idempotencyKey: "sfx-one" });
    const mix = audio.prepareStoryAudioAsset({ ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1", kind: "mix", sourceAssetIds: [music.id, sfx.id], idempotencyKey: "mix-one" });
    const dialogue = audio.prepareStoryAudioAsset({ ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1", kind: "dialogue", speakerName: "Jorog", exactText: "We leave before dawn.", voiceAssignmentId: assignmentId, idempotencyKey: "lip-dialogue" });
    const dialoguePath = path.join(tempRoot, "lip-dialogue.wav");
    fs.writeFileSync(dialoguePath, "mock audio fixture");
    audio.recordStoryAudioResult({ ownerKey, projectId, assetId: dialogue.id, status: "completed", outputPath: dialoguePath, durationSeconds: 3 });
    const visualPath = path.join(tempRoot, "jorog.png");
    fs.writeFileSync(visualPath, "mock image fixture");
    const visual = store.attachStoryVisualUpload({ ownerKey, projectId, visualKind: "character", name: "Jorog", url: "", filePath: visualPath });
    store.approveStoryVisualVersion({ ownerKey, projectId, versionId: visual.version.id });
    const lip = audio.prepareStoryAudioAsset({ ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1", kind: "lip-sync", visualVersionId: visual.version.id, sourceAudioAssetId: dialogue.id, videoTakeId: "source-video", idempotencyKey: "lip-one" });
    expect(music.providerContract.provider).toBe("ace-step-1.5");
    expect(sfx.providerContract.provider).toBe("sony-woosh");
    expect(mix.providerContract.provider).toBe("ffmpeg");
    expect(lip.providerContract.workflowFile).toBe("production-lipsync.json");
    expect(lip.providerContract.request.visualVersionId).toBe(visual.version.id);
    expect(lip.providerContract.request.audioAssetId).toBe(dialogue.id);
    expect(lip.providerContract.capabilityStatus).toBe("limited");
    expect(lip.providerContract.limitations.join(" ")).toMatch(/does not edit.*in place/i);
  });

  it("separates authorization, completion, acceptance, and revision history", () => {
    const prepared = audio.prepareStoryAudioAsset({
      ownerKey, projectId, sceneId: "scene-1", shotId: "shot-1", kind: "dialogue",
      speakerName: "Jorog", exactText: "We leave before dawn.", voiceAssignmentId: assignmentId,
      idempotencyKey: "lifecycle-source",
    });
    const queued = audio.authorizeStoryAudioAsset({ ownerKey, projectId, assetId: prepared.id });
    expect(queued.status).toBe("queued");
    expect(queued.jobId).toMatch(/^story-audio-/);
    const output = path.join(tempRoot, "dialogue.wav");
    fs.writeFileSync(output, "mock audio fixture");
    const completed = audio.recordStoryAudioResult({ ownerKey, projectId, assetId: prepared.id, status: "completed", outputPath: output, durationSeconds: 3.2 });
    expect(completed.status).toBe("completed");
    expect(audio.setStoryAudioDecision({ ownerKey, projectId, assetId: prepared.id, decision: "accepted" }).status).toBe("accepted");
    const revision = audio.prepareStoryAudioRevision({ ownerKey, projectId, assetId: prepared.id, delivery: "slower", idempotencyKey: "lifecycle-revision" });
    expect(revision.parentAssetId).toBe(prepared.id);
    expect(revision.version).toBeGreaterThan(prepared.version);
    expect(revision.exactText).toBe(prepared.exactText);
    expect(audio.listStoryAudioAssets({ ownerKey, projectId }).find((item) => item.id === prepared.id)?.status).toBe("accepted");
  });

  it("prepares bounded batches without jobs and queues only after explicit approval", () => {
    const batch = audio.prepareStoryAudioBatch({ ownerKey, projectId, sceneIds: ["scene-1"], maxJobs: 5, idempotencyKey: "batch-one" });
    expect(batch.status).toBe("prepared");
    expect(batch.workload.dialogue).toBe(1);
    expect(batch.workload.blockedVoiceAssignments).toBe(1);
    const preparedAssets = audio.listStoryAudioAssets({ ownerKey, projectId }).filter((item) => batch.assetIds.includes(item.id));
    expect(preparedAssets.every((item) => item.status === "prepared")).toBe(true);
    const queued = audio.authorizeStoryAudioBatch({ ownerKey, projectId, batchId: batch.id });
    expect(queued.status).toBe("queued");
    expect(audio.listStoryAudioAssets({ ownerKey, projectId }).filter((item) => batch.assetIds.includes(item.id)).every((item) => item.status === "queued")).toBe(true);
  });

  it("isolates projects and owners", () => {
    expect(() => audio.listStoryAudioAssets({ ownerKey: "outsider", projectId })).toThrow();
    expect(() => audio.saveStoryVoiceAssignment({ ownerKey, projectId, characterName: "Jorog", voiceId: "not-owned", authorizedReference: true })).toThrow(/does not belong/i);
  });
});
