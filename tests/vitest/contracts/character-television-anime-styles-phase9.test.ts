import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TELEVISION_ANIME_STYLE_PRESETS } from "../../../lib/characters/televisionAnimeStyles";

const root = process.cwd();
const ui = fs.readFileSync(
  path.join(root, "app/app/components/CharacterHubPanel.tsx"),
  "utf8",
);
const route = fs.readFileSync(
  path.join(root, "app/api/characters/create-image/route.ts"),
  "utf8",
);

describe("Character Television Anime Art Styles Phase 9", () => {
  it("provides Default plus exactly 25 alternate television-anime presets", () => {
    expect(TELEVISION_ANIME_STYLE_PRESETS).toHaveLength(26);
    expect(TELEVISION_ANIME_STYLE_PRESETS[0].id).toBe("default");
    expect(TELEVISION_ANIME_STYLE_PRESETS[0].prompt).toBe("");

    const ids = TELEVISION_ANIME_STYLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the requested recognizable user-facing families", () => {
    const labels = TELEVISION_ANIME_STYLE_PRESETS.map((preset) => preset.label).join("\n");
    expect(labels).toContain("Retro Anime (90s Cel)");
    expect(labels).toContain("Dragon Ball-era Action");
    expect(labels).toContain("Naruto-era Ninja Action");
    expect(labels).toContain("Demon Slayer-era Painted Action");
    expect(labels).toContain("Solo Leveling-style Dark Action");
    expect(labels).toContain("Yu-Gi-Oh!-style Duelist Anime");
    expect(labels).toContain("Death Note-style Psychological Gothic");

    for (const preset of TELEVISION_ANIME_STYLE_PRESETS.slice(1)) {
      expect(preset.prompt.trim().length).toBeGreaterThan(40);
    }
  });

  it("shows the secondary selector only when Anime is selected", () => {
    expect(ui).toContain("Television Anime Art Styles");
    expect(ui).toContain('data-otg="character-television-anime-style-select"');
    expect(ui).toContain('stylePresetId === "anime"');
    expect(ui).toContain("TELEVISION_ANIME_STYLE_PRESETS.map");
  });

  it("submits the selected sub-style separately from the description", () => {
    expect(ui).toContain("televisionAnimeStyle:");
    expect(ui).toContain('stylePresetId === "anime" ? televisionAnimeStyleId : "default"');
    expect(route).toContain("televisionAnimeStylePrompt");
    expect(route).toContain('args.style === "anime"');
    expect(route).toContain("televisionAnimePrompt");
    expect(route).toContain("selectedArtStylePrompt?.trim()");
    expect(route).toContain("televisionAnimePrompt.trim()");
    expect(route).toContain(".filter(Boolean)");
  });

  it("validates the secondary preset server-side and makes non-Anime styles use Default", () => {
    expect(route).toContain("isTelevisionAnimeStyleId");
    expect(route).toContain('body.televisionAnimeStyle || "default"');
    expect(route).toContain('body.style === "anime" ? televisionAnimeStyleValue : "default"');
    expect(route).toContain("televisionAnimeStyle,");
  });
});
