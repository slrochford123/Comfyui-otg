import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type StoryStore =
  typeof import("../../../lib/storyCreator/store");

let store: StoryStore;
let tempRoot = "";

const previousDataDir =
  process.env.OTG_DATA_DIR;
const previousDataRoot =
  process.env.OTG_DATA_ROOT;

function expectCode(
  action: () => unknown,
  expectedCode: string,
) {
  try {
    action();
  } catch (error) {
    expect(
      error &&
        typeof error === "object" &&
        "code" in error
        ? String(
            (
              error as {
                code?: unknown;
              }
            ).code || "",
          )
        : "",
    ).toBe(expectedCode);

    return;
  }

  throw new Error(
    `Expected ${expectedCode}, but the action succeeded.`,
  );
}

describe(
  "Story Creator Mature Language validation behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-mature-validation-",
        ),
      );

      process.env.OTG_DATA_DIR =
        tempRoot;
      process.env.OTG_DATA_ROOT =
        tempRoot;

      vi.resetModules();

      store = await import(
        "../../../lib/storyCreator/store"
      );
    });

    afterAll(() => {
      if (
        previousDataDir === undefined
      ) {
        delete process.env.OTG_DATA_DIR;
      } else {
        process.env.OTG_DATA_DIR =
          previousDataDir;
      }

      if (
        previousDataRoot === undefined
      ) {
        delete process.env.OTG_DATA_ROOT;
      } else {
        process.env.OTG_DATA_ROOT =
          previousDataRoot;
      }

      if (tempRoot) {
        fs.rmSync(
          tempRoot,
          {
            recursive: true,
            force: true,
          },
        );
      }
    });

    it(
      "accepts only real booleans and preserves the stored value when omitted",
      () => {
        const ownerKey =
          "mature-validation-owner";

        expectCode(
          () =>
            store.createStoryCreatorProject({
              ownerKey,
              title:
                "Invalid Create",
              matureLanguageEnabled:
                "true",
            }),
          "STORY_PROJECT_INVALID",
        );

        const project =
          store.createStoryCreatorProject({
            ownerKey,
            title:
              "Validation Story",
            matureLanguageEnabled:
              true,
          });

        expect(
          project.matureLanguageEnabled,
        ).toBe(true);

        expectCode(
          () =>
            store.updateStoryCreatorProject({
              ownerKey,
              id: project.id,
              matureLanguageEnabled:
                1,
            }),
          "STORY_PROJECT_INVALID",
        );

        const afterInvalid =
          store.getStoryCreatorProject({
            ownerKey,
            projectId:
              project.id,
          });

        expect(
          afterInvalid
            .matureLanguageEnabled,
        ).toBe(true);

        const renamed =
          store.updateStoryCreatorProject({
            ownerKey,
            id: project.id,
            title:
              "Still Enabled",
          });

        expect(
          renamed.matureLanguageEnabled,
        ).toBe(true);

        const disabled =
          store.updateStoryCreatorProject({
            ownerKey,
            id: project.id,
            matureLanguageEnabled:
              false,
          });

        expect(
          disabled.matureLanguageEnabled,
        ).toBe(false);
      },
    );
  },
);
