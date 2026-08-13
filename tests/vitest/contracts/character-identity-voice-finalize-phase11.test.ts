import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("Character identity + voice completion Phase 11", () => {
  it("bridges accepted Character Card into identity and voice finalization", () => {
    const source = read("app/app/components/CharacterHubPanel.tsx");
    expect(source).toContain('CharacterIdentityVoicePanel');
    expect(source).toContain('setCharacterFinalizeStep(true)');
    expect(source).toContain('appearanceSeed={description}');
    expect(source).toContain('<SavedCharacterLibrary />');
  });

  it("exposes only the approved voice creation providers plus upload reference", () => {
    const source = read("app/app/components/CharacterIdentityVoicePanel.tsx");
    expect(source).toContain('label: "Qwen3-TTS"');
    expect(source).toContain('label: "CosyVoice"');
    expect(source).toContain('label: "LTX Voice"');
    expect(source).not.toContain('Unnatural Voices');
    expect(source).toContain('Upload Voice Sample / Reference');
    expect(source).toContain('"/api/characters/reference-media"');
  });

  it("queues real voice jobs and keeps LTX cleanup available", () => {
    const source = read("app/app/components/CharacterIdentityVoicePanel.tsx");
    expect(source).toContain('action: "create_voice_sample"');
    expect(source).toContain('"/api/characters/voice-pipeline"');
    expect(source).toContain('"remove_background"');
    expect(source).toContain('"enhance_voice"');
    expect(source).toContain('result.mock !== false');
  });

  it("saves a compact H3 identity block and canonical voice selection", () => {
    const source = read("app/app/components/CharacterIdentityVoicePanel.tsx");
    expect(source).toContain('globalPromptIdentityBlock: identityBlock');
    expect(source).toContain('action: "update_voice_selection"');
    expect(source).toContain('referenceAudioPath: finalVoice.path');
    expect(source).toContain('source === "uploaded_reference"');
  });

  it("persists only voice fields through the scoped update action", () => {
    const route = read("app/api/characters/route.ts");
    const store = read("lib/characters/store.ts");
    expect(route).toContain('action === "update_voice_selection"');
    expect(route).toContain('updateCharacterVoiceSelection(ownerKey, id');
    expect(store).toContain('export function updateCharacterVoiceSelection');
    expect(store).toContain('Character reference audio must be inside the OTG data folder.');
    expect(store).toContain('Character reference audio is missing or empty.');
    expect(store).toContain('referenceAudioPath,');
  });

  it("supports custom deep/high voice tuning and gallery playback", () => {
    const effectRoute = read("app/api/characters/voice-sample/effect/route.ts");
    const source = read("app/app/components/CharacterIdentityVoicePanel.tsx");
    expect(effectRoute).toContain('effectId === "custom_voice_tuning"');
    expect(source).toContain('pitchSemitones');
    expect(source).toContain('Deep');
    expect(source).toContain('High');
    expect(source).toContain('data-otg="character-gallery-play-voice"');
  });
});
