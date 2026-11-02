import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeStorySpeechText } from "../../../lib/storyCreator/speechText";
const cpu = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/storyCreator/cpuClient", () => ({
  callStoryCpu: cpu.call, storyCpuAvailable: () => true, storyCpuRoot: () => process.env.STORY_CREATOR_CPU_ROOT,
}));
let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "story-local-speech-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_DATA_ROOT", root); vi.stubEnv("STORY_CREATOR_CPU_ROOT", root);
  fs.writeFileSync(path.join(root, "qualified.json"), JSON.stringify({ kokoro: true, bark: true, transcription: true }));
  cpu.call.mockReset(); vi.resetModules();
  cpu.call.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/health") return { ok: true, busy: false };
    const audio = Buffer.alloc(1644);
    audio.write("RIFF", 0); audio.write("WAVE", 8);
    return { ok: true, audio: audio.toString("base64"), durationSeconds: 0.5 };
  });
});
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
async function setup() {
  const store = await import("../../../lib/storyCreator/store");
  const speech = await import("../../../lib/storyCreator/speech");
  const project = store.createStoryCreatorProject({ ownerKey: "speech-owner", title: "Read-aloud story" });
  const scope = { ownerKey: project.ownerKey, projectId: project.id };
  const message = store.addStoryCreatorMessage({ ...scope, role: "assistant", content: "Mara opens the café door." });
  const input = { ...scope, messageId: message.id, engine: "kokoro" as const, voice: "female" as const };
  return { store, speech, scope, input };
}

describe("owner-scoped local assistant speech", () => {
  it("independently caches all four Paradee voices without accepting legacy voice aliases", async () => {
    const { speech, input, store } = await setup();
    fs.writeFileSync(path.join(root, "qualified.json"), JSON.stringify({ paradee: true, kokoro: true, bark: true }));
    expect(speech.storySpeechCapabilities().defaultEngine).toBe("paradee");
    const ids = new Set();
    for (const voice of ["af_heart", "am_puck", "bf_isabella", "bm_fable"] as const) {
      const selection = { ...input, engine: "paradee" as const, voice };
      const { job } = speech.prepareStorySpeech(selection); ids.add(job.id);
      await speech.enqueueStorySpeech({ ...selection, jobId: job.id });
      expect(store.getStorySpeechJob({ ...selection, jobId: job.id })?.status).toBe("completed");
      expect(speech.prepareStorySpeech(selection).job.id).toBe(job.id);
    }
    expect(ids.size).toBe(4);
    expect(() => speech.prepareStorySpeech({ ...input, engine: "paradee" })).toThrow("Unsupported local voice");
    expect(() => speech.prepareStorySpeech({ ...input, voice: "af_heart" })).toThrow("Unsupported local voice");
    expect(cpu.call.mock.calls.filter(([endpoint]) => endpoint === "/tts")).toHaveLength(4);
  });
  it("deduplicates speech, persists an actual returned waveform, and replays cache without inference", async () => {
    const { store, speech, input } = await setup();
    const first = speech.prepareStorySpeech(input);
    expect(speech.prepareStorySpeech(input).created).toBe(false);
    await speech.enqueueStorySpeech({ ...input, jobId: first.job.id });
    expect(store.getStorySpeechJob({ ...input, jobId: first.job.id })?.status).toBe("completed");
    expect(fs.existsSync(speech.storySpeechPath({ ...input, jobId: first.job.id }))).toBe(true);
    expect(speech.prepareStorySpeech(input).created).toBe(false);
    expect(cpu.call.mock.calls.filter(([endpoint]) => endpoint === "/tts")).toHaveLength(1);
    expect(speech.prepareStorySpeech({ ...input, voice: "male" }).job.id).not.toBe(first.job.id);
  });
  it("denies foreign sources and cancels only the selected owner's speech", async () => {
    const { store, speech, input } = await setup();
    expect(() => speech.prepareStorySpeech({ ...input, ownerKey: "different-owner" })).toThrow();
    const { job } = speech.prepareStorySpeech(input);
    store.cancelStorySpeechJob({ ...input, jobId: job.id });
    await speech.enqueueStorySpeech({ ...input, jobId: job.id });
    expect(cpu.call).not.toHaveBeenCalled();
    expect(store.listStoryCreatorMessages(input)).toHaveLength(1);
    expect(store.getStorySpeechJob({ ...input, jobId: job.id })?.status).toBe("cancelled");
  });
  it("recovers a missing cache only on an explicit local retry", async () => {
    const { speech, input } = await setup();
    const { job } = speech.prepareStorySpeech(input);
    await speech.enqueueStorySpeech({ ...input, jobId: job.id });
    fs.unlinkSync(speech.storySpeechPath({ ...input, jobId: job.id }));
    expect(speech.prepareStorySpeech(input).job.status).toBe("failed");
    const retry = speech.prepareStorySpeech({ ...input, retry: true });
    expect(retry.created).toBe(true);
    await speech.enqueueStorySpeech({ ...input, jobId: retry.job.id });
    expect(cpu.call.mock.calls.filter(([endpoint]) => endpoint === "/tts")).toHaveLength(2);
  });
  it("does not expose unqualified engines or silently truncate long Bark replies", async () => {
    const { store, speech, input } = await setup();
    fs.writeFileSync(path.join(root, "qualified.json"), JSON.stringify({ kokoro: true }));
    expect(() => speech.prepareStorySpeech({ ...input, engine: "bark" })).toThrow("not been qualified");
    fs.writeFileSync(path.join(root, "qualified.json"), JSON.stringify({ kokoro: true, bark: true }));
    const message = store.addStoryCreatorMessage({ ...input, role: "assistant", content: "Long reply. ".repeat(80) });
    expect(() => speech.prepareStorySpeech({ ...input, messageId: message.id, engine: "bark" })).toThrow("400 characters");
  });
  it("normalizes markup without paraphrasing numbers, names or dialogue", () => {
    expect(normalizeStorySpeechText('# Mara\n\n**Hello**, Elin. Bring 12 books. [Read](https://example.com)')).toBe("Mara Hello, Elin. Bring 12 books. Read");
  });
  it("applies the same bounded queue to an explicit retry", async () => {
    const { store, speech, input } = await setup();
    const { job } = speech.prepareStorySpeech(input);
    cpu.call.mockRejectedValueOnce(new Error("Offline fixture worker"));
    await speech.enqueueStorySpeech({ ...input, jobId: job.id });
    expect(store.getStorySpeechJob({ ...input, jobId: job.id })?.status).toBe("failed");
    speech.prepareStorySpeech({ ...input, voice: "male" });
    const another = store.addStoryCreatorMessage({ ...input, role: "assistant", content: "A different reply." });
    speech.prepareStorySpeech({ ...input, messageId: another.id });
    expect(() => speech.prepareStorySpeech({ ...input, retry: true })).toThrow("Two speech jobs");
  });
});
