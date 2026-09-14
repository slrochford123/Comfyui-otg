import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  H3_MEDIA_ACCEPT,
  isAcceptedH3MediaFile,
  supportedH3MediaExtensions,
  type H3InputMediaKind,
} from "../../../lib/h3MediaTypes";

const accepted: Record<H3InputMediaKind, Array<[string, string]>> = {
  image: [
    ["photo.jpeg", "image/jpeg"],
    ["plate.tiff", "image/tiff"],
    ["phone.heic", "image/heic"],
    ["frame.avif", "image/avif"],
    ["scan.bmp", "application/octet-stream"],
  ],
  video: [
    ["clip.mp4", "video/mp4"],
    ["camera.mkv", "video/x-matroska"],
    ["capture.avi", "video/x-msvideo"],
    ["phone.m2ts", "application/octet-stream"],
    ["archive.mxf", "video/mxf"],
  ],
  audio: [
    ["voice.wav", "audio/wav"],
    ["music.flac", "audio/flac"],
    ["take.m4a", "audio/mp4"],
    ["speech.opus", "audio/ogg"],
    ["legacy.aiff", "application/octet-stream"],
  ],
};

describe("H3 broad media input contract", () => {
  it("accepts common and professional image, video, and audio formats", () => {
    for (const kind of ["image", "video", "audio"] as const) {
      for (const [name, type] of accepted[kind]) {
        expect(isAcceptedH3MediaFile(kind, { name, type }), `${kind}: ${name}`).toBe(true);
      }
    }
  });

  it("uses extensions when mobile browsers report generic MIME types", () => {
    expect(isAcceptedH3MediaFile("image", { name: "camera.heif", type: "" })).toBe(true);
    expect(isAcceptedH3MediaFile("video", { name: "camera.mov", type: "application/octet-stream" })).toBe(true);
    expect(isAcceptedH3MediaFile("audio", { name: "voice.caf", type: "binary/octet-stream" })).toBe(true);
  });

  it("keeps media categories separate and rejects non-media files", () => {
    expect(isAcceptedH3MediaFile("image", { name: "clip.mp4", type: "video/mp4" })).toBe(false);
    expect(isAcceptedH3MediaFile("audio", { name: "photo.png", type: "image/png" })).toBe(false);
    expect(isAcceptedH3MediaFile("video", { name: "notes.pdf", type: "application/pdf" })).toBe(false);
    expect(isAcceptedH3MediaFile("image", { name: "payload.exe", type: "application/octet-stream" })).toBe(false);
  });

  it("publishes explicit browser accept filters for every H3 media category", () => {
    expect(H3_MEDIA_ACCEPT.image).toContain("image/*");
    expect(H3_MEDIA_ACCEPT.video).toContain("video/*");
    expect(H3_MEDIA_ACCEPT.audio).toContain("audio/*");
    for (const kind of ["image", "video", "audio"] as const) {
      for (const extension of supportedH3MediaExtensions(kind)) {
        expect(H3_MEDIA_ACCEPT[kind]).toContain(extension);
      }
    }
  });

  it("normalizes every accepted image to an orientation-corrected PNG before ComfyUI upload", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "app/api/h3/generation/route.ts"), "utf8");
    expect(route).toContain('category === "image"');
    expect(route).toContain('await sharp(bytes, { animated: false, failOn: "error", limitInputPixels: false })');
    expect(route).toContain(".rotate()");
    expect(route).toContain(".png()");
  });
});
