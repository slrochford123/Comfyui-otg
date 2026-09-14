import {
  describe,
  expect,
  it,
} from "vitest";

import {
  readFileSync,
} from "node:fs";

import {
  join,
} from "node:path";

const comfySource = readFileSync(
  join(
    process.cwd(),
    "lib/production/h3Comfy.ts",
  ),
  "utf8",
);

const schedulerSource = readFileSync(
  join(
    process.cwd(),
    "lib/production/h3GenerationScheduler.ts",
  ),
  "utf8",
);

function selectorSource() {
  const start = schedulerSource.indexOf(
    "export function chooseProductionV2H3Backend",
  );

  const end = schedulerSource.indexOf(
    "export function applyProductionV2H3GenerationToProduction",
    start,
  );

  if (
    start < 0
    || end < 0
    || end <= start
  ) {
    throw new Error(
      "Could not isolate chooseProductionV2H3Backend.",
    );
  }

  return schedulerSource.slice(
    start,
    end,
  );
}

describe(
  "H3 Comfy-native queue routing",
  () => {
    it(
      "removes OTG resource locks from backend admission",
      () => {
        expect(comfySource).toContain(
          "OTG_H3_COMFY_QUEUE_TELEMETRY_NO_LOCK_V1",
        );

        expect(comfySource).not.toContain(
          "SHAWN_GPU_LOCK_ID",
        );

        expect(comfySource).not.toContain(
          "SLR_GPU_LOCK_ID",
        );

        expect(comfySource).not.toContain(
          "listResourceLocks",
        );

        expect(comfySource).not.toContain(
          '"otg-gpu-lock"',
        );
      },
    );

    it(
      "keeps Comfy queue state as routing telemetry",
      () => {
        expect(comfySource).toContain(
          "queue_running",
        );

        expect(comfySource).toContain(
          "queue_pending",
        );

        expect(comfySource).toContain(
          "idle: compatible && !queueBusy",
        );

        expect(comfySource).toContain(
          '"comfy-queue-active"',
        );
      },
    );

    it(
      "uses two backend-selection passes",
      () => {
        const source =
          selectorSource();

        expect(source).toContain(
          "OTG_H3_QUEUE_FALLBACK_V1",
        );

        const loops = [
          ...source.matchAll(
            /for \(const backend of H3_BACKEND_PRIORITY\)/g,
          ),
        ];

        expect(loops).toHaveLength(
          2,
        );
      },
    );

    it(
      "prefers idle compatible backends first",
      () => {
        const source =
          selectorSource();

        const loops = [
          ...source.matchAll(
            /for \(const backend of H3_BACKEND_PRIORITY\)/g,
          ),
        ];

        const first =
          source.slice(
            loops[0].index ?? 0,
            loops[1].index ?? source.length,
          );

        expect(first).toContain(
          "candidate?.healthy && candidate.compatible && candidate.idle",
        );
      },
    );

    it(
      "falls back to a busy healthy compatible backend",
      () => {
        const source =
          selectorSource();

        const loops = [
          ...source.matchAll(
            /for \(const backend of H3_BACKEND_PRIORITY\)/g,
          ),
        ];

        const fallback =
          source.slice(
            loops[1].index ?? 0,
          );

        expect(fallback).toContain(
          "candidate?.healthy && candidate.compatible",
        );

        expect(fallback).not.toContain(
          "candidate.idle",
        );
      },
    );

    it(
      "removes obsolete ComfyGpuBusyError handling",
      () => {
        expect(schedulerSource).not.toContain(
          "ComfyGpuBusyError",
        );
      },
    );

      it(
        "retains transient HTTP waiting behavior after a real submit attempt",
        () => {
          const transient =
            /result\.status\s*===\s*409\s*\|\|\s*result\.status\s*===\s*429\s*\|\|\s*result\.status\s*===\s*503/g;

          const occurrences =
            schedulerSource.match(
              transient,
            )?.length ?? 0;

          expect(
            occurrences,
          ).toBe(
            2,
          );

          expect(
            schedulerSource,
          ).toMatch(
            /requeueProductionV2GenerationBeforeAcceptance\(\s*job\.id,\s*job\.backend,\s*"Waiting for first available GPU",?\s*\)/,
          );

          expect(
            schedulerSource,
          ).toMatch(
            /markProductionV2GenerationVsrWaiting\(\s*job\.id,\s*"Waiting for RTX 5060 Ti to run VSR ULTRA 1080p",?\s*\)/,
          );
        },
      );

    it(
      "retains no-compatible-backend waiting behavior",
      () => {
        const source =
          selectorSource();

        expect(source).toContain(
          "return null;",
        );
      },
    );
  },
);
