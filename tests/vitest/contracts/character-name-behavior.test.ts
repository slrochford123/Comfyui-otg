import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  vi.resetModules();
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
  delete process.env.OTG_DATA_DIR;
  delete process.env.OTG_DATA_ROOT;
});

describe("Character save safeguards", () => {
  it("requires a name, normalizes spacing, and rejects duplicate names per owner", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-name-") );
    tempRoots.push(root);
    process.env.OTG_DATA_DIR = root;
    process.env.OTG_DATA_ROOT = root;
    vi.resetModules();

    const store = await import("../../../lib/characters/store");
    expect(() => store.createCharacter("owner-a", { id: "blank", name: " ", imagePath: "/tmp/a.png" }))
      .toThrowError(/name is required/i);

    const first = store.createCharacter("owner-a", {
      id: "first",
      name: "  Nova   Pilot  ",
      imagePath: "/tmp/a.png",
    });
    expect(first.name).toBe("Nova Pilot");

    expect(() => store.createCharacter("owner-a", {
      id: "second",
      name: "nova pilot",
      imagePath: "/tmp/b.png",
    })).toThrowError(/already exists/i);

    const otherOwner = store.createCharacter("owner-b", {
      id: "same-name",
      name: "Nova Pilot",
      imagePath: "/tmp/c.png",
    });
    expect(otherOwner.name).toBe("Nova Pilot");
  });
});
