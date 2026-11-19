import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "",
  getJob: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/paths", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/paths")>();
  return { ...original, get OTG_DATA_ROOT() { return state.root; } };
});
vi.mock("@/lib/h3DirectJobs", () => ({ getH3DirectJob: state.getJob, saveH3DirectJobToGallery: state.save }));
vi.mock("@/lib/gallery", () => ({
  getGallerySourcesForRequest: async (request: NextRequest) => ({
    sources: [{ scope: "user", ownerKey: request.headers.get("x-test-owner"), dir: state.root }],
  }),
}));
vi.mock("@/lib/sessionUser", () => ({
  requireSessionUser: async (request: Request) => ({ admin: request.headers.get("x-test-owner") !== "regular-user" }),
}));
vi.mock("@/lib/ownerKey", () => {
  class SessionInvalidError extends Error {}
  return {
    SessionInvalidError,
    async getOwnerContext(request: NextRequest) {
      const ownerKey = request.headers.get("x-test-owner");
      if (!ownerKey) throw new SessionInvalidError();
      return { ownerKey, username: ownerKey, scope: "user", deviceId: "fixture" };
    },
  };
});

import { GET, POST } from "@/app/api/h3/character-voices/sequence/route";
import type { H3VoiceSequenceDraft } from "@/lib/h3CharacterVoiceSequence";

const id = "h3-direct-9f07d4ef-49d0-45b6-8cdf-999609acb0a0";
const draft: H3VoiceSequenceDraft = {
  cast: [{ characterId: "fixture-darius" }, { characterId: "fixture-raphael" }, { characterId: "fixture-amelia" }],
  prompt: 'Darius whispers, "Two guards."',
  mode: "h3-reference-to-video", recipe: "native",
  durationSeconds: 5, stylePresetId: "none", seed: 420,
};
const { seed: _priorSeed, ...settings } = draft;
const next = { ...settings, prompt: "", openingTakeId: id };

function request(body?: object, owner = "cast-owner", origin = "http://local.test") {
  const headers = new Headers({ origin, "content-type": "application/json" });
  if (owner) headers.set("x-test-owner", owner);
  return new NextRequest("http://local.test/api/h3/character-voices/sequence",
    body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
}

beforeEach(async () => {
  vi.stubEnv("OTG_ENV", "test");
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), "h3-sequence-contract-"));
  state.getJob.mockImplementation(async (owner, asked) => owner === "cast-owner" && asked === id ? ({
    id, status: "completed", outputPath: "/fixture/video.mp4",
    input: { mode: draft.mode, durationSeconds: draft.durationSeconds, seed: draft.seed,
      characterVoices: { bindings: draft.cast } },
  }) : null);
  state.save.mockResolvedValue({ url: "/api/gallery/file?name=accepted.mp4&scope=user" });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  await fs.rm(state.root, { recursive: true, force: true });
});

describe("H3 Character Voices checkpoints", () => {
  it("keeps an interrupted request on reload, then accepts its completed take once", async () => {
    const submission = { requestId: "fixture-request-01", fingerprint: "a".repeat(64) };
    expect((await POST(request({ action: "checkpoint", draft, submission }))).status).toBe(200);
    expect(await (await GET(request())).json()).toMatchObject({ draft, submission, accepted: [] });
    expect(state.save).not.toHaveBeenCalled();

    const payload = { action: "accept", jobId: id, draft, nextDraft: next };
    expect((await POST(request(payload))).status).toBe(200);
    const second = await POST(request(payload));
    expect(await second.json()).toMatchObject({ draft: next, accepted: [{ jobId: id, draft }] });
    const after = await (await GET(request())).json();
    expect(after.submission).toBeUndefined();
    expect(after.activeJobId).toBeUndefined();
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("isolates checkpoints and rejects another owner, a changed cast, or an unready take", async () => {
    await POST(request({ action: "checkpoint", draft, activeJobId: id }));
    expect(await (await GET(request(undefined, "another-owner"))).json()).toMatchObject({ draft: null, accepted: [] });
    const payload = { action: "accept", jobId: id, draft, nextDraft: next };
    expect((await POST(request(payload, "another-owner"))).status).toBe(404);
    expect((await POST(request({ ...payload, draft: { ...draft, cast: [...draft.cast].reverse() } }))).status).toBe(409);
    const backing = await state.getJob("cast-owner", id);
    state.getJob.mockResolvedValue({ ...backing, status: "running" });
    expect((await POST(request(payload))).status).toBe(409);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("requires a session, a same-origin write, and the TEST environment", async () => {
    expect((await GET(request(undefined, ""))).status).toBe(401);
    expect((await GET(request(undefined, "regular-user"))).status).toBe(403);
    expect((await POST(request({ action: "checkpoint", draft }, "cast-owner", "https://untrusted.test"))).status).toBe(403);
    vi.stubEnv("OTG_ENV", "prod");
    expect((await GET(request())).status).toBe(404);
  });
});
