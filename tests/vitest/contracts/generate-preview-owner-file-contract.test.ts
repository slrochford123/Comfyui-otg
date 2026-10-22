import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contentLast = readFileSync("app/api/content/last/route.ts", "utf8");
const previewFile = readFileSync("app/api/preview/file/route.ts", "utf8");

describe("Generate latest preview owner file contract", () => {
  it("serves the same owner preview directory that /api/content/last writes", () => {
    expect(contentLast).toContain("getOwnerDirs(owner.ownerKey)");
    expect(contentLast).toContain("copyToLatest(sourceFull, dirs.preview)");
    expect(contentLast).toContain('url: `/api/preview/file?name=${encodeURIComponent(copied.name)}`');

    expect(previewFile).toContain('import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey"');
    expect(previewFile).toContain('import { getOwnerDirs } from "@/lib/paths"');
    expect(previewFile).toContain("function previewRootsForOwner(ownerKey: string)");
    expect(previewFile).toContain("const dirs = getOwnerDirs(ownerKey || \"local\")");
    expect(previewFile).toContain("const roots = previewRootsForOwner(owner.ownerKey)");
    expect(previewFile).toContain("const direct = await newestFile(directCandidates)");
    expect(previewFile).toContain("isInsideRoot(root, decoded)");
  });
});
