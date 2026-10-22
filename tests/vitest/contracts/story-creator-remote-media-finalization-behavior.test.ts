import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  publishLocalProtectedMedia,
  retrieveRemoteComfyMedia,
} from "../../../lib/storyCreator/remoteComfyMedia";

const roots: string[] = [];
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("phase9-fixture"),
]);
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom"),
  Buffer.from("phase9-video-fixture"),
]);

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "otg-remote-media-"));
  roots.push(value);
  return value;
}

afterEach(() => {
  roots.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true }));
});

describe("Story Creator protected remote media finalization", () => {
  it("retrieves a trusted remote image atomically and reuses duplicate finalization", async () => {
    const storageRoot = root();
    const destinationPath = path.join(storageRoot, "owner", "project", "version.png");
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const input = {
      baseUrl: "http://192.168.1.113:8188",
      trustedBaseUrls: ["http://192.168.1.113:8188"],
      file: { filename: "image.png", subfolder: "safe/folder", type: "temp" },
      storageRoot,
      destinationPath,
      kind: "image" as const,
      fetcher,
    };
    const first = await retrieveRemoteComfyMedia(input);
    const second = await retrieveRemoteComfyMedia(input);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(calls).toBe(1);
    expect(fs.readFileSync(destinationPath)).toEqual(png);
    expect((fs.statSync(destinationPath).mode & 0o777)).toBe(0o600);
  });

  it("rejects untrusted hosts, traversal, missing outputs, and invalid contents", async () => {
    const storageRoot = root();
    const destinationPath = path.join(storageRoot, "version.png");
    const goodFetch = (async () => new Response(png)) as typeof fetch;
    await expect(retrieveRemoteComfyMedia({
      baseUrl: "http://evil.invalid:8188",
      trustedBaseUrls: ["http://192.168.1.113:8188"],
      file: { filename: "image.png" }, storageRoot, destinationPath, kind: "image", fetcher: goodFetch,
    })).rejects.toThrow(/trusted backend registry/);
    await expect(retrieveRemoteComfyMedia({
      baseUrl: "http://192.168.1.113:8188",
      trustedBaseUrls: ["http://192.168.1.113:8188"],
      file: { filename: "../image.png" }, storageRoot, destinationPath, kind: "image", fetcher: goodFetch,
    })).rejects.toThrow(/filename is invalid/);
    await expect(retrieveRemoteComfyMedia({
      baseUrl: "http://192.168.1.113:8188",
      trustedBaseUrls: ["http://192.168.1.113:8188"],
      file: { filename: "missing.png" }, storageRoot, destinationPath, kind: "image",
      fetcher: (async () => new Response("missing", { status: 404 })) as typeof fetch,
    })).rejects.toThrow(/HTTP 404/);
    await expect(retrieveRemoteComfyMedia({
      baseUrl: "http://192.168.1.113:8188",
      trustedBaseUrls: ["http://192.168.1.113:8188"],
      file: { filename: "fake.png" }, storageRoot, destinationPath, kind: "image",
      fetcher: (async () => new Response("not an image")) as typeof fetch,
    })).rejects.toThrow(/not a valid supported image/);
  });

  it("validates video contents and preserves the recorded hash for a local recovery", async () => {
    const storageRoot = root();
    const remotePath = path.join(storageRoot, "remote.mp4");
    const remote = await retrieveRemoteComfyMedia({
      baseUrl: "http://100.75.162.64:8188",
      trustedBaseUrls: ["http://100.75.162.64:8188"],
      file: { filename: "clip.mp4", type: "output" },
      storageRoot,
      destinationPath: remotePath,
      kind: "video",
      fetcher: (async () => new Response(mp4)) as typeof fetch,
    });
    const recovered = await publishLocalProtectedMedia({
      sourcePath: remote.filePath,
      storageRoot,
      destinationPath: path.join(storageRoot, "recovered", "clip.mp4"),
      kind: "video",
      expectedSha256: remote.sha256,
    });
    expect(recovered.sha256).toBe(remote.sha256);
    expect(fs.readFileSync(recovered.filePath)).toEqual(mp4);
  });
});
