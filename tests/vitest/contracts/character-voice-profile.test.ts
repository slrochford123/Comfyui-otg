import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("character voice profile persistence", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-character-voice-profile-"));
    process.env.OTG_DATA_DIR = tempRoot;
    process.env.AUTH_SECRET ||= "test-secret-for-character-voice-profile";
    vi.resetModules();
  });

  it("updates only characterVoiceProfile and updatedAt on an existing character", async () => {
    const {
      createCharacter,
      loadCharacter,
      updateCharacterVoiceProfile,
    } = await import("@/lib/characters/store");

    const created = createCharacter("owner-a", {
      id: "char-1",
      name: "Char One",
      imagePath: "/tmp/char-one.png",
      description: "Original description",
    });
    const profile = {
      characterId: "char-1",
      provider: "qwen3" as const,
      status: "sample_ready" as const,
      baseSampleUrl: "/mock-assets/voices/cvp_1/sample.wav",
      approvedSampleUrl: "/mock-assets/voices/cvp_1/sample.wav",
      sourceJobId: "cvp_1",
      mockResult: { sampleUrl: "/mock-assets/voices/cvp_1/sample.wav" },
      updatedAt: new Date().toISOString(),
    };

    const updated = updateCharacterVoiceProfile("owner-a", "char-1", profile);
    expect(updated).toMatchObject({
      id: "char-1",
      name: "Char One",
      description: "Original description",
      characterVoiceProfile: profile,
    });
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
    expect(loadCharacter("owner-a", "char-1")?.characterVoiceProfile).toEqual(profile);
    expect(updateCharacterVoiceProfile("owner-a", "missing", profile)).toBeNull();
  });

  it("adds tuned sample fields without deleting the base sample fields", async () => {
    const {
      createCharacter,
      loadCharacter,
      updateCharacterVoiceProfile,
    } = await import("@/lib/characters/store");

    createCharacter("owner-a", {
      id: "char-1",
      name: "Char One",
      imagePath: "/tmp/char-one.png",
      characterVoiceProfile: {
        characterId: "char-1",
        provider: "cosy",
        status: "sample_ready",
        baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
        sourceJobId: "cvp_base",
        updatedAt: "2026-05-25T12:00:00.000Z",
      },
    });

    const tunedProfile = {
      characterId: "char-1",
      provider: "cosy" as const,
      status: "sample_ready" as const,
      baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      sourceJobId: "cvp_base",
      tunedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
      tunedSamplePath: "/tmp/fx.wav",
      tunedFxPreset: "robotic" as const,
      tunedSourceJobId: "cvp_fx",
      tunedAt: "2026-05-25T12:05:00.000Z",
      tunedResult: {
        adapter: "voice_fx",
        processedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
      },
      updatedAt: "2026-05-25T12:05:00.000Z",
    };

    const tuned = updateCharacterVoiceProfile("owner-a", "char-1", tunedProfile);
    expect(tuned?.characterVoiceProfile).toMatchObject({
      baseSampleUrl: tunedProfile.baseSampleUrl,
      approvedSampleUrl: tunedProfile.baseSampleUrl,
      tunedSampleUrl: tunedProfile.tunedSampleUrl,
      tunedFxPreset: "robotic",
      tunedSourceJobId: "cvp_fx",
    });

    const approvedTunedProfile = {
      ...tunedProfile,
      approvedSampleUrl: tunedProfile.tunedSampleUrl,
      approvedSamplePath: tunedProfile.tunedSamplePath,
      updatedAt: "2026-05-25T12:06:00.000Z",
    };

    updateCharacterVoiceProfile("owner-a", "char-1", approvedTunedProfile);
    expect(loadCharacter("owner-a", "char-1")?.characterVoiceProfile).toMatchObject({
      baseSampleUrl: tunedProfile.baseSampleUrl,
      tunedSampleUrl: tunedProfile.tunedSampleUrl,
      approvedSampleUrl: tunedProfile.tunedSampleUrl,
    });
  });

  it("supports update_voice_profile through the characters API", async () => {
    const { createCharacter } = await import("@/lib/characters/store");
    createCharacter("device-a", {
      id: "char-1",
      name: "Char One",
      imagePath: "/tmp/char-one.png",
      description: "Original description",
    });

    const { POST } = await import("@/app/api/characters/route");
    const profile = {
      characterId: "char-1",
      provider: "cosy",
      status: "sample_ready",
      baseSampleUrl: "/mock-assets/voices/cvp_2/sample.wav",
      approvedSampleUrl: "/mock-assets/voices/cvp_2/sample.wav",
      sourceJobId: "cvp_2",
      mockResult: { sampleUrl: "/mock-assets/voices/cvp_2/sample.wav" },
      updatedAt: new Date().toISOString(),
    };
    const request = new NextRequest("http://localhost/api/characters", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "device-a",
      },
      body: JSON.stringify({
        action: "update_voice_profile",
        id: "char-1",
        characterVoiceProfile: profile,
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      character: {
        id: "char-1",
        characterVoiceProfile: profile,
      },
    });
    expect(json.items).toHaveLength(1);
  });

  it("persists Applio training artifact metadata without deleting approved sample provenance", async () => {
    const {
      createCharacter,
      loadCharacter,
      updateCharacterVoiceProfile,
    } = await import("@/lib/characters/store");

    createCharacter("owner-a", {
      id: "char-1",
      name: "Char One",
      imagePath: "/tmp/char-one.png",
      characterVoiceProfile: {
        characterId: "char-1",
        provider: "qwen3",
        status: "sample_ready",
        baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
        approvedSamplePath: path.join(tempRoot, "characters", "owner-a", "voice-samples", "char-1", "cvp_base", "sample.wav"),
        sourceJobId: "cvp_base",
        updatedAt: "2026-05-25T12:00:00.000Z",
      },
    });

    const profileWithArtifact = {
      characterId: "char-1",
      provider: "qwen3" as const,
      status: "ready" as const,
      baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      approvedSamplePath: path.join(tempRoot, "characters", "owner-a", "voice-samples", "char-1", "cvp_base", "sample.wav"),
      sourceJobId: "cvp_base",
      trainingJobId: "cvp_applio",
      voiceModelArtifactId: "voice_model_char-1_cvp_applio",
      trainingArtifactPath: path.join(tempRoot, "characters", "owner-a", "applio-models", "char-1", "cvp_applio", "training-artifact.json"),
      datasetManifestPath: path.join(tempRoot, "characters", "owner-a", "training-datasets", "char-1", "cvp_dataset", "manifest.json"),
      modelPath: path.join(tempRoot, "characters", "owner-a", "applio-models", "char-1", "cvp_applio", "voice_model_char-1_cvp_applio.pth"),
      indexPath: path.join(tempRoot, "characters", "owner-a", "applio-models", "char-1", "cvp_applio", "voice_model_char-1_cvp_applio.index"),
      voiceModelArtifacts: [
        {
          id: "voice_model_char-1_cvp_applio",
          characterId: "char-1",
          provider: "applio" as const,
          mode: "noop" as const,
          status: "training_artifact_ready" as const,
          jobId: "cvp_applio",
          sourceJobId: "cvp_applio",
          trainingArtifactPath: path.join(tempRoot, "characters", "owner-a", "applio-models", "char-1", "cvp_applio", "training-artifact.json"),
          datasetManifestPath: path.join(tempRoot, "characters", "owner-a", "training-datasets", "char-1", "cvp_dataset", "manifest.json"),
          modelPath: path.join(tempRoot, "characters", "owner-a", "applio-models", "char-1", "cvp_applio", "voice_model_char-1_cvp_applio.pth"),
          indexPath: path.join(tempRoot, "characters", "owner-a", "applio-models", "char-1", "cvp_applio", "voice_model_char-1_cvp_applio.index"),
          approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
          clipCount: 200,
          mock: true,
          result: { adapter: "applio_training_artifact", mock: true },
          createdAt: "2026-05-25T12:10:00.000Z",
          updatedAt: "2026-05-25T12:10:00.000Z",
        },
      ],
      updatedAt: "2026-05-25T12:10:00.000Z",
    };

    updateCharacterVoiceProfile("owner-a", "char-1", profileWithArtifact);
    expect(loadCharacter("owner-a", "char-1")?.characterVoiceProfile).toMatchObject({
      status: "ready",
      baseSampleUrl: profileWithArtifact.baseSampleUrl,
      approvedSampleUrl: profileWithArtifact.approvedSampleUrl,
      voiceModelArtifactId: "voice_model_char-1_cvp_applio",
      trainingJobId: "cvp_applio",
      trainingArtifactPath: profileWithArtifact.trainingArtifactPath,
      datasetManifestPath: profileWithArtifact.datasetManifestPath,
      modelPath: profileWithArtifact.modelPath,
      indexPath: profileWithArtifact.indexPath,
      voiceModelArtifacts: [
        {
          provider: "applio",
          mode: "noop",
          sourceJobId: "cvp_applio",
          approvedSampleUrl: profileWithArtifact.approvedSampleUrl,
          clipCount: 200,
        },
      ],
    });
  });

  it("builds and persists real trained Applio artifact metadata from nested artifact results", async () => {
    const {
      createCharacter,
      loadCharacter,
      updateCharacterVoiceProfile,
    } = await import("@/lib/characters/store");
    const { buildApplioTrainingArtifactVoiceProfile } = await import("@/lib/characterVoiceAudioStudio");

    const modelDir = path.join(tempRoot, "characters", "owner-a", "applio-models", "voice-training-8", "cvp_applio");
    fs.mkdirSync(modelDir, { recursive: true });
    const modelPath = path.join(modelDir, "voice_model_voice-training-8_cvp_applio.pth");
    const indexPath = path.join(modelDir, "voice_model_voice-training-8_cvp_applio.index");
    const artifactPath = path.join(modelDir, "training-artifact.json");
    const manifestPath = path.join(tempRoot, "characters", "owner-a", "training-datasets", "voice-training-8", "cvp_dataset", "manifest.json");
    fs.writeFileSync(modelPath, "real pth bytes", "utf8");
    fs.writeFileSync(indexPath, "real index bytes", "utf8");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "{}", "utf8");

    createCharacter("owner-a", {
      id: "voice-training-8",
      name: "Voice Training 8",
      imagePath: "/tmp/voice-training-8.png",
      characterVoiceProfile: {
        characterId: "voice-training-8",
        provider: "qwen3",
        status: "sample_ready",
        baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=voice-training-8&jobId=cvp_base",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=voice-training-8&jobId=cvp_base",
        approvedSamplePath: path.join(tempRoot, "characters", "owner-a", "voice-samples", "voice-training-8", "cvp_base", "sample.wav"),
        sourceJobId: "cvp_base",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
    });

    const currentProfile = loadCharacter("owner-a", "voice-training-8")?.characterVoiceProfile;
    const profile = buildApplioTrainingArtifactVoiceProfile({
      characterId: "voice-training-8",
      jobId: "cvp_applio",
      currentProfile,
      result: {
        status: "trained",
        mock: false,
        adapter: "applio_real_training",
        artifactPath,
        artifactUrl: "/api/characters/applio-training/artifact?owner=owner-a&characterId=voice-training-8&jobId=cvp_applio",
        dataset: {
          manifestPath,
          manifestUrl: "/api/characters/training-dataset/manifest?owner=owner-a&characterId=voice-training-8&jobId=cvp_dataset",
          sourceDatasetJobId: "cvp_dataset",
          clipCount: 200,
          approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=voice-training-8&jobId=cvp_base",
        },
        model: {
          modelName: "voice_model_voice-training-8_cvp_applio",
          modelPath,
          indexPath,
          status: "trained",
        },
        trainingQualityPreset: "quality",
        epochs: 200,
        saveEveryEpoch: 10,
        estimatedDurationLabel: "90-180+ minutes",
        trainingStartedAt: "2026-05-28T12:00:00.000Z",
        trainingCompletedAt: "2026-05-28T14:00:00.000Z",
        totalTrainingMs: 7200000,
        totalTrainingLabel: "2h 0m 0s",
      },
    });

    expect(profile).toMatchObject({
      characterId: "voice-training-8",
      status: "trained",
      trainingAdapter: "applio_real_training",
      trainingMock: false,
      sourceTrainingJobId: "cvp_applio",
      voiceModelArtifactId: "voice_model_voice-training-8_cvp_applio",
      trainingArtifactPath: artifactPath,
      datasetManifestPath: manifestPath,
      modelPath,
      indexPath,
      trainingQualityPreset: "quality",
      epochs: 200,
      saveEveryEpoch: 10,
      trainingStartedAt: "2026-05-28T12:00:00.000Z",
      trainingCompletedAt: "2026-05-28T14:00:00.000Z",
      totalTrainingMs: 7200000,
      totalTrainingLabel: "2h 0m 0s",
      voiceModelArtifacts: [
        {
          provider: "applio",
          mode: "real",
          status: "trained",
          adapter: "applio_real_training",
          mock: false,
          modelPath,
          indexPath,
          sourceDatasetJobId: "cvp_dataset",
          trainingQualityPreset: "quality",
          epochs: 200,
          saveEveryEpoch: 10,
          totalTrainingLabel: "2h 0m 0s",
        },
      ],
    });

    updateCharacterVoiceProfile("owner-a", "voice-training-8", profile!);
    const reloaded = loadCharacter("owner-a", "voice-training-8")?.characterVoiceProfile;
    expect(reloaded).toMatchObject({
      status: "trained",
      trainingAdapter: "applio_real_training",
      trainingMock: false,
      modelPath,
      indexPath,
      trainingQualityPreset: "quality",
      epochs: 200,
      saveEveryEpoch: 10,
      totalTrainingLabel: "2h 0m 0s",
      voiceModelArtifacts: [{ mock: false, modelPath, indexPath, trainingQualityPreset: "quality" }],
    });
  });

  it("does not persist a trained Applio profile when model or index files are missing", async () => {
    const {
      createCharacter,
      loadCharacter,
      updateCharacterVoiceProfile,
    } = await import("@/lib/characters/store");

    createCharacter("owner-a", {
      id: "char-missing-artifact",
      name: "Missing Artifact",
      imagePath: "/tmp/missing-artifact.png",
      characterVoiceProfile: {
        characterId: "char-missing-artifact",
        provider: "qwen3",
        status: "sample_ready",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-missing-artifact&jobId=cvp_base",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
    });
    const before = loadCharacter("owner-a", "char-missing-artifact")?.characterVoiceProfile;
    const invalidProfile = {
      ...before!,
      status: "trained" as const,
      trainingAdapter: "applio_real_training",
      trainingMock: false,
      voiceModelArtifactId: "voice_model_missing",
      modelPath: path.join(tempRoot, "missing.pth"),
      indexPath: path.join(tempRoot, "missing.index"),
      voiceModelArtifacts: [
        {
          id: "voice_model_missing",
          characterId: "char-missing-artifact",
          provider: "applio" as const,
          mode: "real" as const,
          status: "trained" as const,
          adapter: "applio_real_training",
          jobId: "cvp_missing",
          sourceJobId: "cvp_missing",
          sourceTrainingJobId: "cvp_missing",
          modelPath: path.join(tempRoot, "missing.pth"),
          indexPath: path.join(tempRoot, "missing.index"),
          mock: false,
          createdAt: "2026-05-28T12:10:00.000Z",
          updatedAt: "2026-05-28T12:10:00.000Z",
        },
      ],
      updatedAt: "2026-05-28T12:10:00.000Z",
    };

    expect(() => updateCharacterVoiceProfile("owner-a", "char-missing-artifact", invalidProfile)).toThrow(
      /Cannot persist trained Applio voice profile/,
    );
    expect(loadCharacter("owner-a", "char-missing-artifact")?.characterVoiceProfile).toEqual(before);
  });

  it("saves trained Applio artifact metadata when the character is created after training", async () => {
    const { createCharacter, loadCharacter } = await import("@/lib/characters/store");
    const modelDir = path.join(tempRoot, "characters", "owner-a", "applio-models", "draft-char", "cvp_applio");
    fs.mkdirSync(modelDir, { recursive: true });
    const modelPath = path.join(modelDir, "voice_model_draft-char_cvp_applio.pth");
    const indexPath = path.join(modelDir, "voice_model_draft-char_cvp_applio.index");
    fs.writeFileSync(modelPath, "real pth bytes", "utf8");
    fs.writeFileSync(indexPath, "real index bytes", "utf8");

    createCharacter("owner-a", {
      id: "draft-char",
      name: "Draft Char",
      imagePath: "/tmp/draft-char.png",
      characterVoiceProfile: {
        characterId: "draft-char",
        provider: "qwen3",
        status: "trained",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=draft-char&jobId=cvp_base",
        trainingJobId: "cvp_applio",
        sourceTrainingJobId: "cvp_applio",
        trainingAdapter: "applio_real_training",
        trainingMock: false,
        voiceModelArtifactId: "voice_model_draft-char_cvp_applio",
        modelPath,
        indexPath,
        voiceModelArtifacts: [
          {
            id: "voice_model_draft-char_cvp_applio",
            characterId: "draft-char",
            provider: "applio",
            mode: "real",
            status: "trained",
            adapter: "applio_real_training",
            jobId: "cvp_applio",
            sourceJobId: "cvp_applio",
            sourceTrainingJobId: "cvp_applio",
            modelPath,
            indexPath,
            mock: false,
            createdAt: "2026-05-28T12:10:00.000Z",
            updatedAt: "2026-05-28T12:10:00.000Z",
          },
        ],
        updatedAt: "2026-05-28T12:10:00.000Z",
      },
    });

    expect(loadCharacter("owner-a", "draft-char")?.characterVoiceProfile).toMatchObject({
      status: "trained",
      trainingAdapter: "applio_real_training",
      trainingMock: false,
      modelPath,
      indexPath,
      voiceModelArtifacts: [{ mode: "real", mock: false, modelPath, indexPath }],
    });
  });

  it("persists uploaded voice profile fields and deletes only the requested character", async () => {
    const { createCharacter, loadCharacter } = await import("@/lib/characters/store");
    createCharacter("device-a", {
      id: "char-1",
      name: "Char One",
      imagePath: "/tmp/char-one.png",
    });
    createCharacter("device-a", {
      id: "char-2",
      name: "Char Two",
      imagePath: "/tmp/char-two.png",
    });

    const { POST } = await import("@/app/api/characters/route");
    const uploadedProfile = {
      characterId: "char-1",
      provider: "uploaded",
      status: "sample_ready",
      baseSamplePath: path.join(tempRoot, "sample.wav"),
      baseSampleUrl: "/api/characters/voice-sample/file?owner=device-a&characterId=char-1&jobId=uploaded_abc&file=sample.wav",
      approvedSamplePath: path.join(tempRoot, "sample.wav"),
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=device-a&characterId=char-1&jobId=uploaded_abc&file=sample.wav",
      sourceJobId: "uploaded_voice",
      mockResult: { provider: "uploaded", adapter: "uploaded_voice", mock: false },
      updatedAt: new Date().toISOString(),
    };

    const update = await POST(new NextRequest("http://localhost/api/characters", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "device-a",
      },
      body: JSON.stringify({
        action: "update_voice_profile",
        id: "char-1",
        characterVoiceProfile: uploadedProfile,
      }),
    }));
    expect(update.status).toBe(200);
    expect(loadCharacter("device-a", "char-1")?.characterVoiceProfile).toMatchObject({
      provider: "uploaded",
      baseSampleUrl: uploadedProfile.baseSampleUrl,
      baseSamplePath: uploadedProfile.baseSamplePath,
      status: "sample_ready",
    });

    const deleted = await POST(new NextRequest("http://localhost/api/characters", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "device-a",
      },
      body: JSON.stringify({ action: "delete", id: "char-1" }),
    }));
    const json = await deleted.json();
    expect(deleted.status).toBe(200);
    expect(json.items.map((item: { id: string }) => item.id)).toEqual(["char-2"]);
    expect(loadCharacter("device-a", "char-1")).toBeNull();
    expect(loadCharacter("device-a", "char-2")?.name).toBe("Char Two");
  });

  it("uploads a voice sample through the safe upload route and rejects invalid extensions", async () => {
    const { POST } = await import("@/app/api/characters/voice-sample/upload/route");
    const requestForForm = (form: FormData) => ({
      headers: new Headers({ "x-otg-device-id": "device-a" }),
      formData: async () => form,
    }) as unknown as NextRequest;
    const wavBytes = Buffer.from("RIFF$\0\0\0WAVEfmt ", "binary");
    const wavFile = new File([wavBytes], "voice.wav", { type: "audio/wav" });
    Object.defineProperty(wavFile, "arrayBuffer", {
      value: async () => wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength),
    });

    const form = new FormData();
    form.append("characterId", "char-1");
    form.append("file", wavFile);

    const response = await POST(requestForForm(form));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      provider: "uploaded",
      adapter: "uploaded_voice",
      mock: false,
      fileName: "sample.wav",
    });
    expect(json.sampleUrl).toContain("/api/characters/voice-sample/file?");
    expect(json.sampleUrl).toContain("file=sample.wav");
    expect(fs.existsSync(json.samplePath)).toBe(true);

    const badForm = new FormData();
    badForm.append("characterId", "../bad");
    badForm.append("file", new File(["bad"], "voice.exe", { type: "application/octet-stream" }));
    const rejected = await POST(requestForForm(badForm));
    const rejectedJson = await rejected.json();
    expect(rejected.status).toBe(400);
    expect(rejectedJson.error).toMatch(/extension/i);
  });

  it("rejects unsafe uploaded voice sample file route parameters", async () => {
    const { GET } = await import("@/app/api/characters/voice-sample/file/route");
    const response = await GET(new NextRequest("http://localhost/api/characters/voice-sample/file?owner=device-a&characterId=char-1&jobId=uploaded_abc&file=../sample.wav"));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid voice sample file.");
  });

  it("finds a usable real trained Applio artifact for inference after profile reload", async () => {
    const { createCharacter, loadCharacter, updateCharacterVoiceProfile } = await import("@/lib/characters/store");
    const { findUsableTrainedVoiceArtifact } = await import("@/lib/characterVoiceAudioStudio");
    const modelPath = path.join(tempRoot, "model.pth");
    const indexPath = path.join(tempRoot, "model.index");
    fs.writeFileSync(modelPath, "real model", "utf8");
    fs.writeFileSync(indexPath, "real index", "utf8");

    createCharacter("owner-a", {
      id: "char-1",
      name: "Char One",
      imagePath: "/tmp/char-one.png",
    });
    updateCharacterVoiceProfile("owner-a", "char-1", {
      characterId: "char-1",
      provider: "qwen3",
      status: "trained",
      approvedSamplePath: path.join(tempRoot, "approved.wav"),
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      trainingAdapter: "applio_real_training",
      trainingMock: false,
      voiceModelArtifactId: "voice_model_char-1",
      modelPath,
      indexPath,
      voiceModelArtifacts: [
        {
          id: "voice_model_char-1",
          characterId: "char-1",
          provider: "applio",
          mode: "real",
          status: "trained",
          adapter: "applio_real_training",
          jobId: "cvp_train",
          sourceJobId: "cvp_train",
          sourceTrainingJobId: "cvp_train",
          modelPath,
          indexPath,
          mock: false,
          createdAt: "2026-05-28T10:00:00.000Z",
          updatedAt: "2026-05-28T10:00:00.000Z",
        },
      ],
      updatedAt: "2026-05-28T10:00:00.000Z",
    });

    const reloaded = loadCharacter("owner-a", "char-1")?.characterVoiceProfile;
    const artifact = findUsableTrainedVoiceArtifact(reloaded);

    expect(artifact).toMatchObject({
      id: "voice_model_char-1",
      adapter: "applio_real_training",
      mock: false,
      modelPath,
      indexPath,
    });
  });

  it("recovers a valid real trained Applio artifact from durable training-artifact JSON", async () => {
    const { createCharacter, loadCharacter, updateCharacterVoiceProfile } = await import("@/lib/characters/store");
    const { recoverLatestTrainedApplioVoiceProfile } = await import("@/lib/jobs/applioArtifactRecovery");

    createCharacter("owner-a", {
      id: "voice-training-8",
      name: "Voice Training 8",
      imagePath: "/tmp/voice-training-8.png",
      characterVoiceProfile: {
        characterId: "voice-training-8",
        provider: "qwen3",
        status: "sample_ready",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=voice-training-8&jobId=cvp_base",
        updatedAt: "2026-05-28T09:00:00.000Z",
      },
    });

    const artifactDir = path.join(tempRoot, "characters", "owner-a", "applio-models", "voice-training-8", "cvp_train");
    const modelPath = path.join(artifactDir, "voice_model_voice-training-8_cvp_train.pth");
    const indexPath = path.join(artifactDir, "voice_model_voice-training-8_cvp_train.index");
    const artifactPath = path.join(artifactDir, "training-artifact.json");
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(modelPath, "real model bytes", "utf8");
    fs.writeFileSync(indexPath, "real index bytes", "utf8");
    fs.writeFileSync(artifactPath, JSON.stringify({
      schemaVersion: 1,
      ownerKey: "owner-a",
      characterId: "voice-training-8",
      jobId: "cvp_train",
      createdAt: "2026-05-28T10:00:00.000Z",
      status: "trained",
      mock: false,
      adapter: "applio_real_training",
      dataset: {
        manifestPath: path.join(tempRoot, "characters", "owner-a", "training-datasets", "voice-training-8", "cvp_dataset", "manifest.json"),
        manifestUrl: "/api/characters/training-dataset/manifest?owner=owner-a&characterId=voice-training-8&jobId=cvp_dataset",
        sourceDatasetJobId: "cvp_dataset",
        clipCount: 200,
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=voice-training-8&jobId=cvp_base",
      },
      model: {
        modelName: "voice_model_voice-training-8_cvp_train",
        expectedModelPath: modelPath,
        expectedIndexPath: indexPath,
        expectedConfigPath: path.join(artifactDir, "voice_model_voice-training-8_cvp_train.json"),
        modelPath,
        indexPath,
        status: "trained",
      },
    }), "utf8");

    const recovered = recoverLatestTrainedApplioVoiceProfile({
      ownerKey: "owner-a",
      characterId: "voice-training-8",
      savedProfile: loadCharacter("owner-a", "voice-training-8")?.characterVoiceProfile,
    });

    expect(recovered).toMatchObject({
      source: "artifact_file",
      profile: {
        status: "trained",
        trainingAdapter: "applio_real_training",
        trainingMock: false,
        sourceTrainingJobId: "cvp_train",
        voiceModelArtifactId: "voice_model_voice-training-8_cvp_train",
        modelPath,
        indexPath,
      },
    });

    updateCharacterVoiceProfile("owner-a", "voice-training-8", recovered!.profile);
    expect(loadCharacter("owner-a", "voice-training-8")?.characterVoiceProfile).toMatchObject({
      status: "trained",
      trainingAdapter: "applio_real_training",
      trainingMock: false,
      voiceModelArtifacts: [{ mode: "real", mock: false, modelPath, indexPath }],
    });
  });

  it("does not recover mock or incomplete trained Applio artifacts", async () => {
    const { recoverLatestTrainedApplioVoiceProfile } = await import("@/lib/jobs/applioArtifactRecovery");

    const artifactDir = path.join(tempRoot, "characters", "owner-a", "applio-models", "char-incomplete", "cvp_train");
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "training-artifact.json"), JSON.stringify({
      schemaVersion: 1,
      ownerKey: "owner-a",
      characterId: "char-incomplete",
      jobId: "cvp_train",
      status: "trained",
      mock: false,
      adapter: "applio_real_training",
      dataset: { approvedSampleUrl: "/sample.wav", manifestPath: "/manifest.json", manifestUrl: "/manifest", sourceDatasetJobId: "cvp_dataset", clipCount: 200 },
      model: {
        modelName: "voice_model_char-incomplete_cvp_train",
        modelPath: path.join(artifactDir, "missing.pth"),
        indexPath: path.join(artifactDir, "missing.index"),
        status: "trained",
      },
    }), "utf8");

    expect(recoverLatestTrainedApplioVoiceProfile({
      ownerKey: "owner-a",
      characterId: "char-incomplete",
    })).toBeNull();

    const mockDir = path.join(tempRoot, "characters", "owner-a", "applio-models", "char-mock", "cvp_train");
    fs.mkdirSync(mockDir, { recursive: true });
    const mockModelPath = path.join(mockDir, "model.pth");
    const mockIndexPath = path.join(mockDir, "model.index");
    fs.writeFileSync(mockModelPath, "model", "utf8");
    fs.writeFileSync(mockIndexPath, "index", "utf8");
    fs.writeFileSync(path.join(mockDir, "training-artifact.json"), JSON.stringify({
      schemaVersion: 1,
      ownerKey: "owner-a",
      characterId: "char-mock",
      jobId: "cvp_train",
      status: "trained",
      mock: true,
      adapter: "applio_training_artifact",
      dataset: { approvedSampleUrl: "/sample.wav", manifestPath: "/manifest.json", manifestUrl: "/manifest", sourceDatasetJobId: "cvp_dataset", clipCount: 200 },
      model: {
        modelName: "voice_model_char-mock_cvp_train",
        modelPath: mockModelPath,
        indexPath: mockIndexPath,
        status: "trained",
      },
    }), "utf8");

    expect(recoverLatestTrainedApplioVoiceProfile({
      ownerKey: "owner-a",
      characterId: "char-mock",
    })).toBeNull();
  });
});
