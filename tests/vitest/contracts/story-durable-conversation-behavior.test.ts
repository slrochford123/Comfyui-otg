import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "story-turn-test-"));
  vi.stubEnv("OTG_DATA_DIR", root);
  vi.stubEnv("OTG_DATA_ROOT", root);
  vi.resetModules();
});
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function setup() {
  const store = await import("../../../lib/storyCreator/store");
  const ownerKey = "turn-owner";
  const project = store.createStoryCreatorProject({ ownerKey, title: "Saved café story" });
  const identity = { ownerKey, projectId: project.id };
  const source = store.addStoryCreatorMessage({ ...identity, role: "user", content: "Mara is a pilot. What do you think?" });
  return { store, identity, source };
}

describe("server-owned Story Creator replies", () => {
  it("deduplicates source messages and atomically saves exactly one completed assistant message", async () => {
    const { store, identity, source } = await setup();
    const first = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id });
    const again = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id });
    expect(again.created).toBe(false);
    expect(again.turn.id).toBe(first.turn.id);
    const scope = { ...identity, turnId: first.turn.id, leaseToken: "owned-execution" };
    expect(store.claimStoryConversationTurn(scope)).toBe(true);
    expect(store.claimStoryConversationTurn(scope)).toBe(false);
    store.updateStoryConversationTurn({ ...scope, partialText: "That's an interesting" });
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(1);
    const saved = store.completeStoryConversationTurn({ ...scope, content: "That's an interesting start. What does Mara fly?" });
    expect(saved?.role).toBe("assistant");
    expect(store.completeStoryConversationTurn({ ...scope, content: "Duplicate" })).toBeNull();
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(2);
    expect(store.getStoryConversationTurn(scope)?.assistantMessageId).toBe(saved?.id);
    expect(store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id }).created).toBe(false);
  });

  it("enforces ownership and rejects assistant-source requests and parallel turns", async () => {
    const { store, identity, source } = await setup();
    const { turn } = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id });
    expect(() => store.getStoryConversationTurn({ ...identity, ownerKey: "different-owner", turnId: turn.id })).toThrow();
    const other = store.createStoryCreatorProject({ ownerKey: identity.ownerKey, title: "Other story" });
    expect(store.getStoryConversationTurn({ ...identity, projectId: other.id, turnId: turn.id })).toBeNull();
    const assistant = store.addStoryCreatorMessage({ ...identity, role: "assistant", content: "A suggestion." });
    expect(() => store.createStoryConversationTurn({ ...identity, sourceMessageId: assistant.id })).toThrow("saved user message");
    const second = store.addStoryCreatorMessage({ ...identity, role: "user", content: "Another idea." });
    expect(() => store.createStoryConversationTurn({ ...identity, sourceMessageId: second.id })).toThrow("already in progress");
    expect(store.claimStoryConversationTurn({ ...identity, projectId: other.id, turnId: turn.id, leaseToken: "bad" })).toBe(false);
  });

  it("cancels queued/running replies without promoting partial text into messages", async () => {
    const { store, identity, source } = await setup();
    const { turn } = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id });
    const scope = { ...identity, turnId: turn.id, leaseToken: "cancel-execution" };
    store.claimStoryConversationTurn(scope);
    store.updateStoryConversationTurn({ ...scope, partialText: "Incomplete sentence" });
    expect(store.cancelStoryConversationTurn(scope)?.cancelRequested).toBe(true);
    expect(store.completeStoryConversationTurn({ ...scope, content: "Do not save this" })).toBeNull();
    store.updateStoryConversationTurn({ ...scope, terminal: "cancelled" });
    expect(store.getStoryConversationTurn(scope)?.status).toBe("cancelled");
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(1);
    const nextSource = store.addStoryCreatorMessage({ ...identity, role: "user", content: "Try a different idea." });
    const next = store.createStoryConversationTurn({ ...identity, sourceMessageId: nextSource.id });
    expect(store.cancelStoryConversationTurn({ ...identity, turnId: next.turn.id })?.status).toBe("cancelled");
    expect(store.claimStoryConversationTurn({ ...scope, turnId: next.turn.id })).toBe(false);
  });

  it("marks abandoned leased requests interrupted instead of silently replaying them", async () => {
    const { store, identity, source } = await setup();
    const { turn } = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id });
    const fixture = new Database(path.join(root, "story-creator", "story-creator.sqlite"));
    fixture.prepare("UPDATE story_conversation_turns SET lease_until=1 WHERE id=?").run(turn.id);
    fixture.close();
    const recovered = store.getStoryConversationTurn({ ...identity, turnId: turn.id });
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.error).toContain("No automatic resubmission");
    expect(store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id }).created).toBe(false);
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(1);
  });

  it("saves validated new facts in the same turn, supports undo and preserves later edits", async () => {
    const { store, identity, source } = await setup();
    const { turn } = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id });
    const scope = { ...identity, turnId: turn.id, leaseToken: "memory-execution" };
    store.claimStoryConversationTurn(scope);
    store.completeStoryConversationTurn({ ...scope, content: "An interesting starting point.", memory: {
      entities: [{ name: "Mara", entityType: "character" }],
      facts: [{ subjectName: "Mara", predicate: "profession", valueText: "a pilot", canonStatus: "suggestion" }],
    } });
    const facts = store.listStoryBibleFacts(identity);
    expect(facts[0].canonStatus).toBe("canon");
    expect(store.getStoryConversationTurn(scope)?.memoryCanUndo).toBe(true);
    expect(store.undoStoryConversationMemory(scope)?.memoryCanUndo).toBe(false);
    expect(store.listStoryBibleFacts(identity)).toHaveLength(0);
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(2);
    expect(store.undoStoryConversationMemory(scope)?.memorySummary).toContain("Undid 0");
  });
});
