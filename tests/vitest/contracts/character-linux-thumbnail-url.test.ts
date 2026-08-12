import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.join(process.cwd(), "app", "app", "components", "CharactersPanel.tsx");
const source = fs.readFileSync(sourcePath, "utf8");

describe("Saved Characters Linux thumbnail URL contract", () => {
  it("routes Linux absolute image paths through the guarded file API", () => {
    expect(source).toContain("OTG_CHARACTER_LINUX_THUMBNAIL_URL_V36BP9");
    expect(source).toContain('raw.startsWith("/api/") || raw.startsWith("/_next/")');
    expect(source).toContain('/^\\/(?:home|opt|var|mnt|srv|tmp|run|data)(?:\\/|$)/.test(raw)');
    expect(source).toContain('return `/api/file?path=${encodeURIComponent(raw)}`;');
  });

  it("uses one canonical URL resolver for completed Saved Characters", () => {
    expect(source).toContain("function otgDisplayImageUrlV36BP8(value: unknown)");
    expect(source).toContain("return otgDisplayImageUrlV36BP6(value);");
    expect(source).toContain("characterDisplayImagePathV36BP8(character)");
  });

  it("keeps API and Next static URLs unchanged", () => {
    expect(source).toContain('if (raw.startsWith("/api/") || raw.startsWith("/_next/")) return raw;');
  });
});
