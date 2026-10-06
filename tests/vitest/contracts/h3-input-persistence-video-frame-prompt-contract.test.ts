import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

function read(
  relativePath: string,
) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    "utf8",
  );
}

describe(
  "H3 input persistence and video-frame prompt builder contract",
  () => {
    it(
      "persists H3 generator inputs and exposes an explicit reset control",
      () => {
        const panel =
          read(
            "app/app/components/H3Panel.tsx",
          );

        expect(panel).toContain(
          "H3_INPUT_STORAGE_KEY",
        );

        expect(panel).toContain(
          "readPersistedH3InputState",
        );

        expect(panel).toContain(
          "writePersistedH3InputState",
        );

        expect(panel).toContain(
          "writePersistedH3MediaFiles",
        );

        expect(panel).toContain(
          "Reset H3 Generator",
        );

        expect(panel).toContain(
          "Clears saved H3 prompts, controls, images, video references, audio references, and LoRAs",
        );
      },
    );

    it(
      "stores media files in IndexedDB instead of trying to stringify File objects",
      () => {
        const persistence =
          read(
            "app/app/components/h3InputPersistence.ts",
          );

        expect(persistence).toContain(
          "indexedDB.open",
        );

        expect(persistence).toContain(
          'const STORE_NAME = "media"',
        );

        expect(persistence).toContain(
          "PersistedH3MediaMeta",
        );

        expect(persistence).toContain(
          "writePersistedH3MediaFiles",
        );

        expect(persistence).toContain(
          "readPersistedH3MediaFiles",
        );
      },
    );

    it(
      "extracts a first frame from the selected H3 reference-video window before Prompt Builder runs",
      () => {
        const panel =
          read(
            "app/app/components/H3Panel.tsx",
          );

        expect(panel).toContain(
          '"/api/h3/prompt/video-reference"',
        );

        expect(panel).toContain(
          "Prompt Builder video reference",
        );

        expect(panel).toContain(
          "clipStartSeconds",
        );

        expect(panel).toContain(
          "First frame of selected",
        );

        expect(panel).toContain(
          "promptReferencesWithVideoFrames",
        );

        expect(panel).toContain(
          "const canBuildPrompt =",
        );

        expect(panel).toContain(
          "hasReferenceVideo",
        );

        expect(panel).toContain(
          "Video reference ready",
        );
      },
    );

    it(
      "uses owner-scoped staged video upload and server ffmpeg extraction for prompt-frame analysis",
      () => {
        const route =
          read(
            "app/api/h3/prompt/video-reference/route.ts",
          );

        expect(route).toContain(
          "getOwnerContext",
        );

        expect(route).toContain(
          "readCompletedH3StagedUpload",
        );

        expect(route).toContain(
          "extractH3ReferenceVideoPromptFrame",
        );

        expect(route).toContain(
          "qwenDurableFetch",
        );

        expect(route).toContain(
          "first frame of the selected five-second video reference window",
        );
      },
    );

    it(
      "allows Reference-to-Video Prompt Builder to start from a video reference without typed scene text",
      () => {
        const promptRoute =
          read(
            "app/api/h3/prompt/route.ts",
          );

        expect(promptRoute).toContain(
          "hasVideoReference",
        );

        expect(promptRoute).toContain(
          "if (!originalPrompt && !hasVideoReference)",
        );
      },
    );
  },
);
