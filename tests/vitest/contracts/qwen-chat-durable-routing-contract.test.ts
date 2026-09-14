import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const chatSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/ollama-ai/chat/route.ts",
    ),
    "utf8",
  );

const routerSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/workers/qwenClusterRouter.ts",
    ),
    "utf8",
  );

describe(
  "Ollama chat durable Qwen routing",
  () => {
    it(
      "uses the durable boundary for normal and AI-assisted chat",
      () => {
        expect(
          chatSource,
        ).toContain(
          'from "@/lib/workers/qwenDurableFetch"',
        );

        expect(
          chatSource,
        ).toContain(
          "qwenDurableFetch(",
        );

        expect(
          chatSource,
        ).not.toContain(
          "qwenClusterFetch(",
        );

        expect(
          chatSource,
        ).not.toContain(
          "QwenClusterBusyError",
        );
      },
    );

    it(
      "preserves Shawn-first AI Assistance preference without a capacity timeout",
      () => {
        expect(
          chatSource,
        ).toContain(
          '["shawn", "slr"]',
        );

        expect(
          chatSource,
        ).toContain(
          "OTG_QWEN_CHAT_DURABLE_PRIORITY_V1",
        );

        expect(
          chatSource,
        ).not.toContain(
          "AI_ASSISTANCE_ROUTE_WAIT_MS",
        );

        expect(
          chatSource,
        ).toContain(
          '"ollama-ai-chat-ai-assistance"',
        );
      },
    );

    it(
      "makes router node order caller-controlled while preserving SLR-first default",
      () => {
        expect(
          routerSource,
        ).toContain(
          "for (const node of allowedNodes)",
        );

        expect(
          routerSource,
        ).toContain(
          'if (node === "slr")',
        );

        expect(
          routerSource,
        ).toContain(
          'if (node === "shawn")',
        );

        expect(
          routerSource,
        ).toContain(
          '|| ["slr", "shawn"]',
        );

        expect(
          routerSource,
        ).not.toContain(
          'allowedNodes.has("slr")',
        );

        expect(
          routerSource,
        ).not.toContain(
          'allowedNodes.has("shawn")',
        );
      },
    );
  },
);
