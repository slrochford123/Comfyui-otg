import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class FixtureOpenAI { responses = { create: sdk.create }; }, toFile: vi.fn() }));
let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "story-provider-stream-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OPENAI_API_KEY", "fixture-not-a-real-key");
  vi.stubEnv("OPENAI_KILL_SWITCH", "false"); vi.resetModules(); sdk.create.mockReset();
});
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
describe("existing OpenAI adapter with Story Creator structured streaming", () => {
  it("exposes one complete function call without replaying or requiring output text",async()=>{
    const {createOpenAITextStream}=await import("../../../lib/openai/provider");
    const call={type:"function_call",name:"create_story_media",arguments:'{"operation":"image"}',call_id:"call-fixture"};
    sdk.create.mockResolvedValue((async function*(){yield {type:"response.completed",response:{output:[call],usage:{input_tokens:12,output_tokens:5}}};})());
    const stream=await createOpenAITextStream({ownerKey:"fixture-owner",useCase:"story-helper",model:"fixture-model",instructions:"fixture",input:[],tools:[{type:"function",name:"create_story_media"}]});
    const events=[];for await(const event of stream)events.push(event);
    expect(sdk.create.mock.calls[0][0].parallel_tool_calls).toBe(false);expect(events.at(-1)).toMatchObject({type:"done",toolCalls:[{name:call.name,arguments:call.arguments,call_id:call.call_id}]});
  });
  it("passes a strict response schema and disables SDK retries only for the requesting caller", async () => {
    const { createOpenAITextStream } = await import("../../../lib/openai/provider");
    sdk.create.mockResolvedValue((async function* () {
      yield { type: "response.output_text.delta", delta: '{"reply":"Hello","facts":[]}' };
      yield { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 } } };
    })());
    const schema = { name: "fixture", schema: { type: "object", additionalProperties: false, properties: {}, required: [] } };
    const events = await createOpenAITextStream({ ownerKey: "fixture-owner", projectId: "fixture-project", useCase: "story-helper",
      model: "fixture-model", instructions: "fixture", input: [], responseSchema: schema, maxRetries: 0 });
    const output = [];
    for await (const event of events) output.push(event);
    expect(sdk.create.mock.calls[0][0].text.format).toEqual({ type: "json_schema", strict: true, ...schema });
    expect(sdk.create.mock.calls[0][1].maxRetries).toBe(0);
    expect(output.at(-1)).toMatchObject({ type: "done", text: '{"reply":"Hello","facts":[]}' });
    const usage = { records: (await import("../../../lib/openai/provider")).readOpenAIUsageRecords() };
    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({ ownerKey: "fixture-owner", projectId: "fixture-project", totalTokens: 18 });
  });
  it("rejects incomplete replies instead of presenting them as saved completions", async () => {
    const { createOpenAITextStream } = await import("../../../lib/openai/provider");
    sdk.create.mockResolvedValue((async function* () {
      yield { type: "response.output_text.delta", delta: '{"reply":"An incomplete' };
      yield { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 10, output_tokens: 2 } } };
    })());
    const stream = await createOpenAITextStream({ ownerKey: "fixture-owner", useCase: "story-helper", model: "fixture-model", instructions: "fixture", input: [] });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })()).rejects.toThrow("max_output_tokens");
    expect(sdk.create.mock.calls[0][0].text).toBeUndefined();
    expect(sdk.create.mock.calls[0][1].maxRetries).toBe(0);
  });
});
