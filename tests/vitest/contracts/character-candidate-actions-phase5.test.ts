// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const hub = fs.readFileSync(
  path.join(root, "app/app/components/CharacterHubPanel.tsx"),
  "utf8",
);

const savedRoute = fs.readFileSync(
  path.join(root, "app/api/characters/saved-for-later/route.ts"),
  "utf8",
);

describe("Character candidate actions Phase 5", () => {
  it("provides all four candidate actions", () => {
    expect(hub).toContain("Modify");
    expect(hub).toContain("Select");
    expect(hub).toContain("Save for Later");
    expect(hub).toContain("Clear");
  });

  it("requires explicit Select for Character Card source", () => {
    expect(hub).toContain("function selectCandidate(");
    expect(hub).toContain("Selected for Character Card");
    expect(hub).toContain(
      "selected for Character Card creation",
    );
  });

  it("clears a selected candidate without auto-selecting another", () => {
    expect(hub).toContain(
      "function clearCandidate(candidateId: string)",
    );
    expect(hub).toContain('setSelectedCreateCandidateId("");');
  });

  it("persists Saved for Later outside the normal Gallery", () => {
    expect(savedRoute).toContain(
      '"characters",\n  "saved-for-later"',
    );
    expect(savedRoute).toContain("fs.writeFileSync");
    expect(hub).toContain(
      "/api/characters/saved-for-later",
    );
  });

  it("uses the Character device-scoped Saved for Later storage contract", () => {
    expect(savedRoute).not.toContain("getOwnerContext");
    expect(savedRoute).not.toContain("SessionInvalidError");
    expect(savedRoute).toContain(
      'request.headers.get("x-otg-device-id")',
    );
    expect(savedRoute).toContain(
      "otg_character_device_id",
    );
    expect(savedRoute).toContain(
      "response.cookies.set",
    );
  });

  it("provides the separate Saved for Later Character Gallery", () => {
    expect(hub).toContain(
      'data-otg="saved-for-later-character-gallery"',
    );
    expect(hub).toContain('title="Saved for Later"');
    expect(hub).toContain("Use Character");
  });

  it("returns saved candidates to their original creation mode", () => {
    expect(hub).toContain("reusableSavedCandidate");
    expect(hub).toContain('item.mode === "freeform"');
    expect(hub).toContain('"create-freeform"');
    expect(hub).toContain('"create-character"');
  });

  it("connects Modify to the verified E003 edit workflow", () => {
    expect(hub).toContain(
      "openCandidateEdit(candidate)",
    );
    expect(hub).toContain(
      "executeCharacterCandidateEdit",
    );
    expect(hub).toContain("CandidateModifyDialog");
    expect(hub).not.toContain("edit workflow not connected");
  });

  it("retains full-screen candidate image expansion", () => {
    expect(hub).toContain(
      'data-otg="character-candidate-expand"',
    );
    expect(hub).toContain(
      'data-otg="character-candidate-lightbox"',
    );
    expect(hub).toContain(
      'data-otg="character-candidate-lightbox-close"',
    );
  });
});
