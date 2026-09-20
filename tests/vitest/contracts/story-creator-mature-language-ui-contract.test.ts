import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

const panel = fs.readFileSync(
  path.join(
    root,
    "app/app/components/StoryCreatorPanel.tsx",
  ),
  "utf8",
);

describe(
  "Story Creator Mature Language UI contract",
  () => {
    it(
      "models Mature Language on each Story project",
      () => {
        expect(panel).toContain(
          "matureLanguageEnabled: boolean",
        );
      },
    );

    it(
      "persists the selected Story setting through the project PATCH route",
      () => {
        expect(panel).toContain(
          "async function setMatureLanguage(",
        );

        const start =
          panel.indexOf(
            "async function setMatureLanguage(",
          );

        const end =
          panel.indexOf(
            "async function deleteProject(",
            start,
          );

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const flow =
          panel.slice(
            start,
            end,
          );

        expect(flow).toContain(
          '"/api/story-creator/projects"',
        );

        expect(flow).toContain(
          'method: "PATCH"',
        );

        expect(flow).toContain(
          "matureLanguageEnabled:",
        );

        expect(flow).toContain(
          "setProjects",
        );
      },
    );

    it(
      "shows a per-story Mature Language switch",
      () => {
        expect(panel).toContain(
          'role="switch"',
        );

        expect(panel).toContain(
          "aria-checked={",
        );

        expect(panel).toContain(
          "Mature Language:",
        );

        expect(panel).toContain(
          "!selectedProject.matureLanguageEnabled",
        );
      },
    );

    it(
      "describes the setting as optional strong-language permission rather than forced profanity",
      () => {
        expect(panel).toContain(
          "strong language when it fits the",
        );

        expect(panel).toContain(
          "requested dialogue, tone, or scene.",
        );
      },
    );

    it(
      "keeps Story Bible UI wording aligned with durable proposal extraction",
      () => {
        expect(panel).toContain(
          "Story Director extraction may add",
        );

        expect(panel).toContain(
          "suggestion or unknown",
        );

        expect(panel).toContain(
          "it cannot promote",
        );

        expect(panel).not.toContain(
          "This prototype does not write",
        );

        expect(panel).not.toContain(
          "Story Director does\n                not write or promote canon here yet.",
        );
      },
    );
  },
);
