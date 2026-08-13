// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const hub = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/CharacterHubPanel.tsx",
  ),
  "utf8",
);

describe("Character candidate lightbox Phase 5b", () => {
  it("expands a candidate when its generated image is clicked", () => {
    expect(hub).toContain(
      "setExpandedCandidate(candidate)",
    );
    expect(hub).toContain(
      'data-otg="character-candidate-expand"',
    );
  });

  it("provides a full-screen lightbox", () => {
    expect(hub).toContain(
      'data-otg="character-candidate-lightbox"',
    );
    expect(hub).toContain(
      'role="dialog"',
    );
    expect(hub).toContain(
      'aria-modal="true"',
    );
  });

  it("uses object-contain so the expanded portrait is not cropped", () => {
    expect(hub).toContain(
      'className="h-full w-full object-contain"',
    );
  });

  it("provides explicit and backdrop close behavior", () => {
    expect(hub).toContain(
      'data-otg="character-candidate-lightbox-close"',
    );
    expect(hub).toContain(
      "setExpandedCandidate(null)",
    );
    expect(hub).toContain(
      "event.stopPropagation()",
    );
  });

  it("keeps candidate actions separate from image expansion", () => {
    expect(hub).toContain("Modify");
    expect(hub).toContain("Select");
    expect(hub).toContain("Save for Later");
    expect(hub).toContain("Clear");
  });

  it("prevents native image dragging in the candidate viewer", () => {
    expect(hub).toContain("draggable={false}");
  });
});
