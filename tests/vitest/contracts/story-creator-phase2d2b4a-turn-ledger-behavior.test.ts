import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type Store =
  typeof import(
    "../../../lib/storyCreator/store"
  );

let store: Store;
let tempRoot = "";

let activeProject:
  ReturnType<
    Store["createStoryCreatorProject"]
  > | null = null;

const oldDataDir =
  process.env.OTG_DATA_DIR;

const oldDataRoot =
  process.env.OTG_DATA_ROOT;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "otg-turn-ledger-",
    ),
  );

  process.env.OTG_DATA_DIR =
    tempRoot;

  process.env.OTG_DATA_ROOT =
    tempRoot;

  vi.resetModules();

  store =
    await import(
      "../../../lib/storyCreator/store"
    );
});

afterEach(() => {
  if (!activeProject) return;

  store.deleteStoryCreatorProject({
    ownerKey:
      activeProject.ownerKey,
    id:
      activeProject.id,
  });

  activeProject = null;
});

afterAll(() => {
  if (oldDataDir === undefined) {
    delete process.env.OTG_DATA_DIR;
  } else {
    process.env.OTG_DATA_DIR =
      oldDataDir;
  }

  if (oldDataRoot === undefined) {
    delete process.env.OTG_DATA_ROOT;
  } else {
    process.env.OTG_DATA_ROOT =
      oldDataRoot;
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

function project(
  suffix: string,
) {
  if (activeProject) {
    throw new Error(
      "Disposable Story leak.",
    );
  }

  activeProject =
    store.createStoryCreatorProject({
      ownerKey: "2d2b4a-owner",
      title: `Ledger ${suffix}`,
      format: "feature",
      genre: "drama",
    });

  return activeProject;
}

function turnId(
  n: number,
) {
  return (
    "11111111-1111-4111-8111-" +
    String(n).padStart(12, "0")
  );
}

function wait(ms: number) {
  return new Promise<void>(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

describe(
  "Story Creator 2D2B4A ledger behavior",
  () => {
    it(
      "deduplicates a live duplicate",
      () => {
        const p = project("duplicate");

        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: turnId(1),
            content: "Lena enters.",
          });

        expect(first.action).toBe(
          "claimed",
        );

        if (
          first.action !== "claimed"
        ) {
          return;
        }

        const second =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: turnId(1),
            content: "Lena enters.",
          });

        expect(second.action).toBe(
          "in_progress",
        );

        expect(
          second.userMessage.id,
        ).toBe(
          first.userMessage.id,
        );

        expect(
          store.listStoryCreatorMessages({
            ownerKey: p.ownerKey,
            projectId: p.id,
          }),
        ).toHaveLength(1);
      },
    );

    it(
      "rejects key-content conflict",
      () => {
        const p = project("conflict");
        const id = turnId(2);

        store.claimStoryCreatorTurn({
          ownerKey: p.ownerKey,
          projectId: p.id,
          clientTurnId: id,
          content: "A",
        });

        let caught:
          unknown;

        try {
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "B",
          });
        } catch (error) {
          caught = error;
        }

        expect(
          (
            caught as {
              code?: string;
            }
          ).code,
        ).toBe(
          "STORY_DIRECTOR_TURN_ID_CONFLICT",
        );
      },
    );

    it(
      "reclaims failed using same user",
      () => {
        const p = project("failed");
        const id = turnId(3);

        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Bridge.",
          });

        if (
          first.action !== "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        store.failStoryCreatorTurn({
          ownerKey: p.ownerKey,
          projectId: p.id,
          clientTurnId: id,
          leaseToken:
            first.leaseToken,
          error: "synthetic",
        });

        const retry =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Bridge.",
          });

        expect(retry.action).toBe(
          "claimed",
        );

        if (
          retry.action !== "claimed"
        ) {
          return;
        }

        expect(
          retry.userMessage.id,
        ).toBe(
          first.userMessage.id,
        );

        expect(
          store.listStoryCreatorMessages({
            ownerKey: p.ownerKey,
            projectId: p.id,
          }),
        ).toHaveLength(1);
      },
    );

    it(
      "reclaims expired running and blocks stale worker",
      async () => {
        const p =
          project("expired-running");
        const id = turnId(4);

        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Gate.",
            leaseMs: 1,
          });

        if (
          first.action !== "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        await wait(20);

        const second =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Gate.",
            leaseMs: 5000,
          });

        expect(second.action).toBe(
          "claimed",
        );

        if (
          second.action !== "claimed"
        ) {
          return;
        }

        let caught:
          unknown;

        try {
          store.saveStoryCreatorTurnAssistant({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            leaseToken:
              first.leaseToken,
            content: "Stale.",
          });
        } catch (error) {
          caught = error;
        }

        expect(
          (
            caught as {
              code?: string;
            }
          ).code,
        ).toBe(
          "STORY_DIRECTOR_TURN_LEASE_LOST",
        );

        store.saveStoryCreatorTurnAssistant({
          ownerKey: p.ownerKey,
          projectId: p.id,
          clientTurnId: id,
          leaseToken:
            second.leaseToken,
          content: "Open.",
        });
      },
    );

    it(
      "expired owner cannot save before reclaim",
      async () => {
        const p =
          project("expired-holder");
        const id = turnId(5);

        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Bell.",
            leaseMs: 1,
          });

        if (
          first.action !== "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        await wait(20);

        let caught:
          unknown;

        try {
          store.saveStoryCreatorTurnAssistant({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            leaseToken:
              first.leaseToken,
            content: "Echo.",
          });
        } catch (error) {
          caught = error;
        }

        expect(
          (
            caught as {
              code?: string;
            }
          ).code,
        ).toBe(
          "STORY_DIRECTOR_TURN_LEASE_LOST",
        );
      },
    );

    it(
      "live assistant-saved is in progress",
      () => {
        const p =
          project("assistant-live");
        const id = turnId(6);

        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Key.",
          });

        if (
          first.action !== "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        const assistant =
          store.saveStoryCreatorTurnAssistant({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            leaseToken:
              first.leaseToken,
            content: "Brass key.",
          });

        const duplicate =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Key.",
          });

        expect(
          duplicate.action,
        ).toBe("in_progress");

        expect(
          duplicate.assistantMessage?.id,
        ).toBe(
          assistant.id,
        );
      },
    );

    it(
      "resumes assistant-saved after its lease expires",
      async () => {
        const p =
          project("assistant-resume");
        const id = turnId(7);

        /*
         * V5:
         * Long initial lease avoids suite-load flake.
         */
        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Springfield.",
            leaseMs: 5000,
          });

        if (
          first.action !== "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        /*
         * Only the assistant-saved stage gets
         * an intentionally short lease.
         */
        const assistant =
          store.saveStoryCreatorTurnAssistant({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            leaseToken:
              first.leaseToken,
            content:
              "Reached Springfield.",
            leaseMs: 10,
          });

        await wait(40);

        const resumed =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Springfield.",
            leaseMs: 5000,
          });

        expect(
          resumed.action,
        ).toBe(
          "resume_assistant",
        );

        if (
          resumed.action !==
          "resume_assistant"
        ) {
          return;
        }

        expect(
          resumed.assistantMessage.id,
        ).toBe(
          assistant.id,
        );

        expect(
          store.listStoryCreatorMessages({
            ownerKey: p.ownerKey,
            projectId: p.id,
          }),
        ).toHaveLength(2);
      },
    );

    it(
      "replays completed original pair",
      () => {
        const p = project("completed");
        const id = turnId(8);

        const first =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Storm.",
          });

        if (
          first.action !== "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        const assistant =
          store.saveStoryCreatorTurnAssistant({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            leaseToken:
              first.leaseToken,
            content: "Storm ends.",
          });

        store.completeStoryCreatorTurn({
          ownerKey: p.ownerKey,
          projectId: p.id,
          clientTurnId: id,
          leaseToken:
            first.leaseToken,
        });

        const replay =
          store.claimStoryCreatorTurn({
            ownerKey: p.ownerKey,
            projectId: p.id,
            clientTurnId: id,
            content: "Storm.",
          });

        expect(replay.action).toBe(
          "completed",
        );

        if (
          replay.action !== "completed"
        ) {
          return;
        }

        expect(
          replay.userMessage.id,
        ).toBe(
          first.userMessage.id,
        );

        expect(
          replay.assistantMessage.id,
        ).toBe(
          assistant.id,
        );

        expect(
          store.listStoryCreatorMessages({
            ownerKey: p.ownerKey,
            projectId: p.id,
          }),
        ).toHaveLength(2);
      },
    );
    it(
      "rejects a late assistant save after completion",
      () => {
        const p =
          project(
            "completed-late-save",
          );

        const id =
          turnId(9);

        const claim =
          store.claimStoryCreatorTurn({
            ownerKey:
              p.ownerKey,
            projectId:
              p.id,
            clientTurnId:
              id,
            content:
              "Final scene.",
          });

        if (
          claim.action !==
          "claimed"
        ) {
          throw new Error(
            "claim failed",
          );
        }

        const assistant =
          store.saveStoryCreatorTurnAssistant({
            ownerKey:
              p.ownerKey,
            projectId:
              p.id,
            clientTurnId:
              id,
            leaseToken:
              claim.leaseToken,
            content:
              "The scene ends.",
          });

        store.completeStoryCreatorTurn({
          ownerKey:
            p.ownerKey,
          projectId:
            p.id,
          clientTurnId:
            id,
          leaseToken:
            claim.leaseToken,
        });

        let caught:
          unknown;

        try {
          store.saveStoryCreatorTurnAssistant({
            ownerKey:
              p.ownerKey,
            projectId:
              p.id,
            clientTurnId:
              id,
            leaseToken:
              claim.leaseToken,
            content:
              "Late stale response.",
          });
        } catch (error) {
          caught = error;
        }

        expect(
          (
            caught as {
              code?: string;
            }
          ).code,
        ).toBe(
          "STORY_DIRECTOR_TURN_STATE_INVALID",
        );

        const messages =
          store.listStoryCreatorMessages({
            ownerKey:
              p.ownerKey,
            projectId:
              p.id,
          });

        expect(
          messages,
        ).toHaveLength(2);

        expect(
          messages[1]?.id,
        ).toBe(
          assistant.id,
        );
      },
    );

  },
);
