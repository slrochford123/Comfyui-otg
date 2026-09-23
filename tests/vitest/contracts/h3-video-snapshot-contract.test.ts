import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createProductionV2,
  syncProductionV2ReferencePlan,
  type ProductionV2Scene,
  type ProductionV2VisualReference,
} from "../../../lib/production/v2";

import {
  resolveProductionV2H3ReferencePlan,
} from "../../../lib/production/referenceResolver";

const ROOT = process.cwd();

function source(relativePath: string) {
  return fs.readFileSync(
    path.join(ROOT, relativePath),
    "utf8",
  );
}

function snapshotReference(
  index: number,
): ProductionV2VisualReference {
  return {
    id: `production-upload:snapshot-${index}`,
    name: `Snapshot ${index}`,
    sourceKind: "production-upload",
    generationSourceType: "production-upload",
    sourceId: `snapshot-${index}.png`,
    identityDescription: `Snapshot ${index}`,
    displayImage:
      `/api/otg/local-image?path=%2Ftmp%2Fsnapshot-${index}.png`,
    workflowImage:
      `/tmp/snapshot-${index}.png`,
  };
}

function r2vSceneWithSnapshots(
  count: number,
): ProductionV2Scene {
  const production = createProductionV2(
    "Snapshot Contract",
    "minimax-h3",
  );

  const base = production.scenes[0];

  if (!base) {
    throw new Error(
      "createProductionV2 did not create Scene 1.",
    );
  }

  return {
    ...base,
    generationMode:
      "h3-reference-to-video",
    modelState: {
      ...base.modelState,
      h3: {
        ...base.modelState.h3,
        lastMode:
          "h3-reference-to-video",
        referenceToVideo: {
          ...base.modelState.h3.referenceToVideo,
          uploadedReferences:
            Array.from(
              { length: count },
              (_, index) =>
                snapshotReference(index + 1),
            ),
        },
      },
    },
  };
}

describe(
  "H3 video Snapshot contract",
  () => {
    it(
      "captures a bounded client-side JPEG and cleans up the video object URL",
      () => {
        const picker = source(
          "app/app/components/VideoSnapshotPicker.tsx",
        );

        expect(picker).toContain(
          "URL.createObjectURL",
        );

        expect(picker).toContain(
          "URL.revokeObjectURL",
        );

        expect(picker).toContain(
          "requestVideoFrameCallback",
        );

        expect(picker).toContain(
          "SNAPSHOT_FRAME_WAIT_TIMEOUT_MS",
        );

        expect(picker).toContain(
          "cancelVideoFrameCallback",
        );

        expect(picker).toContain(
          "SNAPSHOT_MAX_DIMENSION",
        );

        expect(picker).toContain(
          "video.videoWidth",
        );

        expect(picker).toContain(
          "video.videoHeight",
        );

        expect(picker).toContain(
          "canvas.width",
        );

        expect(picker).toContain(
          "canvas.height",
        );

        expect(picker).toContain(
          "context.drawImage",
        );

        expect(picker).toContain(
          'canvas.toBlob(',
        );

        expect(picker).toContain(
          'SNAPSHOT_MIME_TYPE = "image/jpeg"',
        );

        expect(picker).toContain(
          "SNAPSHOT_JPEG_QUALITY",
        );

        expect(picker).toContain(
          "captureDurationMs",
        );

        expect(picker).not.toMatch(
          /ffmpeg/i,
        );
      },
    );

    it(
      "wires Snapshot only into H3 Generate image/reference input paths",
      () => {
        const panel = source(
          "app/app/components/H3Panel.tsx",
        );

        expect(panel).toContain(
          'onClick={() => setSnapshotTarget(target)}',
        );

        expect(panel).toContain(
          'onClick={() => setSnapshotTarget("reference-image")}',
        );

        expect(panel).toContain(
          'snapshotTarget === "first"',
        );

        expect(panel).toContain(
          'snapshotTarget === "last"',
        );

        expect(panel).toContain(
          'snapshotTarget === "reference-image"',
        );

        expect(panel).not.toContain(
          '"h3-text-to-video" | "snapshot"',
        );
      },
    );

    it(
      "uses the existing Production image-upload route for I2V and R2V Snapshot files",
      () => {
        const panel = source(
          "app/app/components/ProductionV2Panel.tsx",
        );

        expect(panel).toContain(
          'data-otg="production-v2-h3-i2v-snapshot-controls"',
        );

        expect(panel).toContain(
          'data-otg="production-v2-h3-r2v-snapshot-controls"',
        );

        expect(panel).toContain(
          '"/api/production/picture/scene-input-upload"',
        );

        expect(panel).toContain(
          'form.set("image", result.file)',
        );

        expect(panel).toContain(
          'sourceKind: "production-upload"',
        );

        expect(panel).toContain(
          'generationSourceType: "production-upload"',
        );

        expect(panel).toContain(
          'mode !== "h3-image-to-video"',
        );

        expect(panel).toContain(
          'mode !== "h3-reference-to-video"',
        );
      },
    );

    it(
      "creates and preserves persistent R2V Snapshot state",
      () => {
        const fresh = createProductionV2(
          "Snapshot Default",
          "minimax-h3",
        );

        expect(
          fresh.scenes[0]?.modelState.h3
            .referenceToVideo
            .uploadedReferences,
        ).toEqual([]);

        const scene =
          r2vSceneWithSnapshots(1);

        const synced =
          syncProductionV2ReferencePlan(
            scene,
          );

        expect(
          synced.modelState.h3
            .referenceToVideo
            .uploadedReferences,
        ).toHaveLength(1);

        expect(
          synced.modelState.h3
            .referenceToVideo
            .uploadedReferences[0]?.id,
        ).toBe(
          "production-upload:snapshot-1",
        );

        expect(
          synced.referencePlan.status,
        ).toBe(
          "pending-budgeter",
        );
      },
    );

    it(
      "resolves Snapshot-only R2V references into normal H3 Picture/Subject slots",
      () => {
        const resolved =
          resolveProductionV2H3ReferencePlan(
            r2vSceneWithSnapshots(1),
          );

        expect(
          resolved.referencePlan.status,
        ).toBe(
          "planned",
        );

        expect(
          resolved.referencePlan
            .modelFacingReferences,
        ).toHaveLength(1);

        const reference =
          resolved.referencePlan
            .modelFacingReferences[0];

        expect(reference).toMatchObject({
          sourceKind:
            "production-upload",
          generationSourceType:
            "production-upload",
          pictureSlot: 1,
          subjectSlot: 1,
          workflowImage:
            "/tmp/snapshot-1.png",
        });
      },
    );

    it(
      "keeps the MiniMax H3 nine-image reference limit when Snapshot references are used",
      () => {
        expect(() =>
          resolveProductionV2H3ReferencePlan(
            r2vSceneWithSnapshots(10),
          ),
        ).toThrow(
          /at most 9/i,
        );
      },
    );

    it(
      "normalizes persisted production-upload Snapshot references on reload",
      () => {
        const v2 = source(
          "lib/production/v2.ts",
        );

        expect(v2).toContain(
          "uploadedReferences: Array.isArray(",
        );

        expect(v2).toContain(
          "value?.modelState?.h3?.referenceToVideo?.uploadedReferences",
        );

        expect(v2).toContain(
          ".map(normalizeVisual)",
        );

        expect(v2).toContain(
          'reference.sourceKind === "production-upload"',
        );
      },
    );
  },
);
