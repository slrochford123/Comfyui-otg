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

const lightboxStart = hub.indexOf(
  '{expandedCandidate && typeof document !== "undefined" ? createPortal(',
);
const lightboxEnd = hub.indexOf(
  '<div className="grid gap-4',
  lightboxStart,
);
const lightbox = hub.slice(lightboxStart, lightboxEnd);

describe("Character candidate lightbox mobile close Phase 9b", () => {
  it("portals the viewer above the app stacking context", () => {
    expect(hub).toContain('import { createPortal } from "react-dom";');
    expect(hub).toContain("createPortal(");
    expect(hub).toContain("document.body");
    expect(lightbox).toContain("z-[100000]");
  });

  it("keeps the Close control clickable, visible, and mobile-safe", () => {
    expect(lightbox).toContain(
      'data-otg="character-candidate-lightbox-close"',
    );
    expect(lightbox).toContain("z-[100001]");
    expect(lightbox).toContain("pointer-events-auto");
    expect(lightbox).toContain("min-h-12");
    expect(lightbox).toContain("min-w-12");
    expect(lightbox).toContain("env(safe-area-inset-top)");
    expect(lightbox).toContain("env(safe-area-inset-right)");
  });

  it("closes from the backdrop without treating image taps as backdrop taps", () => {
    expect(lightbox).toContain(
      "onClick={() => setExpandedCandidate(null)}",
    );
    expect(lightbox).toContain(
      "onClick={(event) => event.stopPropagation()}",
    );
  });

  it("closes on Escape", () => {
    expect(hub).toContain('event.key === "Escape"');
    expect(hub).toContain(
      'document.addEventListener("keydown", closeOnEscape)',
    );
    expect(hub).toContain(
      'document.removeEventListener("keydown", closeOnEscape)',
    );
  });

  it("retains the expanded image and candidate actions", () => {
    expect(lightbox).toContain("object-contain");
    expect(lightbox).toContain("draggable={false}");
    for (const action of ["Modify", "Select", "Save for Later", "Clear"]) {
      expect(hub).toContain(action);
    }
  });
});
