import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { receiveMediaUpload } from "@/lib/streamingUpload";
import { requireStorageHeadroom } from "@/lib/storageAdmission";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-upload-")); roots.push(root); return root; };
const request = (parts: Array<[string, string | Blob]>) => {
  const form = new FormData(); for (const [key, value] of parts) typeof value === "string" ? form.append(key, value) : form.append(key, value, "clip.wav");
  return new Request("http://localhost/upload", { method: "POST", body: form });
};
describe("streaming private media uploads", () => {
  it("streams bytes and fields, and removes only its staging file after import", async () => {
    const root = temp(); fs.writeFileSync(path.join(root, "keep.txt"), "existing");
    const upload = await receiveMediaUpload(request([["session", "owned-session"], ["file", new Blob(["sound"])] ]), root, 100);
    expect(upload.fields.session).toBe("owned-session"); expect(fs.readFileSync(upload.file, "utf8")).toBe("sound");
    expect(fs.statSync(upload.file).mode & 0o777).toBe(0o600);
    await upload.cleanup(); expect(fs.readdirSync(root)).toEqual(["keep.txt"]);
  });
  it("rejects an actually oversized stream even without Content-Length", async () => {
    const root = temp();
    await expect(receiveMediaUpload(request([["session", "x"], ["file", new Blob(["x".repeat(200)])]]), root, 100)).rejects.toMatchObject({status:413});
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it("rejects duplicate files or fields without leaving partial files", async () => {
    const root = temp();
    for (const parts of [
      [["session", "a"], ["session", "b"], ["file", new Blob(["audio"])]],
      [["session", "a"], ["file", new Blob(["one"])], ["file", new Blob(["two"])]],
    ] as Array<Array<[string, string | Blob]>>) {
      await expect(receiveMediaUpload(request(parts), root, 100)).rejects.toThrow();
      expect(fs.readdirSync(root)).toEqual([]);
    }
  });
  it("denies insufficient disk space before a file is written", async () => {
    const root = temp(); vi.spyOn(fs, "statfsSync").mockReturnValue({bavail:10,bsize:4096} as fs.StatsFs);
    expect(() => requireStorageHeadroom(root)).toThrow("free storage");
    await expect(receiveMediaUpload(request([["session", "a"], ["file", new Blob(["audio"])]]), root, 100)).rejects.toMatchObject({status:507});
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
