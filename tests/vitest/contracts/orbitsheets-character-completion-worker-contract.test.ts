import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const worker = readFileSync(
  resolve(
    process.cwd(),
    "scripts/linux/otg-character-completion-worker-orbitsheets-test.py",
  ),
  "utf8",
);

describe("OrbitSheets TEST Character Completion Worker", () => {
  it("uses the dedicated OrbitSheets Character Card API", () => {
    expect(worker).toContain(
      "/api/characters/orbitsheets-card",
    );
    expect(worker).toContain(
      "sourceServerPath",
    );
    expect(worker).toContain(
      "characterDescription",
    );
  });

  it("uses the processed source path as the OrbitSheets input", () => {
    expect(worker).toContain(
      '"sourceServerPath": source_image_path',
    );
  });

  it("persists the final OrbitSheets card into durable character storage", () => {
    expect(worker).toContain(
      "durableCharacterCard",
    );
    expect(worker).toContain(
      "upload_card(",
    );
    expect(worker).toContain(
      '"cardImagePath": card_path',
    );
  });

  it("prefers the local OrbitSheets H3 output over the generic Comfy image proxy", () => {
    expect(worker).toContain(
      'orbit_server_path = clean(',
    );
    expect(worker).toContain(
      'os.path.isfile(orbit_server_path)',
    );
    expect(worker).toContain(
      'card_bytes = Path(',
    );
    expect(worker).toContain(
      'orbit_server_path',
    );
    expect(worker).toContain(
      ').read_bytes()',
    );
    expect(worker).toContain(
      'upload_character_asset_bytes(',
    );
    expect(worker).toContain(
      '"copyMode": "local-server-path"',
    );
  });

  it("keeps the legacy pipeline as a deterministic fallback", () => {
    expect(worker).toContain(
      "legacy-fallback",
    );
    expect(worker).toContain(
      "OrbitSheets unavailable. Falling back",
    );
  });

  it("does not replace the full-body default image with the card", () => {
    expect(worker).toContain(
      "persist_character(",
    );
    expect(worker).toContain(
      "sourceImagePath",
    );
  });
});
