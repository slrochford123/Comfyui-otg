import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: sdk.create };
  },
  toFile: vi.fn(),
}));

let root = "";

const args = () => ({
  ownerKey: "stream-test-owner",
  projectId: "stream-test-project",
  useCase: "story-helper" as const,
  model: "gpt-6.1-sol",
  instructions: "Mock test only",
  input: "Mock input",
  timeoutMs: 10000,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "otg-stream-test-"));
  vi.stubEnv("OTG_DATA_DIR", root);
  vi.stubEnv("OTG_DATA_ROOT", root);
  vi.stubEnv("OPENAI_API_KEY", "fake-test-key-no-network");
  vi.stubEnv("OPENAI_KILL_SWITCH", "false");
  vi.stubEnv("OPENAI_DAILY_USER_COST_LIMIT_USD", "1000");
  vi.stubEnv("OPENAI_DAILY_GLOBAL_COST_LIMIT_USD", "1000");
  vi.stubEnv("OPENAI_RATE_LIMIT_PER_MINUTE", "100");
  sdk.create.mockReset();
  vi.resetModules();
});

afterEach(() => {
  sdk.create.mockReset();
  vi.resetModules();
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("Story Director streaming with mocked OpenAI", () => {
  it("streams deltas, completes, and records usage once", async () => {
    sdk.create.mockResolvedValue((async function* () {
      yield { type: "response.output_text.delta", delta: "Hello" };
      yield { type: "response.output_text.delta", delta: " world" };
      yield {
        type: "response.completed",
        response: {
          output_text: "Hello world",
          usage: {
            input_tokens: 12,
            output_tokens: 4,
            total_tokens: 16,
          },
        },
      };
    })());

    const provider = await import("../../../lib/openai/provider");
    const stream = await provider.createOpenAITextStream(args());

    const events = [];
    for await (const event of stream) events.push(event);

    expect(events).toEqual([
      { type: "delta", delta: "Hello" },
      { type: "delta", delta: " world" },
      {
        type: "done",
        text: "Hello world",
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      },
    ]);

    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(sdk.create.mock.calls[0][0].stream).toBe(true);

    const records = provider.readOpenAIUsageRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ownerKey: "stream-test-owner",
      projectId: "stream-test-project",
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it("accounts for reported usage when OpenAI fails", async () => {
    sdk.create.mockResolvedValue((async function* () {
      yield { type: "response.output_text.delta", delta: "Partial" };
      yield {
        type: "response.failed",
        response: {
          error: { message: "Mock OpenAI failure" },
          usage: {
            input_tokens: 20,
            output_tokens: 5,
            total_tokens: 25,
          },
        },
      };
    })());

    const provider = await import("../../../lib/openai/provider");
    const stream = await provider.createOpenAITextStream(args());

    const consume = async () => {
      for await (const event of stream) void event;
    };

    await expect(consume()).rejects.toThrow("Mock OpenAI failure");

    const records = provider.readOpenAIUsageRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
    });
  });


  it("records usage on an incomplete response", async () => {
    sdk.create.mockResolvedValue((async function* () {
      yield {
        type: "response.output_text.delta",
        delta: "Partial answer",
      };
      yield {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          usage: {
            input_tokens: 30,
            output_tokens: 7,
            total_tokens: 37,
          },
        },
      };
    })());

    const provider = await import("../../../lib/openai/provider");
    const stream = await provider.createOpenAITextStream(args());

    await expect(async () => {
      for await (const event of stream) void event;
    }).rejects.toThrow();

    expect(provider.readOpenAIUsageRecords()).toHaveLength(1);
    expect(provider.readOpenAIUsageRecords()[0]).toMatchObject({
      inputTokens: 30,
      outputTokens: 7,
      totalTokens: 37,
    });
  });

  it("does not start OpenAI when caller already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = await import("../../../lib/openai/provider");

    await expect(
      provider.createOpenAITextStream({
        ...args(),
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    expect(sdk.create).not.toHaveBeenCalled();
    expect(provider.readOpenAIUsageRecords()).toHaveLength(0);
  });

  it("rejects streams ending without completion", async () => {
    sdk.create.mockResolvedValue((async function* () {
      yield {
        type: "response.output_text.delta",
        delta: "Unfinished",
      };
    })());

    const provider = await import("../../../lib/openai/provider");
    const stream = await provider.createOpenAITextStream(args());

    await expect(async () => {
      for await (const event of stream) void event;
    }).rejects.toThrow("stream ended before completion");

    expect(provider.readOpenAIUsageRecords()).toHaveLength(0);
  });


  it("stops delivering text after cancellation during generation", async () => {
    const controller = new AbortController();

    let upstreamSignal: AbortSignal | undefined;

    sdk.create.mockImplementation(
      async (_request: unknown, options: { signal: AbortSignal }) => {
        upstreamSignal = options.signal;

        return (async function* () {
          yield {
            type: "response.output_text.delta",
            delta: "First part",
          };

          // Simulate an event arriving after cancellation.
          yield {
            type: "response.output_text.delta",
            delta: "Should never appear",
          };
        })();
      },
    );

    const provider = await import("../../../lib/openai/provider");

    const stream = await provider.createOpenAITextStream({
      ...args(),
      signal: controller.signal,
    });

    const first = await stream.next();

    expect(first.value).toEqual({
      type: "delta",
      delta: "First part",
    });

    controller.abort();

    expect(upstreamSignal?.aborted).toBe(true);

    // No additional text should reach the caller.
    await expect(stream.next()).rejects.toThrow();

    // No completed response or reported usage was received.
    expect(provider.readOpenAIUsageRecords()).toHaveLength(0);
  });

  it("blocks streaming when the OpenAI kill switch is on", async () => {
    vi.stubEnv("OPENAI_KILL_SWITCH", "true");

    const provider = await import("../../../lib/openai/provider");

    await expect(
      provider.createOpenAITextStream(args()),
    ).rejects.toThrow();

    expect(sdk.create).not.toHaveBeenCalled();
    expect(provider.readOpenAIUsageRecords()).toHaveLength(0);
  });
});
