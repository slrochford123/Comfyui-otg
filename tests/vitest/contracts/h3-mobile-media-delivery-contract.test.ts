import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("mobile media delivery", () => {
  it("serves H3 downloads as named attachments", () => {
    const route = read("app/api/h3/generation/media/route.ts");
    expect(route).toContain('req.nextUrl.searchParams.get("download") === "1"');
    expect(route).toMatch(/mediaFileResponse[\s\S]*download:/);
  });

  it("shows a generated Gallery thumbnail on the completed H3 player", () => {
    const jobs = read("lib/h3DirectJobs.ts");
    const panel = read("app/app/components/H3Panel.tsx");
    expect(jobs).toContain("thumbnailUrl:");
    expect(jobs).toContain("/api/thumb?collection=gallery");
    expect(panel).toContain("poster={job.thumbnailUrl || undefined}");
  });

  it("uses a real attachment navigation for Gallery downloads", () => {
    const app = read("app/app/AppPageClient.tsx");
    expect(app).toContain("window.location.assign(downloadUrl)");
    expect(app).not.toMatch(/handleGalleryDownload[\s\S]{0,600}document\.createElement\(["']a["']\)/);
  });
});
