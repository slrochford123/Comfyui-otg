import { describe, expect, it } from "vitest";

import { normalizeCharacterBuilderDraftState } from "@/lib/characters/characterBuilderPersistence";

describe("character builder draft migration", () => {
  it("restores active builder and voice lab pages from durable navigation fields", () => {
    const state = normalizeCharacterBuilderDraftState({
      activeBuilderPage: "voice",
      lastVoiceLabPage: "fx",
      details: { name: "Draft Character" },
    });

    expect(state.schemaVersion).toBe(2);
    expect(state.step).toBe("voice");
    expect(state.activeBuilderPage).toBe("voice");
    expect(state.lastBuilderStep).toBe("voice");
    expect(state.voiceLabPage).toBe("fx");
    expect(state.lastVoiceLabPage).toBe("fx");
    expect(state.details).toEqual({ name: "Draft Character" });
  });

  it("infers Voice Lab training when a dataset job is present", () => {
    const state = normalizeCharacterBuilderDraftState({
      step: "voice",
      voicePipelineJobs: {
        generate_training_dataset: {
          job: {
            jobId: "cvp_dataset",
            status: "running",
          },
        },
      },
    });

    expect(state.step).toBe("voice");
    expect(state.voiceLabPage).toBe("training");
    expect(state.lastVoiceLabPage).toBe("training");
  });

  it("infers Voice FX from a persisted base voice sample", () => {
    const state = normalizeCharacterBuilderDraftState({
      step: "voice",
      builderCharacterVoiceProfile: {
        baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-a&jobId=cvp_base",
        baseSamplePath: "data/characters/owner-a/voice-samples/char-a/cvp_base/sample.wav",
      },
    });

    expect(state.voiceLabPage).toBe("fx");
  });
});
