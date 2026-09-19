import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const panel = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/app/components/StoryCreatorPanel.tsx",
  ),
  "utf8",
);

describe(
  "Story Reference Rail prototype V3",
  () => {
    it(
      "adds a collapsible side rail without wrapping the existing column",
      () => {
        expect(panel).toContain(
          "storyReferenceOpen",
        );

        expect(panel).toContain(
          "Collapse Story Reference",
        );

        expect(panel).toContain(
          "Open Story Reference",
        );

        expect(panel).toContain(
          "xl:grid-cols-[minmax(0,1fr)_64px]",
        );

        expect(panel).toContain(
          "[&>div]:hidden",
        );
      },
    );

    it(
      "shows read-only temporary recent mentions",
      () => {
        expect(panel).toContain(
          "storyReferenceRecentMentions",
        );

        expect(panel).toContain(
          "Recent Mentions",
        );

        expect(panel).toContain(
          "Not saved",
        );

        expect(panel).toContain(
          "temporary",
        );
      },
    );

    it(
      "groups durable Bible entries into writer-friendly categories",
      () => {
        expect(panel).toContain(
          '"Characters"',
        );

        expect(panel).toContain(
          '"Locations"',
        );

        expect(panel).toContain(
          '"Powers & Abilities"',
        );

        expect(panel).toContain(
          '"Key Objects"',
        );

        expect(panel).toContain(
          "Key Story Points",
        );
      },
    );

    it(
      "shows canon suggestion and unknown distinctions",
      () => {
        expect(panel).toContain(
          '"canon"',
        );

        expect(panel).toContain(
          '"suggestion"',
        );

        expect(panel).toContain(
          '"unknown"',
        );
      },
    );

    it(
      "does not expose a Story Bible writer",
      () => {
        expect(panel).not.toContain(
          '"/api/story-creator/bible/write"',
        );

        expect(panel).not.toContain(
          "createStoryBibleEntity",
        );

        expect(panel).not.toContain(
          "addStoryBibleFact",
        );

        expect(panel).toContain(
          "/api/story-creator/bible?projectId=",
        );
      },
    );

    it(
      "preserves the existing read-only Story Bible UI",
      () => {
        expect(panel).toContain(
          "Canon & Continuity",
        );

        expect(panel).toContain(
          "Read only",
        );

        expect(panel).toContain(
          "Persistent Story ID",
        );

        expect(panel).toContain(
          "Production",
        );
      },
    );
  },
);
