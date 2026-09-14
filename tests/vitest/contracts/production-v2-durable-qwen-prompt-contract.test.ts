import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const postRoute =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/production/v2/prompt/route.ts",
    ),
    "utf8",
  );

const pollRoute =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/production/v2/prompt/[operationId]/route.ts",
    ),
    "utf8",
  );

const panel =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/ProductionV2Panel.tsx",
    ),
    "utf8",
  );

const operationEngine =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/production/v2PromptOperations.ts",
    ),
    "utf8",
  );

describe(
  "Production V2 durable asynchronous Qwen prompt boundary",
  () => {
    it(
      "returns 202 after persisting a durable prompt operation instead of waiting for Qwen",
      () => {
        expect(
          postRoute,
        ).toContain(
          "OTG_PRODUCTION_V2_ASYNC_PROMPT_API_V1",
        );

        expect(
          postRoute,
        ).toContain(
          "enqueueProductionV2PromptOperation",
        );

        expect(
          postRoute,
        ).toContain(
          "status:",
        );

        expect(
          postRoute,
        ).toContain(
          "202",
        );

        expect(
          postRoute,
        ).toContain(
          "operationId:",
        );

        expect(
          postRoute,
        ).not.toContain(
          "qwenDurableFetch",
        );

        expect(
          postRoute,
        ).not.toContain(
          "qwenClusterFetch",
        );

        expect(
          postRoute,
        ).not.toContain(
          "QwenClusterBusyError",
        );
      },
    );

    it(
      "polls durable operation state through an owner-scoped GET route",
      () => {
        expect(
          pollRoute,
        ).toContain(
          "OTG_PRODUCTION_V2_ASYNC_PROMPT_POLL_V1",
        );

        expect(
          pollRoute,
        ).toContain(
          "getOwnerContext",
        );

        expect(
          pollRoute,
        ).toContain(
          "getProductionV2PromptOperation",
        );

        expect(
          pollRoute,
        ).toContain(
          "operation.ownerKey",
        );

        expect(
          pollRoute,
        ).toContain(
          "owner.ownerKey",
        );

        expect(
          pollRoute,
        ).toContain(
          "kickProductionV2PromptOperationScheduler",
        );

        expect(
          pollRoute,
        ).toContain(
          "operation.result",
        );
      },
    );

    it(
      "makes the Production V2 client poll an operation instead of holding the POST request open",
      () => {
        expect(
          panel,
        ).toContain(
          "OTG_PRODUCTION_V2_ASYNC_PROMPT_CLIENT_V1",
        );

        expect(
          panel,
        ).toContain(
          "pollPromptBuildOperation",
        );

        expect(
          panel,
        ).toContain(
          "start.operationId",
        );

        expect(
          panel,
        ).toContain(
          "/api/production/v2/prompt/${encodeURIComponent(operationId)}",
        );

        expect(
          panel,
        ).toContain(
          "Connection interrupted. The Scene Prompt job is still saved; reconnecting...",
        );
      },
    );

    it(
      "keeps enhancement and repair inference behind deterministic durable child jobs",
      () => {
        expect(
          operationEngine,
        ).toContain(
          "OTG_PRODUCTION_V2_PROMPT_OPERATION_V1",
        );

        expect(
          operationEngine,
        ).toContain(
          "ensureQwenDurableJob",
        );

        expect(
          operationEngine,
        ).toContain(
          "childJobId",
        );

        expect(
          operationEngine,
        ).toContain(
          '"enhancement"',
        );

        expect(
          operationEngine,
        ).toContain(
          '"repair"',
        );
      },
    );
  },
);
