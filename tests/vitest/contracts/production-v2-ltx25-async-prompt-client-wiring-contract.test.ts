import {
  describe,
  expect,
  it,
} from "vitest";

import {
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

const panelPath =
  resolve(
    process.cwd(),
    "app/app/components/ProductionV2Panel.tsx",
  );

function buildPromptSource() {
  const source =
    readFileSync(
      panelPath,
      "utf8",
    );

  const startMarker =
    "  async function buildPrompt() {";

  const endMarker =
    "async function generateVideo() {";

  const start =
    source.indexOf(
      startMarker,
    );

  const end =
    source.indexOf(
      endMarker,
      start,
    );

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return {
    source,
    block:
      source.slice(
        start,
        end,
      ),
  };
}

describe(
  "Production V2 LTX 2.5 durable prompt client wiring",
  () => {
    it(
      "routes Build Scene Prompt through the durable prompt API for LTX instead of the local synchronous builder",
      () => {
        const {
          source,
          block,
        } =
          buildPromptSource();

        expect(
          block,
        ).toContain(
          "OTG_PRODUCTION_V2_LTX_DURABLE_PROMPT_CLIENT_WIRING_V1",
        );

        expect(
          block,
        ).toContain(
          '"/api/production/v2/prompt"',
        );

        expect(
          block,
        ).toContain(
          "pollPromptBuildOperation",
        );

        expect(
          block,
        ).not.toContain(
          'if (selectedScene.model === "minimax-h3")',
        );

        expect(
          block,
        ).not.toContain(
          "buildProductionPrompt(",
        );

        expect(
          source,
        ).not.toContain(
          'import { buildProductionPrompt } from "@/lib/production/promptBuilder";',
        );
      },
    );

    it(
      "preserves H3-only resolved voice binding mutation while applying the returned reference plan to both models",
      () => {
        const {
          block,
        } =
          buildPromptSource();

        expect(
          block,
        ).toContain(
          'scene.model === "minimax-h3"',
        );

        expect(
          block,
        ).toContain(
          "resolvedVoiceBindings:",
        );

        expect(
          block,
        ).toContain(
          "json.referencePlan.resolvedVoiceReferences",
        );

        expect(
          block,
        ).toContain(
          "referencePlan:",
        );

        expect(
          block,
        ).toContain(
          "json.referencePlan",
        );

        expect(
          block,
        ).toContain(
          "buildProductionV2ScenePrompt(",
        );

        expect(
          block,
        ).toContain(
          "json.scenePrompt",
        );

        expect(
          block,
        ).toContain(
          "json.builderId",
        );

        expect(
          block,
        ).toContain(
          "json.lockedReferenceContext",
        );
      },
    );

    it(
      "keeps the durable operation-id and polling contract intact",
      () => {
        const {
          block,
        } =
          buildPromptSource();

        expect(
          block,
        ).toContain(
          "PromptOperationStartPayload",
        );

        expect(
          block,
        ).toContain(
          "start.operationId",
        );

        expect(
          block,
        ).toContain(
          "pollPromptBuildOperation(",
        );

        expect(
          block,
        ).toContain(
          "Scene Prompt queued. Waiting for the prompt model...",
        );
      },
    );
  },
);
