import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const source =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/workers/comfyPromptLease.ts",
    ),
    "utf8",
  );

describe(
  "Comfy submission admission timeout boundary",
  () => {
    it(
      "does not allow a caller transport timer to abort GPU admission waiting",
      () => {
        expect(
          source,
        ).toContain(
          "OTG_COMFY_ADMISSION_WAIT_OUTLIVES_CALLER_TIMEOUT_V1",
        );

        expect(
          source,
        ).toContain(
          "signal:\n            null,",
        );

        expect(
          source,
        ).not.toContain(
          "signal:\n              args.init.signal\n              ?? null",
        );
      },
    );

    it(
      "starts a fresh prompt transport window only after admission",
      () => {
        expect(
          source,
        ).toContain(
          "submitTimeoutMs?: number;",
        );

        expect(
          source,
        ).toContain(
          "const submitTimeoutMs =",
        );

        expect(
          source,
        ).toContain(
          "new AbortController()",
        );

        expect(
          source,
        ).toContain(
          "submitController?.signal",
        );

        expect(
          source,
        ).toContain(
          "clearTimeout(",
        );
      },
    );
  },
);
