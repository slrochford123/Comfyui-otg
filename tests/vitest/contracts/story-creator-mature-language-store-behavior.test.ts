import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

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
let databasePath = "";

const previousDataDir =
  process.env.OTG_DATA_DIR;
const previousDataRoot =
  process.env.OTG_DATA_ROOT;

describe(
  "Story Creator Mature Language SQLite behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-mature-language-",
        ),
      );

      const storyRoot =
        path.join(
          tempRoot,
          "story-creator",
        );

      fs.mkdirSync(
        storyRoot,
        {
          recursive: true,
        },
      );

      databasePath =
        path.join(
          storyRoot,
          "story-creator.sqlite",
        );

      /*
       * Simulate a real existing Story Creator database
       * created before mature_language_enabled existed.
       */
      const legacyDb =
        new Database(databasePath);

      legacyDb.exec(`
        CREATE TABLE story_projects (
          id TEXT PRIMARY KEY,
          owner_key TEXT NOT NULL,
          title TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT '',
          genre TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      legacyDb
        .prepare(`
          INSERT INTO story_projects (
            id,
            owner_key,
            title,
            format,
            genre,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `)
        .run(
          "legacy-project",
          "legacy-owner",
          "Legacy Story",
          "feature",
          "drama",
          1000,
          1000,
        );

      legacyDb.close();

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
      "migrates old databases and persists the per-story Mature Language setting",
      () => {
        const legacyProjects =
          store.listStoryCreatorProjects(
            "legacy-owner",
          );

        expect(
          legacyProjects,
        ).toHaveLength(1);

        expect(
          legacyProjects[0]
            .matureLanguageEnabled,
        ).toBe(false);

        const inspectionDb =
          new Database(
            databasePath,
            {
              readonly: true,
            },
          );

        const columns =
          inspectionDb
            .prepare(
              "PRAGMA table_info(story_projects)",
            )
            .all() as Array<{
              name: string;
              dflt_value: unknown;
            }>;

        inspectionDb.close();

        const matureColumn =
          columns.find(
            (column) =>
              column.name ===
              "mature_language_enabled",
          );

        expect(
          matureColumn,
        ).toBeDefined();

        expect(
          String(
            matureColumn?.dflt_value,
          ),
        ).toBe("0");

        const defaultProject =
          store.createStoryCreatorProject({
            ownerKey:
              "mature-language-owner",
            title:
              "Default Language Story",
          });

        expect(
          defaultProject
            .matureLanguageEnabled,
        ).toBe(false);

        const enabledProject =
          store.createStoryCreatorProject({
            ownerKey:
              "mature-language-owner",
            title:
              "Mature Language Story",
            matureLanguageEnabled:
              true,
          });

        expect(
          enabledProject
            .matureLanguageEnabled,
        ).toBe(true);

        const listedEnabled =
          store
            .listStoryCreatorProjects(
              "mature-language-owner",
            )
            .find(
              (project) =>
                project.id ===
                enabledProject.id,
            );

        expect(
          listedEnabled
            ?.matureLanguageEnabled,
        ).toBe(true);

        const renamedProject =
          store.updateStoryCreatorProject({
            ownerKey:
              "mature-language-owner",
            id:
              enabledProject.id,
            title:
              "Renamed Mature Story",
          });

        expect(
          renamedProject.title,
        ).toBe(
          "Renamed Mature Story",
        );

        expect(
          renamedProject
            .matureLanguageEnabled,
        ).toBe(true);

        const disabledProject =
          store.updateStoryCreatorProject({
            ownerKey:
              "mature-language-owner",
            id:
              enabledProject.id,
            matureLanguageEnabled:
              false,
          });

        expect(
          disabledProject
            .matureLanguageEnabled,
        ).toBe(false);

        const listedDisabled =
          store
            .listStoryCreatorProjects(
              "mature-language-owner",
            )
            .find(
              (project) =>
                project.id ===
                enabledProject.id,
            );

        expect(
          listedDisabled
            ?.matureLanguageEnabled,
        ).toBe(false);
      },
    );
  },
);
