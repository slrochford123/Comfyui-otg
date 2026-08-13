import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "app/app/components/CharactersPanel.tsx"),
  "utf8",
);

describe("Background Studio saved background library manager", () => {
  it("renders a server-backed saved background library with view, rename, and delete actions", () => {
    expect(panelSource).toContain("OTG_BACKGROUND_SAVED_LIBRARY_MANAGER_V36AN");
    expect(panelSource).toContain("Saved Backgrounds");
    expect(panelSource).toContain("View the establishing image, rename the saved card, or delete it from your Background Library.");
    expect(panelSource).toContain("View");
    expect(panelSource).toContain("Rename");
    expect(panelSource).toContain("Delete");
  });

  it("uses the server response as the authoritative library during refresh", () => {
    expect(panelSource).toContain("setCharacterBackgroundRefs(serverItems);");
    expect(panelSource).toContain("writeCharacterBackgroundLibraryV36A(serverItems);");
    expect(panelSource).not.toContain("const merged = serverItems.reduce(");
  });

  it("renames the existing background id and verifies the server response", () => {
    expect(panelSource).toContain("async function renameCharacterBackgroundReferenceV36AN");
    expect(panelSource).toContain("...background,");
    expect(panelSource).toContain("name: nextName,");
    expect(panelSource).toContain("const saved = await saveCharacterBackgroundReferenceV36A");
    expect(panelSource).toContain("Background rename verification returned");
  });

  it("provides a full saved-background viewer and closes it after deletion", () => {
    expect(panelSource).toContain("OTG_BACKGROUND_SAVED_VIEW_MODAL_V36AN");
    expect(panelSource).toContain("savedBackgroundDisplaySrcV36AH3(background)");
    expect(panelSource).toContain("savedBackgroundWorkflowImageValueV36AH3(background)");
    expect(panelSource).toContain("setExpandedSavedCharacterBackgroundIdV36AN((current) => (current === id ? \"\" : current));");
  });
});
