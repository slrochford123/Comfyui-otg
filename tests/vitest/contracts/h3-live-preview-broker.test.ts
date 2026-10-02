import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as getH3PreviewEvents } from "@/app/api/h3/generation/events/route";
import {
  decodeH3PreviewWithoutMetadata,
  decodeH3PreviewWithMetadata,
  decodeKJPreviewOverrideEvent,
  getH3PreviewFrame,
  resetH3PreviewBrokerForTests,
  seedH3PreviewFrameForTests,
  shouldPublishKJPreviewFrame,
  subscribeH3Preview,
} from "@/lib/h3PreviewBroker";
import { buildH3PromptSubmissionBody } from "@/lib/production/h3Comfy";

const graph = {
  "1": { class_type: "TestNode", inputs: {} },
};
const originalPreviewFlag = process.env.H3_LIVE_PREVIEW_ENABLED;

afterEach(() => {
  resetH3PreviewBrokerForTests();
  if (originalPreviewFlag === undefined) delete process.env.H3_LIVE_PREVIEW_ENABLED;
  else process.env.H3_LIVE_PREVIEW_ENABLED = originalPreviewFlag;
});

describe("H3 live preview broker isolation", () => {
  it("preserves the existing H3 submission body when preview is disabled", () => {
    expect(buildH3PromptSubmissionBody({ graph, clientId: "client-a" })).toEqual({
      prompt: graph,
      client_id: "client-a",
    });
  });

  it("requests core Latent2RGB only for an eligible live-preview H3 session", () => {
    expect(buildH3PromptSubmissionBody({
      graph,
      clientId: "client-a",
      livePreviewEnabled: true,
    })).toEqual({
      prompt: graph,
      client_id: "client-a",
      extra_data: { preview_method: "latent2rgb" },
    });
  });

  it("preserves existing extra_data while selecting Latent2RGB", () => {
    expect(buildH3PromptSubmissionBody({
      graph,
      clientId: "client-a",
      extraData: { workflow_id: "workflow-a", preview_method: "taesd" },
      livePreviewEnabled: true,
    }).extra_data).toEqual({
      workflow_id: "workflow-a",
      preview_method: "latent2rgb",
    });
  });

  it("does not add H3 preview settings for unrelated callers", () => {
    expect(buildH3PromptSubmissionBody({
      graph,
      clientId: "woosh-client",
      extraData: { workflow_id: "woosh-workflow" },
    }).extra_data).toEqual({ workflow_id: "woosh-workflow" });
  });

  it("ignores malformed optional preview state without breaking generation", () => {
    expect(buildH3PromptSubmissionBody({
      graph,
      clientId: "client-a",
      extraData: ["not", "an", "object"],
      livePreviewEnabled: "true",
    })).toEqual({
      prompt: graph,
      client_id: "client-a",
    });
  });

  it("decodes prompt metadata carried by modern ComfyUI preview frames", () => {
    const metadata = Buffer.from(JSON.stringify({ prompt_id: "prompt-a", image_type: "image/jpeg" }));
    const image = Buffer.from([0xff, 0xd8, 0xff]);
    const payload = Buffer.alloc(8 + metadata.length + image.length);
    payload.writeUInt32BE(4, 0);
    payload.writeUInt32BE(metadata.length, 4);
    metadata.copy(payload, 8);
    image.copy(payload, 8 + metadata.length);
    const decoded = decodeH3PreviewWithMetadata(payload);
    expect(decoded?.promptId).toBe("prompt-a");
    expect(decoded?.contentType).toBe("image/jpeg");
    expect(decoded?.bytes).toEqual(image);
  });

  it("decodes animated WebP preview media from the preview node", () => {
    const metadata = Buffer.from(JSON.stringify({ prompt_id: "prompt-a", image_type: "image/webp" }));
    const webp = Buffer.from("RIFFxxxxWEBPVP8 ", "ascii");
    const payload = Buffer.alloc(8 + metadata.length + webp.length);
    payload.writeUInt32BE(4, 0);
    payload.writeUInt32BE(metadata.length, 4);
    metadata.copy(payload, 8);
    webp.copy(payload, 8 + metadata.length);
    const decoded = decodeH3PreviewWithMetadata(payload);
    expect(decoded?.promptId).toBe("prompt-a");
    expect(decoded?.contentType).toBe("image/webp");
    expect(decoded?.bytes).toEqual(webp);
  });

  it("sniffs animated WebP preview media when Comfy omits metadata", () => {
    const webp = Buffer.from("RIFFxxxxWEBPVP8 ", "ascii");
    const payload = Buffer.alloc(8 + webp.length);
    payload.writeUInt32BE(1, 0);
    payload.writeUInt32BE(1, 4);
    webp.copy(payload, 8);
    const decoded = decodeH3PreviewWithoutMetadata(payload, "prompt-a");
    expect(decoded?.promptId).toBe("prompt-a");
    expect(decoded?.contentType).toBe("image/webp");
    expect(decoded?.bytes).toEqual(webp);
  });

  it("decodes animated preview-node events from KJNodes", () => {
    const webp = Buffer.from("RIFFxxxxWEBPVP8 ", "ascii");
    const decoded = decodeKJPreviewOverrideEvent({
      image: webp.toString("base64"),
      mime: "image/webp",
      node_id: "164",
      step: 4,
      total: 8,
    }, "prompt-a");
    expect(decoded?.promptId).toBe("prompt-a");
    expect(decoded?.contentType).toBe("image/webp");
    expect(decoded?.bytes).toEqual(webp);
    expect(decoded?.progress).toEqual({ value: 4, max: 8, node: "164" });
  });

  it("waits past the preview node's initial still when an animated preview is expected", () => {
    const jpeg = decodeKJPreviewOverrideEvent({
      image: Buffer.from([0xff, 0xd8, 0xff]).toString("base64"),
      node_id: "164",
      step: 0,
      total: 8,
    }, "prompt-a");
    const mp4 = decodeKJPreviewOverrideEvent({
      image: Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]).toString("base64"),
      mime: "video/mp4",
      node_id: "164",
      step: 1,
      total: 8,
    }, "prompt-a");
    expect(jpeg?.contentType).toBe("image/jpeg");
    expect(shouldPublishKJPreviewFrame(jpeg)).toBe(false);
    expect(mp4?.contentType).toBe("video/mp4");
    expect(shouldPublishKJPreviewFrame(mp4)).toBe(true);
  });

  it("includes preview media type in browser event stream updates", async () => {
    process.env.H3_LIVE_PREVIEW_ENABLED = "1";
    seedH3PreviewFrameForTests({
      jobId: "webp-job",
      ownerKey: "local",
      backend: "rtx3090",
      promptId: "webp-prompt",
      bytes: Buffer.from("RIFFxxxxWEBPVP8 ", "ascii"),
      contentType: "image/webp",
    });
    const request = new NextRequest("http://localhost/api/h3/generation/events?jobId=webp-job");
    const response = await getH3PreviewEvents(request);
    const reader = response.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain("event: preview");
    expect(chunk).toContain('"contentType":"image/webp"');
    await reader.cancel();
  });

  it("decodes ordinary ComfyUI preview frames on a prompt-bound websocket", () => {
    const image = Buffer.from([0xff, 0xd8, 0xff]);
    const payload = Buffer.alloc(8 + image.length);
    payload.writeUInt32BE(1, 0);
    payload.writeUInt32BE(1, 4);
    image.copy(payload, 8);
    const decoded = decodeH3PreviewWithoutMetadata(payload, "prompt-a");
    expect(decoded?.promptId).toBe("prompt-a");
    expect(decoded?.contentType).toBe("image/jpeg");
    expect(decoded?.bytes).toEqual(image);
  });

  it("never exposes a frame or subscription across owners", () => {
    seedH3PreviewFrameForTests({
      jobId: "job-a",
      ownerKey: "owner-a",
      backend: "rtx5060ti",
      promptId: "prompt-a",
    });
    expect(getH3PreviewFrame("job-a", "owner-b")).toBeNull();
    expect(subscribeH3Preview("job-a", "owner-b", vi.fn())).toBeNull();
    expect(getH3PreviewFrame("job-a", "owner-a")?.promptId).toBe("prompt-a");
  });

  it("keeps jobs and backends independently addressable", () => {
    seedH3PreviewFrameForTests({ jobId: "job-3090", ownerKey: "owner", backend: "rtx3090", promptId: "prompt-3090" });
    seedH3PreviewFrameForTests({ jobId: "job-5060", ownerKey: "owner", backend: "rtx5060ti", promptId: "prompt-5060" });
    expect(getH3PreviewFrame("job-3090", "owner")?.promptId).toBe("prompt-3090");
    expect(getH3PreviewFrame("job-5060", "owner")?.promptId).toBe("prompt-5060");
  });

  it("keeps an early browser event stream open until the broker session is ready", async () => {
    process.env.H3_LIVE_PREVIEW_ENABLED = "1";
    const request = new NextRequest("http://localhost/api/h3/generation/events?jobId=late-session-job");
    const response = await getH3PreviewEvents(request);
    const reader = response.body!.getReader();
    const pending = reader.read();

    seedH3PreviewFrameForTests({
      jobId: "late-session-job",
      ownerKey: "local",
      backend: "rtx3090",
      promptId: "late-session-prompt",
    });

    const chunk = new TextDecoder().decode((await pending).value);
    expect(chunk).toContain("event: preview");
    expect(chunk).toContain('"version":1');
    await reader.cancel();
  });
});
