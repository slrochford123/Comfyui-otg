import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import {
  clearProductionAudioStudioResultsForTests,
  getProductionAudioStudioResult,
  getProductionAudioStudioResultsStorePath,
  listProductionAudioStudioResults,
  saveProductionAudioStudioResult,
  setProductionAudioStudioResultsStorePathForTests,
} from "@/lib/jobs/productionAudioStudioResults";

describe("production audio studio result persistence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-production-audio-results-"));

  beforeEach(() => {
    setProductionAudioStudioResultsStorePathForTests(path.join(tempDir, `results-${Date.now()}-${Math.random().toString(16).slice(2)}.json`));
    clearProductionAudioStudioResultsForTests();
  });

  it("creates and retrieves an owner-scoped clip audio result", () => {
    const saved = saveProductionAudioStudioResult("owner-a", {
      clipId: "clip-1",
      audioStudioResult: {
        status: "mock_ready",
        action: "add_voice_to_clip",
        sourceJobId: "pas_job_1",
        updatedClipUrl: "/mock-assets/clips/pas_job_1/voice-added.mp4",
        mockResult: { updatedClipUrl: "/mock-assets/clips/pas_job_1/voice-added.mp4" },
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.item).toMatchObject({
      clipId: "clip-1",
      audioStudioResult: {
        status: "mock_ready",
        action: "add_voice_to_clip",
        sourceJobId: "pas_job_1",
        updatedClipUrl: "/mock-assets/clips/pas_job_1/voice-added.mp4",
      },
    });
    expect(getProductionAudioStudioResult("owner-a", "clip-1")).toEqual(saved.item);
    expect(listProductionAudioStudioResults("owner-a")).toEqual([saved.item]);
    expect(getProductionAudioStudioResult("owner-b", "clip-1")).toBeNull();
    expect(fs.existsSync(getProductionAudioStudioResultsStorePath())).toBe(true);
  });

  it("updates an existing clip audio result", () => {
    const first = saveProductionAudioStudioResult("owner-a", {
      clipId: "clip-1",
      audioStudioResult: {
        status: "mock_ready",
        action: "dub_existing_voice",
        sourceJobId: "pas_job_1",
        dubbedClipUrl: "/mock-assets/clips/pas_job_1/dubbed.mp4",
        mockResult: { dubbedClipUrl: "/mock-assets/clips/pas_job_1/dubbed.mp4" },
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    });
    const second = saveProductionAudioStudioResult("owner-a", {
      clipId: "clip-1",
      audioStudioResult: {
        status: "mock_ready",
        action: "render_audio_mix",
        sourceJobId: "pas_job_2",
        finalClipUrl: "/mock-assets/clips/pas_job_2/final-audio-mix.mp4",
        mockResult: { finalClipUrl: "/mock-assets/clips/pas_job_2/final-audio-mix.mp4" },
        updatedAt: "2026-05-25T00:01:00.000Z",
      },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error);
    expect(listProductionAudioStudioResults("owner-a")).toHaveLength(1);
    expect(getProductionAudioStudioResult("owner-a", "clip-1")).toMatchObject({
      audioStudioResult: {
        action: "render_audio_mix",
        sourceJobId: "pas_job_2",
        finalClipUrl: "/mock-assets/clips/pas_job_2/final-audio-mix.mp4",
      },
    });
  });

  it("rejects invalid input", () => {
    expect(saveProductionAudioStudioResult("owner-a", { audioStudioResult: {} })).toMatchObject({
      ok: false,
      status: 400,
      error: "clipId is required.",
    });
    expect(saveProductionAudioStudioResult("owner-a", { clipId: "clip-1", audioStudioResult: {} })).toMatchObject({
      ok: false,
      status: 400,
      error: "Valid audioStudioResult is required.",
    });
  });

  it("handles missing and corrupt store files safely", () => {
    expect(listProductionAudioStudioResults("owner-a")).toEqual([]);

    fs.mkdirSync(path.dirname(getProductionAudioStudioResultsStorePath()), { recursive: true });
    fs.writeFileSync(getProductionAudioStudioResultsStorePath(), "{not-json", "utf8");

    expect(getProductionAudioStudioResult("owner-a", "clip-1")).toBeNull();
    const saved = saveProductionAudioStudioResult("owner-a", {
      clipId: "clip-1",
      audioStudioResult: {
        status: "mock_ready",
        action: "add_sound_effect",
        sourceJobId: "pas_job_3",
        updatedClipUrl: "/mock-assets/clips/pas_job_3/sfx-added.mp4",
        mockResult: { updatedClipUrl: "/mock-assets/clips/pas_job_3/sfx-added.mp4" },
        updatedAt: "2026-05-25T00:02:00.000Z",
      },
    });
    expect(saved.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(getProductionAudioStudioResultsStorePath(), "utf8")).owners["owner-a"]).toBeTruthy();
  });

  it("returns 400 JSON for invalid route requests and persists valid route requests", async () => {
    process.env.AUTH_SECRET ||= "test-secret-for-production-audio-results-route";
    const route = await import("@/app/api/production/audio-studio/results/route");

    const invalidRequest = new NextRequest("http://localhost/api/production/audio-studio/results", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "owner-a",
      },
      body: JSON.stringify({ audioStudioResult: {} }),
    });
    const invalidResponse = await route.POST(invalidRequest);
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({ ok: false, error: "clipId is required." });

    const validRequest = new NextRequest("http://localhost/api/production/audio-studio/results", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "owner-a",
      },
      body: JSON.stringify({
        clipId: "clip-1",
        audioStudioResult: {
          status: "mock_ready",
          action: "replace_voice",
          sourceJobId: "pas_job_4",
          updatedClipUrl: "/mock-assets/clips/pas_job_4/voice-replaced.mp4",
          mockResult: { updatedClipUrl: "/mock-assets/clips/pas_job_4/voice-replaced.mp4" },
          updatedAt: "2026-05-25T00:03:00.000Z",
        },
      }),
    });
    const validResponse = await route.POST(validRequest);
    expect(validResponse.status).toBe(200);
    await expect(validResponse.json()).resolves.toMatchObject({
      ok: true,
      item: {
        clipId: "clip-1",
        audioStudioResult: {
          action: "replace_voice",
          sourceJobId: "pas_job_4",
        },
      },
    });

    const listRequest = new NextRequest("http://localhost/api/production/audio-studio/results", {
      headers: { "x-otg-device-id": "owner-a" },
    });
    const listResponse = await route.GET(listRequest);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      items: [
        {
          clipId: "clip-1",
          audioStudioResult: {
            action: "replace_voice",
            sourceJobId: "pas_job_4",
          },
        },
      ],
    });
  });
});
