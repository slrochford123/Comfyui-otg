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

function characterGalleryPrimaryBlock() {
  const startMarker =
    'data-otg="character-gallery-primary-actions"';

  const bottomMarker =
    'data-otg="character-gallery-saved-for-later-bottom"';

  const start = hub.indexOf(startMarker);
  const bottom = hub.indexOf(bottomMarker, start);

  expect(start).toBeGreaterThan(-1);
  expect(bottom).toBeGreaterThan(start);

  return hub.slice(start, bottom);
}

function savedForLaterBottomBlock() {
  const marker =
    'data-otg="character-gallery-saved-for-later-bottom"';

  const markerStart = hub.indexOf(marker);

  expect(markerStart).toBeGreaterThan(-1);

  const wrapperStart = hub.lastIndexOf(
    "<div",
    markerStart,
  );

  expect(wrapperStart).toBeGreaterThan(-1);

  return hub.slice(
    wrapperStart,
    markerStart + 1200,
  );
}

describe("Character Gallery layout Phase 5e", () => {
  it("uses a left Create column followed by a right Upload column", () => {
    const block = characterGalleryPrimaryBlock();

    const create = block.indexOf(
      'title="Create Character"',
    );

    const createFreeform = block.indexOf(
      'title="Create Freeform Character"',
    );

    const upload = block.indexOf(
      'title="Upload Character"',
    );

    const uploadFreeform = block.indexOf(
      'title="Upload Freeform Character"',
    );

    expect(create).toBeGreaterThan(-1);
    expect(createFreeform).toBeGreaterThan(create);
    expect(upload).toBeGreaterThan(createFreeform);
    expect(uploadFreeform).toBeGreaterThan(upload);
  });

  it("keeps Create Character directly above Create Freeform Character", () => {
    const block = characterGalleryPrimaryBlock();

    const create = block.indexOf(
      'title="Create Character"',
    );

    const createFreeform = block.indexOf(
      'title="Create Freeform Character"',
    );

    expect(create).toBeGreaterThan(-1);
    expect(createFreeform).toBeGreaterThan(create);
  });

  it("keeps Upload Character directly above Upload Freeform Character", () => {
    const block = characterGalleryPrimaryBlock();

    const upload = block.indexOf(
      'title="Upload Character"',
    );

    const uploadFreeform = block.indexOf(
      'title="Upload Freeform Character"',
    );

    expect(upload).toBeGreaterThan(-1);
    expect(uploadFreeform).toBeGreaterThan(upload);
  });

  it("places Saved for Later below both primary columns", () => {
    const primaryStart = hub.indexOf(
      'data-otg="character-gallery-primary-actions"',
    );

    const savedStart = hub.indexOf(
      'data-otg="character-gallery-saved-for-later-bottom"',
      primaryStart,
    );

    expect(primaryStart).toBeGreaterThan(-1);
    expect(savedStart).toBeGreaterThan(primaryStart);
  });

  it("makes Saved for Later span the full width at the bottom", () => {
    const block = savedForLaterBottomBlock();

    expect(block).toContain(
      'className="md:col-span-2"',
    );

    expect(block).toContain(
      'title="Saved for Later"',
    );
  });
});
