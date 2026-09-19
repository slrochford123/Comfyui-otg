import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

describe(
  "Story Creator client session authentication contract",
  () => {
    const panel =
      readFileSync(
        "app/app/components/StoryCreatorPanel.tsx",
        "utf8",
      );

    const projectsRoute =
      readFileSync(
        "app/api/story-creator/projects/route.ts",
        "utf8",
      );

    it(
      "does not silently block project operations on a client-derived owner key",
      () => {
        expect(
          panel,
        ).not.toContain(
          "if (!ownerKey) return;",
        );

        expect(
          panel,
        ).not.toContain(
          "if (!ownerKey || busy) return;",
        );

        expect(
          panel,
        ).toContain(
          '"/api/story-creator/projects"',
        );

        expect(
          panel,
        ).toContain(
          'credentials: "include"',
        );
      },
    );

    it(
      "keeps Story Creator project ownership server authenticated",
      () => {
        expect(
          projectsRoute,
        ).toContain(
          'import { requireSessionUser } from "@/lib/sessionUser";',
        );

        expect(
          projectsRoute,
        ).toContain(
          "await requireSessionUser(request)",
        );

        expect(
          projectsRoute,
        ).toContain(
          "return user.ownerKey;",
        );

        expect(
          projectsRoute,
        ).toContain(
          "createStoryCreatorProject({",
        );

        expect(
          projectsRoute,
        ).toContain(
          "ownerKey,",
        );
      },
    );
  },
);
