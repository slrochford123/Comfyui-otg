import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const source = fs.readFileSync(
  path.join(root, "app/app/components/SpinDialNav.tsx"),
  "utf8",
);

describe("Story Creator bottom navigation label contract", () => {
  it("keeps the internal machine tab id while displaying Story Creator", () => {
    expect(source).toContain(
      '{ id: "machine", label: "Story Creator" },',
    );

    expect(source).not.toContain(
      '{ id: "machine", label: "Machine" },',
    );
  });
});
