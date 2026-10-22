import { describe, expect, it, vi } from "vitest";
import { readStoryDirectorStream } from "../../../app/app/components/storyDirectorStream";

const encoder = new TextEncoder();

function responseFromChunks(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}

describe("Story Director browser streaming parser", () => {
  it("displays deltas progressively before completion", async () => {
    let emit!: (text: string) => void;
    let finish!: () => void;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        emit = (text) => controller.enqueue(encoder.encode(text));
        finish = () => controller.close();
      },
    });

    const updates: string[] = [];

    const task = readStoryDirectorStream(
      new Response(stream),
      (text) => updates.push(text),
    );

    emit('{"type":"delta","delta":"Hello"}\n');

    await vi.waitFor(() => {
      expect(updates).toContain("Hello");
    });

    emit('{"type":"delta","delta":" world"}\n');
    emit('{"type":"done","text":"Hello world"}\n');
    finish();

    expect(await task).toBe("Hello world");
    expect(updates).toEqual([
      "Hello",
      "Hello world",
      "Hello world",
    ]);
  });

  it("handles Unicode characters split across network chunks", async () => {
    const data = encoder.encode(
      '{"type":"delta","delta":"Hi 🌟"}\n' +
      '{"type":"done","text":"Hi 🌟"}\n',
    );

    const chunks: Uint8Array[] = [];
    for (let i = 0; i < data.length; i += 2) {
      chunks.push(data.slice(i, i + 2));
    }

    const updates: string[] = [];

    const result = await readStoryDirectorStream(
      responseFromChunks(chunks),
      (text) => updates.push(text),
    );

    expect(result).toBe("Hi 🌟");
    expect(updates).toEqual(["Hi 🌟", "Hi 🌟"]);
  });

  it("rejects streamed errors instead of treating partial text as complete", async () => {
    const updates: string[] = [];

    const response = responseFromChunks([
      encoder.encode(
        '{"type":"delta","delta":"Partial"}\n' +
        '{"type":"error","error":"Mock failure"}\n',
      ),
    ]);

    await expect(
      readStoryDirectorStream(response, (text) => updates.push(text)),
    ).rejects.toThrow("Mock failure");

    expect(updates).toEqual(["Partial"]);
  });

  it("rejects connections that end without a done event", async () => {
    const response = responseFromChunks([
      encoder.encode('{"type":"delta","delta":"Unfinished"}\n'),
    ]);

    await expect(
      readStoryDirectorStream(response, () => {}),
    ).rejects.toThrow("stream ended before completion");
  });
});
