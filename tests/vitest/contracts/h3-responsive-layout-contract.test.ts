import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app/app/components/H3Panel.tsx"),
  "utf8",
);

describe("H3 responsive media and text containment", () => {
  it("keeps the complete H3 workspace inside the mobile viewport", () => {
    expect(source).toContain(
      'className="mx-auto w-full min-w-0 max-w-7xl space-y-4 overflow-x-clip',
    );
    expect(source).toContain(
      'className="grid min-w-0 max-w-full gap-4 xl:grid-cols-',
    );
    expect(source).toContain(
      'className="min-w-0 max-w-full space-y-4"',
    );
  });

  it("contains portrait, landscape, square, and completed video media without cropping", () => {
    expect(source.match(/block aspect-video h-auto w-full min-w-0 max-w-full/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain("bg-black object-contain");
    expect(source).toContain(
      'className="block h-auto max-h-[70vh] w-full min-w-0 max-w-full rounded-[6px] bg-black object-contain"',
    );
    expect(source).not.toContain("object-cover");
  });

  it("wraps long filenames, prompts, job IDs, and reference values", () => {
    expect(source).toContain("whitespace-normal break-all text-xs");
    expect(source).toContain("break-all text-right text-xs");
    expect(source).toContain("whitespace-pre-wrap break-words [overflow-wrap:anywhere]");
    expect(source).toContain("[overflow-wrap:anywhere] outline-none");
  });

  it("prevents native audio controls from widening reference cards", () => {
    expect(source).toContain(
      'className="block w-full min-w-0 max-w-full"',
    );
  });

  it("reserves a visible H3 live-preview box while waiting for the first frame", () => {
    expect(source).toContain("Waiting for the first live preview frame from ComfyUI");
    expect(source).toContain('aria-label="Waiting for first H3 live preview frame"');
    expect(source).toContain("active ? (");
  });
});
