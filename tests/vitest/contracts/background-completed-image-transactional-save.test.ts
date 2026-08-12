import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "app/app/components/CharactersPanel.tsx"),
  "utf8",
);

describe("Background Studio completed-image transactional save", () => {
  it("awaits the server save and verifies the record through a fresh library read", () => {
    expect(panelSource).toContain("OTG_BACKGROUND_TRANSACTIONAL_SAVE_V36AM");
    expect(panelSource).toContain("const saved = await persistCharacterBackgroundReferenceToServerV36B(next);");
    expect(panelSource).toContain("const serverItems = await fetchCharacterBackgroundLibraryFromServerV36B();");
    expect(panelSource).toContain("Background save could not be verified after POST");
  });

  it("does not report completed-image success before verification", () => {
    expect(panelSource).toContain("Saving complete background image to the server library...");
    expect(panelSource).toContain("Complete background image saved and verified:");
    expect(panelSource).not.toContain("Preview image saved. Next phase will create the 10-image background angle plate.");
  });

  it("keeps the generated plate available when persistence fails", () => {
    expect(panelSource).toContain("Complete background image save failed. The generated plate remains available for retry.");
    expect(panelSource).toContain("setExpandedCharacterBackgroundCandidateId(\"\");");
    expect(panelSource).toContain("setCharacterBackgroundBusy(false);");
  });

  it("disables save actions while a save or generation request is active", () => {
    expect(panelSource).toContain("onClick={() => void handleCharacterBackgroundUseImageV36AF(candidate)}");
    expect(panelSource).toContain("disabled={characterBackgroundBusy}");
    expect(panelSource).toContain("onClick={() => void useSelectedCharacterBackgroundImageV36E()}");
  });
});
