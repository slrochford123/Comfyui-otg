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

import {
  inspectH3BackendCompatibility,
} from "@/lib/production/h3Comfy";

import {
  h3RequiredNodeClassesForBackend,
} from "@/lib/production/h3Workflows";

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
      "waits briefly for the H3 preview websocket before prompt submission",
      () => {
        expect(
          comfySource,
        ).toContain(
          "waitForComfyClientProgressMonitor",
        );

        const waitIndex =
          comfySource.indexOf(
            "await waitForComfyClientProgressMonitor",
          );

        const submitIndex =
          comfySource.indexOf(
            "await submitComfyPromptWithGpuLease",
          );

        expect(
          waitIndex,
        ).toBeGreaterThan(
          -1,
        );

        expect(
          submitIndex,
        ).toBeGreaterThan(
          waitIndex,
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

    it(
      "recognizes FastH3 preview dependencies exposed through optional and COMBO schemas",
      async () => {
        const requiredNodes =
          new Set(
            h3RequiredNodeClassesForBackend(
              "rtx3090",
            ),
          );

        const fetcher = (async (url: string | URL) => {
          const target =
            String(
              url,
            );

          if (
            target.endsWith(
              "/queue",
            )
          ) {
            return Response.json({
              queue_running: [],
              queue_pending: [],
            });
          }

          const node =
            decodeURIComponent(
              target.split(
                "/object_info/",
              )[1] || "",
            );

          if (
            !requiredNodes.has(
              node,
            )
          ) {
            return new Response(
              "{}",
              {
                status: 404,
              },
            );
          }

          const input =
            {
              required: {},
              optional: {},
            } as {
              required: Record<string, unknown>;
              optional: Record<string, unknown>;
            };

          if (
            node === "UNETLoader"
          ) {
            input.required.unet_name = [
              [
                "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors",
                "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
              ],
            ];
          } else if (
            node === "CLIPLoader"
          ) {
            input.required.clip_name = [
              [
                "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
              ],
            ];
          } else if (
            node === "VAELoader"
          ) {
            input.required.vae_name = [
              [
                "minimax_h3_video_vae_fp16.safetensors",
                "minimax_h3_audio_vae_fp32.safetensors",
              ],
            ];
          } else if (
            node === "LoraLoaderModelOnly"
          ) {
            input.required.lora_name = [
              [
                "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
              ],
            ];
          } else if (
            node === "ModelAttentionBackend"
          ) {
            input.required.attention = [
              "COMBO",
              {
                options: [
                  "pytorch attention",
                  "comfy kitchen attention",
                ],
              },
            ];
          } else if (
            node === "ModelPreviewOverrideKJ"
          ) {
            input.optional.tiny_vae = [
              "COMBO",
              {
                options: [
                  "none",
                  "taeh3.safetensors",
                ],
              },
            ];
          }

          return Response.json({
            [node]: {
              input,
            },
          });
        }) as typeof fetch;

        const probe =
          await inspectH3BackendCompatibility(
            "rtx3090",
            {},
            fetcher,
          );

        expect(
          probe.reason,
        ).toBe(
          "available",
        );

        expect(
          probe.missingNodes,
        ).toEqual(
          [],
        );

        expect(
          probe.missingAssets,
        ).toEqual(
          [],
        );
      },
    );
  },
);
