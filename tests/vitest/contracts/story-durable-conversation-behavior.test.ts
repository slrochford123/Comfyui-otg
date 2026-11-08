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
  it("queues the exact follow-up as one voice audition with the original accent", async () => {
    vi.stubEnv("OTG_ENV","test");
    vi.stubEnv("OTG_STORY_CHAT_MEDIA","1");
    const {store,identity}=await setup();
    const {executeStoryConversationTurn}=await import("../../../lib/storyCreator/conversationExecutor");
    const media=await import("../../../lib/storyCreator/mediaExecution");
    const dispatch=vi.spyOn(media,"executeStoryMedia").mockResolvedValue(undefined);
    const add=(content:string)=>{
      const source=store.addStoryCreatorMessage({...identity,role:"user",content});
      const {turn}=store.createStoryConversationTurn({...identity,sourceMessageId:source.id});
      return {...identity,turnId:turn.id,sourceMessageId:source.id};
    };
    const request=add("I want you to create her voice as a Russian accent, saying that phrase.");
    await executeStoryConversationTurn(request,"");
    expect(store.listStoryCreatorMessages(identity).at(-1)?.content).toBe("Please provide the exact line the character should speak.");
    expect(dispatch).not.toHaveBeenCalled();
    const line="hello I am Dr. Helena Boss I would like to welcome you to your new life.";
    const reply=add("exact line is "+line);
    await executeStoryConversationTurn(reply,"");
    await executeStoryConversationTurn(reply,"");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const record=dispatch.mock.calls[0][0];
    expect(record.command).toMatchObject({operation:"voice",voiceMode:"design",name:"Dr. Helena Boss",text:line,prompt:expect.stringContaining("Russian accent")});
    expect(record.sourceMessageId).toBe(reply.sourceMessageId);
    expect(store.getStoryConversationTurn(reply)?.mediaResultId).toBe(record.id);
  });

  it("uses a single quoted line for a request to say that phrase",async()=>{
    const {storyVoiceDraft,buildStoryVoiceAudition}=await import("../../../lib/storyCreator/voiceFollowup");
    const draft=storyVoiceDraft("I want you to create her voice as a Russian accent, saying that phrase.")!;
    const exact="Hello, I’m Dr. Helena Boss. Welcome to your new life.";
    expect(buildStoryVoiceAudition(draft,undefined,"She says “"+exact+"”")?.command.text).toBe(exact);
    expect(buildStoryVoiceAudition(draft,undefined,'She says “Hello” or “Goodbye”.')).toBeUndefined();
    expect(storyVoiceDraft("Do not create her voice with a Russian accent.")).toBeUndefined();
    expect(storyVoiceDraft("Create an image of a singer with a strong voice.")).toBeUndefined();
  });

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
