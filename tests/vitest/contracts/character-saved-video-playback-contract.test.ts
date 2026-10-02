import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("saved character video playback contract", () => {
  it("lets completed saved character cards play a saved character video from the image area", () => {
    const source = read("app/app/components/CharactersPanel.tsx");

    expect(source).toContain("function characterSavedVideoRefV36BP8");
    expect(source).toContain("character?.introVideoPath");
    expect(source).toContain("character?.metadata?.dubbedPreviewVideoUrl");
    expect(source).toContain("character?.characterVoiceProfile?.outputVideoUrl");
    expect(source).toContain("playingSavedCharacterVideoByIdV36BP8");
    expect(source).toContain("aria-label={savedVideoSrc ? `Play ${character.name} video`");
    expect(source).toContain("<video");
    expect(source).toContain("autoPlay");
    expect(source).toContain("playsInline");
    expect(source).toContain("Play");
  });
});
