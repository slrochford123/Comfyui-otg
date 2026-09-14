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

const sourcePath = join(
  process.cwd(),
  "lib/workers/comfyPromptLease.ts",
);

const source = readFileSync(
  sourcePath,
  "utf8",
);

function queueOnlySubmitSource() {
  const start = source.indexOf(
    "export async function submitComfyPromptWithGpuLease",
  );

  const end = source.indexOf(
    "/** Backward-compatible name retained",
    start,
  );

  if (
    start < 0 ||
    end < 0 ||
    end <= start
  ) {
    throw new Error(
      "Could not isolate submitComfyPromptWithGpuLease source.",
    );
  }

  return source.slice(
    start,
    end,
  );
}

describe(
  "Comfy prompt queue-only admission",
  () => {
    it(
      "marks the common Comfy submission primitive as queue-only",
      () => {
        expect(source).toContain(
          "OTG_COMFY_PROMPT_QUEUE_ONLY_V1",
        );
      },
    );

    it(
      "does not acquire or maintain OTG GPU resource locks before Comfy prompt submission",
      () => {
        expect(source).not.toContain(
          "acquireComfy5060Lease",
        );

        expect(source).not.toContain(
          "acquireShawnClusterGpuLease",
        );

        expect(source).not.toContain(
          "heartbeatResourceLock",
        );

        expect(source).not.toContain(
          "monitorAndRelease",
        );

        expect(source).not.toContain(
          "waitForPromptTerminal",
        );
      },
    );

    it(
      "still validates that the target maps to the RTX 5060 Ti or RTX 3090",
      () => {
        const submitSource =
          queueOnlySubmitSource();

        expect(
          submitSource,
        ).toMatch(
          /resolveComfyPhysicalGpu\s*\(\s*baseUrl\s*,?\s*\)/,
        );

        expect(
          submitSource,
        ).toContain(
          'physicalGpu === "slr-5060"',
        );

        expect(
          submitSource,
        ).toContain(
          'physicalGpu === "shawn-3090"',
        );

        expect(
          submitSource,
        ).toContain(
          "isRtx5060Comfy8188Endpoint",
        );

        expect(
          submitSource,
        ).toContain(
          "throw new UnclassifiedComfyGpuError",
        );
      },
    );

      it(
        "posts to the selected ComfyUI prompt endpoint and permits durable acceptance recording",
        () => {
          const submitSource =
            queueOnlySubmitSource();

          expect(
            submitSource,
          ).toContain(
            "let response:",
          );

          expect(
            submitSource,
          ).toContain(
            "await submit(",
          );

          expect(
            submitSource,
          ).toContain(
            "`${baseUrl}/prompt`",
          );

          expect(
            submitSource,
          ).toContain(
            "args.init",
          );

          expect(
            submitSource,
          ).toContain(
            "args.onPromptAccepted",
          );

          expect(
            submitSource,
          ).toContain(
            "return response;",
          );
        },
      );

    it(
      "keeps ordinary submissions queue-native while allowing final queue recheck only for cleanup-qualified admission",
      () => {
        const submitSource =
          queueOnlySubmitSource();

        expect(
          submitSource,
        ).toContain(
          'preSubmitCleanup?: "free" | null',
        );

        expect(
          submitSource,
        ).toContain(
          'args.preSubmitCleanup',
        );

        expect(
          submitSource,
        ).toContain(
          "`${baseUrl}/queue`",
        );

        expect(
          submitSource,
        ).toContain(
          "queue_running",
        );

        expect(
          submitSource,
        ).toContain(
          "queue_pending",
        );

        expect(
          submitSource,
        ).toContain(
          "`${baseUrl}/free`",
        );

        expect(
          submitSource,
        ).toContain(
          "`${baseUrl}/prompt`",
        );

        expect(
          submitSource,
        ).toContain(
          "runWithComfySubmissionCriticalSection",
        );

        expect(
          submitSource,
        ).not.toContain(
          "acquireComfy5060Lease",
        );

        expect(
          submitSource,
        ).not.toContain(
          "acquireShawnClusterGpuLease",
        );

        expect(
          submitSource,
        ).not.toContain(
          "heartbeatResourceLock",
        );

        expect(
          submitSource,
        ).not.toContain(
          "waitForPromptTerminal",
        );

        expect(
          submitSource,
        ).not.toContain(
          "ComfyGpuBusyError",
        );
      },
    );

    it(
      "retains the backward-compatible caller export while changing its behavior to queue-only",
      () => {
        expect(source).toContain(
          "export const submitComfyPromptWith5060Lease = submitComfyPromptWithGpuLease;",
        );
      },
    );
  },
);
