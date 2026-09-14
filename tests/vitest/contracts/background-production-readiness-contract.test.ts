// OTG_BACKGROUND_PRODUCTION_READINESS_CONTRACT_PP04C_V1

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  BACKGROUND_PRODUCTION_CANONICAL_ANGLE_KEYS_V36B,
  backgroundReferenceReadinessV36B,
  isBackgroundProductionReadyV36B,
  type BackgroundImageAssetV36B,
  type BackgroundRecordV36B,
} from "../../../lib/backgrounds/store";

const tempRoots: string[] = [];

function createTempRoot() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "otg-pp04c-background-"),
  );
  tempRoots.push(root);
  return root;
}

function realAsset(
  root: string,
  name: string,
): BackgroundImageAssetV36B {
  const imagePath = path.join(root, `${name}.png`);
  fs.writeFileSync(imagePath, Buffer.from("otg-background"));

  return {
    displayImage: imagePath,
    workflowImage: imagePath,
    imagePath,
    imageUrl: imagePath,
  };
}

function missingAsset(
  root: string,
  name: string,
): BackgroundImageAssetV36B {
  const imagePath = path.join(root, `${name}-missing.png`);

  return {
    displayImage: imagePath,
    workflowImage: imagePath,
    imagePath,
    imageUrl: imagePath,
  };
}

function baseRecord(
  root: string,
): BackgroundRecordV36B {
  const master = realAsset(root, "master");

  return {
    type: "background",
    id: "pp04c-background",
    name: "PP-04C Background",
    locationType: "test",
    style: "cinematic",
    masterPrompt: "test background",
    continuityBlock: "keep environment stable",
    doNotChange: [],
    establishingImage: master,
    angleImages: {},
    displayImage: master.displayImage,
    workflowImage: master.workflowImage,
    imagePath: master.imagePath,
    imageUrl: master.imageUrl,
    source: "created",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (!root) continue;

    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

describe("PP-04C Background production readiness", () => {
  it("locks the six canonical Production Background angles", () => {
    expect(
      BACKGROUND_PRODUCTION_CANONICAL_ANGLE_KEYS_V36B,
    ).toEqual([
      "front",
      "back",
      "left90",
      "right90",
      "up",
      "down",
    ]);
  });

  it("classifies a complete six-view Background as production-ready", () => {
    const root = createTempRoot();
    const record = baseRecord(root);

    for (
      const key
      of BACKGROUND_PRODUCTION_CANONICAL_ANGLE_KEYS_V36B
    ) {
      record.angleImages[key] = realAsset(root, key);
    }

    expect(
      backgroundReferenceReadinessV36B(record),
    ).toBe("production-ready");

    expect(
      isBackgroundProductionReadyV36B(record),
    ).toBe(true);
  });

  it("classifies a valid Master with missing canonical angles as needs-upgrade", () => {
    const root = createTempRoot();
    const record = baseRecord(root);

    record.angleImages.front = realAsset(root, "front");

    expect(
      backgroundReferenceReadinessV36B(record),
    ).toBe("needs-upgrade");

    expect(
      isBackgroundProductionReadyV36B(record),
    ).toBe(false);
  });

  it("classifies a missing Master as broken", () => {
    const root = createTempRoot();
    const record = baseRecord(root);
    const missing = missingAsset(root, "master");

    record.establishingImage = missing;
    record.displayImage = missing.displayImage;
    record.workflowImage = missing.workflowImage;
    record.imagePath = missing.imagePath;
    record.imageUrl = missing.imageUrl;

    expect(
      backgroundReferenceReadinessV36B(record),
    ).toBe("broken");

    expect(
      isBackgroundProductionReadyV36B(record),
    ).toBe(false);
  });

  it("rejects a complete metadata pack when an angle file is missing", () => {
    const root = createTempRoot();
    const record = baseRecord(root);

    for (
      const key
      of BACKGROUND_PRODUCTION_CANONICAL_ANGLE_KEYS_V36B
    ) {
      record.angleImages[key] = realAsset(root, key);
    }

    record.angleImages.down = missingAsset(root, "down");

    expect(
      backgroundReferenceReadinessV36B(record),
    ).toBe("needs-upgrade");
  });

  it("filters non-ready Backgrounds from Production V2 references", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/api/production/v2/references/route.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      ".filter(isBackgroundProductionReadyV36B)",
    );
  });

  it("hides broken library records without deleting their saved JSON", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/api/backgrounds/route.ts",
      ),
      "utf8",
    );

    const start = source.indexOf(
      "async function listAndRepairBackgrounds",
    );
    const end = source.indexOf(
      "export async function GET",
      start,
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const listingCode = source.slice(start, end);

    expect(listingCode).toContain(
      'readiness === "broken"',
    );

    expect(listingCode).not.toContain(
      "deleteBackground(",
    );
  });
});
