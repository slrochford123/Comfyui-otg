import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8",
  );
}

const writeRoute = read(
  "app/api/story-creator/bible/write/route.ts",
);

const readRoute = read(
  "app/api/story-creator/bible/route.ts",
);

const store = read(
  "lib/storyCreator/store.ts",
);

describe(
  "Story Creator Phase 2C Story Bible write contract",
  () => {
    it(
      "requires authenticated ownership",
      () => {
        expect(writeRoute).toContain(
          "requireSessionUser",
        );

        expect(writeRoute).toContain(
          "authenticatedOwnerKey",
        );

        expect(writeRoute).toContain(
          "SessionInvalidError",
        );

        expect(writeRoute).toContain(
          "? 401",
        );
      },
    );

    it(
      "keeps the accepted Story Bible read route GET-only",
      () => {
        expect(readRoute).toContain(
          "export async function GET",
        );

        expect(readRoute).not.toContain(
          "export async function POST",
        );

        expect(readRoute).not.toContain(
          "export async function PATCH",
        );

        expect(readRoute).not.toContain(
          "export async function DELETE",
        );
      },
    );

    it(
      "exposes a separate POST-only mutation route",
      () => {
        expect(writeRoute).toContain(
          "export async function POST",
        );

        expect(writeRoute).not.toContain(
          "export async function GET",
        );

        expect(writeRoute).not.toContain(
          "export async function PATCH",
        );

        expect(writeRoute).not.toContain(
          "export async function DELETE",
        );

        expect(writeRoute).toContain(
          '"create-entity"',
        );

        expect(writeRoute).toContain(
          '"add-fact"',
        );
      },
    );

    it(
      "keeps ownership and provenance server-controlled",
      () => {
        expect(writeRoute).toContain(
          "assertServerOwnedProvenance",
        );

        expect(writeRoute).toContain(
          '"ownerKey" in body',
        );

        expect(writeRoute).toContain(
          '"sourceRole" in body',
        );

        expect(writeRoute).toContain(
          'sourceRole: "user"',
        );

        expect(writeRoute).not.toContain(
          "ownerKey: body?.ownerKey",
        );

        expect(writeRoute).not.toContain(
          "sourceRole: body?.sourceRole",
        );
      },
    );

    it(
      "allows authenticated manual entity creation",
      () => {
        expect(writeRoute).toContain(
          "createStoryBibleEntity",
        );

        expect(writeRoute).toContain(
          "entityType: body?.entityType",
        );

        expect(writeRoute).toContain(
          "name: body?.name",
        );

        expect(writeRoute).toContain(
          "sourceMessageId:",
        );
      },
    );

    it(
      "allows append-only fact creation and revision",
      () => {
        expect(writeRoute).toContain(
          "addStoryBibleFact",
        );

        expect(writeRoute).toContain(
          "subjectEntityId:",
        );

        expect(writeRoute).toContain(
          "predicate: body?.predicate",
        );

        expect(writeRoute).toContain(
          "canonStatus:",
        );

        expect(writeRoute).toContain(
          "supersedesFactId:",
        );

        expect(writeRoute).not.toContain(
          "UPDATE story_facts",
        );

        expect(writeRoute).not.toContain(
          "DELETE FROM story_facts",
        );
      },
    );

    it(
      "blocks non-user canon at store and SQLite boundaries",
      () => {
        expect(store).toContain(
          "STORY_BIBLE_ASSISTANT_CANON_FORBIDDEN",
        );

        expect(store).toContain(
          "STORY_BIBLE_SYSTEM_CANON_FORBIDDEN",
        );

        expect(store).toContain(
          "trg_story_facts_non_user_canon",
        );

        expect(store).toContain(
          "STORY_BIBLE_NON_USER_CANON_FORBIDDEN",
        );

        expect(store).toContain(
          "NEW.source_role <> 'user'",
        );
      },
    );
  },
);
