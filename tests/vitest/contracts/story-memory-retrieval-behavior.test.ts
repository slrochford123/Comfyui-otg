import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "story-recall-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_DATA_ROOT", root);
  vi.stubEnv("STORY_CREATOR_CPU_ROOT", ""); vi.resetModules();
});
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function setup() {
  const store = await import("../../../lib/storyCreator/store");
  const retrieval = await import("../../../lib/storyCreator/retrieval");
  const project = store.createStoryCreatorProject({ ownerKey: "recall-owner", title: "Mara's adventures" });
  const scope = { ownerKey: project.ownerKey, projectId: project.id };
  const message = store.addStoryCreatorMessage({ ...scope, role: "user", content: "Mara has a violet bicycle." });
  const entity = store.createStoryBibleEntity({ ...scope, name: "Mara", entityType: "character", sourceRole: "user", sourceMessageId: message.id });
  const fact = store.addStoryBibleFact({ ...scope, subjectEntityId: entity.id, predicate: "bicycle_color", valueText: "violet", canonStatus: "canon", sourceRole: "user", sourceMessageId: message.id });
  return { store, retrieval, scope, message, entity, fact };
}

describe("scoped story archive recall", () => {
  it("retrieves old details outside the recent conversation and does not duplicate the index", async () => {
    const { store, retrieval, scope, fact, message } = await setup();
    for (let i = 0; i < 60; i++) store.addStoryCreatorMessage({ ...scope, role: "user", content: `Scene ${i}: the friends discuss the weather.` });
    const first = await retrieval.retrieveStoryMemory({ ...scope, query: "What color is Mara's bicycle?" });
    const second = await retrieval.retrieveStoryMemory({ ...scope, query: "violet bicycle" });
    expect(first.factIds).toContain(fact.id);
    expect(first.notes.some((note) => note.sourceMessageId === message.id)).toBe(true);
    expect(first.mode).toBe("keyword");
    expect(second.totalChunks).toBe(first.totalChunks);
    expect(store.listStoryRecallChunks(scope)).toHaveLength(first.totalChunks);
  });

  it("removes superseded/deleted facts and their old source notes from retrieval", async () => {
    const { store, retrieval, scope, fact, message } = await setup();
    await retrieval.retrieveStoryMemory({ ...scope, query: "violet bicycle" });
    const revised = store.reviseStoryCanonFact({ ...scope, factId: fact.id, valueText: "green" });
    let recalled = await retrieval.retrieveStoryMemory({ ...scope, query: "violet bicycle green" });
    expect(recalled.factIds).not.toContain(fact.id);
    expect(recalled.factIds).toContain(revised.id);
    expect(recalled.notes.some((note) => note.sourceMessageId === message.id)).toBe(false);
    store.deleteStoryCanonFact({ ...scope, factId: revised.id });
    recalled = await retrieval.retrieveStoryMemory({ ...scope, query: "bicycle green violet" });
    expect(recalled.factIds).toHaveLength(0);
    expect(recalled.notes).toHaveLength(0);
    expect(store.listStoryRecallChunks(scope)).toHaveLength(0);
  });

  it("keeps stories and owners isolated even with identical character names", async () => {
    const { store, retrieval, scope } = await setup();
    const other = store.createStoryCreatorProject({ ownerKey: scope.ownerKey, title: "Different Mara" });
    store.addStoryCreatorMessage({ ownerKey: other.ownerKey, projectId: other.id, role: "user", content: "Mara owns a secret silver airship." });
    const isolated = await retrieval.retrieveStoryMemory({ ...scope, query: "secret silver airship" });
    expect(isolated.notes).toHaveLength(0);
    await expect(retrieval.retrieveStoryMemory({ ownerKey: "outsider", projectId: scope.projectId, query: "Mara" })).rejects.toThrow();
    const mine = await retrieval.retrieveStoryMemory({ ownerKey: other.ownerKey, projectId: other.id, query: "secret silver airship" });
    expect(mine.notes[0].content).toContain("secret silver airship");
  });

  it("does not let a large canon section starve unresolved questions or proposals", async () => {
    const { store, scope, entity } = await setup();
    for (let i = 0; i < 50; i++) store.addStoryBibleFact({ ...scope, subjectEntityId: entity.id,
      predicate: `detail_${i}`, valueText: "a long detail ".repeat(25), canonStatus: "canon", sourceRole: "user" });
    store.addStoryBibleFact({ ...scope, subjectEntityId: entity.id, predicate: "weapon", valueText: "an unapproved crystal spear", canonStatus: "suggestion", sourceRole: "assistant" });
    const { buildStoryDirectorProjectContext } = await import("../../../lib/storyCreator/context");
    const context = buildStoryDirectorProjectContext({ ...scope, query: "Mara", maxChars: 2500 }).context;
    expect(context.length).toBeLessThanOrEqual(2500);
    expect(context).toContain("PROPOSED DETAILS");
    expect(context).toContain("unapproved crystal spear");
    expect(context).toContain("APPROVED CANON");
  });
});
