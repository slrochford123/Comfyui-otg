import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  claimCharacterCompletionJob,
  clearCharacterCompletionJobsForTests,
  completeCharacterCompletionJob,
  createCharacterCompletionJob,
  failCharacterCompletionJob,
  getCharacterCompletionJob,
  setCharacterCompletionStorePathForTests,
  checkpointCharacterCompletionJob,
} from "@/lib/jobs/characterCompletionJobs";
import { getWorkerCatalogEntry } from "@/lib/workers/workerCatalog";

describe("character completion worker manager", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-character-completion-"));

  beforeEach(() => {
    setCharacterCompletionStorePathForTests(
      path.join(tempRoot, `jobs-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    );
    clearCharacterCompletionJobsForTests();
  });

  it("queues one durable completion job per active character", () => {
    const first = createCharacterCompletionJob("owner-a", {
      characterId: "saved-char-1",
      characterName: "Saved Character",
      sourceImagePath: "/data/source.png",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reused).toBe(false);
    expect(first.job.status).toBe("queued");

    const second = createCharacterCompletionJob("owner-a", {
      characterId: "saved-char-1",
      characterName: "Saved Character",
      sourceImagePath: "/data/source.png",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.job.jobId).toBe(first.job.jobId);
  });

  it("claims, checkpoints, and completes a character job", () => {
    const created = createCharacterCompletionJob("owner-a", {
      characterId: "saved-char-2",
      characterName: "Worker Character",
      sourceImagePath: "/data/source.png",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const claimed = claimCharacterCompletionJob("linux-character-completion-worker");
    expect(claimed?.status).toBe("running");
    expect(claimed?.ownerKey).toBe("owner-a");
    expect(claimed?.attempt).toBe(1);

    const checkpoint = checkpointCharacterCompletionJob(
      "owner-a",
      created.job.jobId,
      45,
      "Waiting for both GPUs.",
      { currentStage: "waiting_for_character_card", promptId: "prompt-1" },
    );
    expect(checkpoint?.progress).toBe(45);
    expect(checkpoint?.result?.promptId).toBe("prompt-1");

    const completed = completeCharacterCompletionJob(
      "owner-a",
      created.job.jobId,
      {
        characterId: "saved-char-2",
        cardImagePath: "/data/card.png",
      },
      "Complete",
    );
    expect(completed?.status).toBe("completed");
    expect(completed?.progress).toBe(100);
    expect(getCharacterCompletionJob("owner-a", created.job.jobId)?.status).toBe("completed");
  });

  it("rejects completion without a saved character id and card path", () => {
    const created = createCharacterCompletionJob("owner-a", {
      characterId: "saved-char-3",
      characterName: "Invalid Completion",
      sourceImagePath: "/data/source.png",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(completeCharacterCompletionJob("owner-a", created.job.jobId, {}, "bad")).toBeNull();
  });

  it("does not overwrite a completed job when a late failure response arrives", () => {
    const created = createCharacterCompletionJob("owner-a", {
      characterId: "saved-char-terminal",
      characterName: "Terminal Character",
      sourceImagePath: "/data/source.png",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const completed = completeCharacterCompletionJob("owner-a", created.job.jobId, {
      characterId: "saved-char-terminal",
      cardImagePath: "/data/card.png",
    }, "Complete");
    expect(completed?.status).toBe("completed");

    const afterLateFailure = failCharacterCompletionJob(
      "owner-a",
      created.job.jobId,
      "response connection closed",
    );
    expect(afterLateFailure?.status).toBe("completed");
    expect(afterLateFailure?.error).toBeNull();
    expect(afterLateFailure?.message).toBe("Complete");
  });

  it("registers the Worker Manager catalog entry", () => {
    const worker = getWorkerCatalogEntry("character-completion");
    expect(worker?.kind).toBe("polling-worker");
    expect(worker?.platform).toBe("linux");
    expect(worker?.gpu).toBe("linux-5060ti");
    expect(worker?.resources).toContain("service:character-completion");
    expect(worker?.lane).toBe("image");
  });
});
