import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const upstream = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/openai/provider", () => ({ createOpenAITextStream: upstream.stream,
  openAIModels: () => ({ story: "configured-test-model" }) }));
let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "story-turn-executor-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_DATA_ROOT", root); vi.stubEnv("STORY_CREATOR_CPU_ROOT", "");
  vi.resetModules(); upstream.stream.mockReset();
});
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
async function setup() {
  const store = await import("../../../lib/storyCreator/store");
  const project = store.createStoryCreatorProject({ ownerKey: "executor-owner", title: "Mara's flight" });
  const source = store.addStoryCreatorMessage({ ownerKey: project.ownerKey, projectId: project.id,
    role: "user", content: "Mara is a pilot." });
  const { turn } = store.createStoryConversationTurn({ ownerKey: project.ownerKey, projectId: project.id, sourceMessageId: source.id });
  const identity = { ownerKey: project.ownerKey, projectId: project.id, turnId: turn.id };
  const executor = await import("../../../lib/storyCreator/conversationExecutor");
  return { store, identity, executor };
}

describe("durable reply execution without paid inference", () => {
  it("turns an explicit unnamed-character tool call into a durable name card without inference",async()=>{
    vi.stubEnv("OTG_ENV","test");
    const {store,identity,executor}=await setup();store.cancelStoryConversationTurn(identity);
    const source=store.addStoryCreatorMessage({...identity,role:"user",content:"Generate an image of a bunny."});
    const {turn}=store.createStoryConversationTurn({...identity,sourceMessageId:source.id});
    upstream.stream.mockResolvedValue((async function*(){yield {type:"done",text:"",toolCalls:[{name:"create_story_media",arguments:JSON.stringify({operation:"image",subject:"character",name:"",prompt:"A bunny with one pink ear.",sourceId:"",text:"",evidence:source.content})}]};})());
    await executor.executeStoryConversationTurn({...identity,turnId:turn.id},"fixture");
    const media=await import("../../../lib/storyCreator/mediaStore");
    expect(media.listStoryMedia(identity.ownerKey,identity.projectId)[0].status).toBe("needs_name");
    expect(store.listStoryCreatorMessages(identity).at(-1)?.content).toContain("character's name");
    expect(upstream.stream.mock.calls[0][0].tools[0].name).toBe("create_story_media");
  });
  it("saves a reply and validated memory in one upstream call, independent of a browser stream", async () => {
    const { store, identity, executor } = await setup();
    const raw = JSON.stringify({ reply: "That gives us a compelling starting point.", facts: [
      { subjectName: "Mara", entityType: "character", predicate: "profession", valueText: "a pilot", evidence: "Mara is a pilot." },
    ] });
    upstream.stream.mockResolvedValue((async function* () {
      yield { type: "delta", delta: raw.slice(0, 24) };
      yield { type: "delta", delta: raw.slice(24) };
      yield { type: "done", text: raw };
    })());
    await executor.executeStoryConversationTurn(identity);
    expect(upstream.stream).toHaveBeenCalledTimes(1);
    expect(upstream.stream.mock.calls[0][0]).toMatchObject({ maxRetries: 0,
      responseSchema: { name: "story_conversation_v1" }, model: "configured-test-model" });
    expect(store.getStoryConversationTurn(identity)?.status).toBe("completed");
    expect(store.listStoryCreatorMessages(identity).at(-1)?.content).toBe("That gives us a compelling starting point.");
    expect(store.listStoryBibleFacts(identity)[0].valueText).toBe("a pilot");
    await executor.executeStoryConversationTurn(identity);
    expect(upstream.stream).toHaveBeenCalledTimes(1);
  });
  it("does not replay failed submissions or save partial replies as completed messages", async () => {
    const { store, identity, executor } = await setup();
    upstream.stream.mockRejectedValue(new Error("Synthetic provider failure"));
    await executor.executeStoryConversationTurn(identity);
    expect(store.getStoryConversationTurn(identity)?.status).toBe("failed");
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(1);
    await executor.executeStoryConversationTurn(identity);
    expect(upstream.stream).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation before final persistence", async () => {
    const { store, identity, executor } = await setup();
    upstream.stream.mockResolvedValue((async function* () {
      yield { type: "delta", delta: '{"reply":"An unfinished reply' };
      store.cancelStoryConversationTurn(identity);
      yield { type: "done", text: '{"reply":"Do not save me","facts":[]}' };
    })());
    await executor.executeStoryConversationTurn(identity);
    expect(store.getStoryConversationTurn(identity)?.status).toBe("cancelled");
    expect(store.listStoryCreatorMessages(identity)).toHaveLength(1);
    expect(store.listStoryBibleFacts(identity)).toHaveLength(0);
  });
  it("persists writing versions without promoting the generated draft to canon", async () => {
    const { store, identity, executor } = await setup();
    // Cancel the initial unused fixture turn before submitting a writing operation.
    store.cancelStoryConversationTurn(identity);
    const source = store.addStoryCreatorMessage({ ...identity, role: "user", content: "Write a scene where Mara meets Elin." });
    const { turn } = store.createStoryConversationTurn({ ...identity, sourceMessageId: source.id,
      purpose: "writing", writingMode: "scene" });
    const raw = JSON.stringify({ reply: "INT. CAFÉ — DAY\nMara meets Elin.", facts: [] });
    upstream.stream.mockResolvedValue((async function* () { yield { type: "done", text: raw }; })());
    await executor.executeStoryConversationTurn({ ...identity, turnId: turn.id });
    expect(upstream.stream.mock.calls[0][0].useCase).toBe("story-write");
    expect(store.listStoryWritingTurns(identity)[0].message.content).toContain("INT. CAFÉ");
    expect(store.listStoryBibleFacts(identity)).toHaveLength(0);
  });
});
