import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claimCharacterCompletionJob,
  clearCharacterCompletionJobsForTests,
  createCharacterCompletionJob,
  setCharacterCompletionStorePathForTests,
} from "@/lib/jobs/characterCompletionJobs";

const worker = readFileSync(
  resolve(
    process.cwd(),
    "scripts/linux/otg-character-completion-worker-orbitsheets-test.py",
  ),
  "utf8",
);

const completionRoute = readFileSync(
  resolve(process.cwd(), "app/api/characters/completion/route.ts"),
  "utf8",
);

const testActivationScript = readFileSync(
  resolve(process.cwd(), "scripts/activate-h3-b02-preview-test.sh"),
  "utf8",
);

describe("Qwen Image Edit 2.1 TEST Character Completion Worker", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "otg-character-completion-"));
    setCharacterCompletionStorePathForTests(resolve(tempDir, "jobs.json"));
  });

  afterEach(() => {
    clearCharacterCompletionJobsForTests();
    setCharacterCompletionStorePathForTests(null);
    if (tempDir) rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  });

  it("uses the dedicated Character Card API", () => {
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

  it("uses the processed source path as the Qwen input", () => {
    expect(worker).toContain(
      '"sourceServerPath": source_image_path',
    );
  });

  it("persists the final Qwen card into durable character storage", () => {
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

  it("prefers the local Qwen output over the generic Comfy image proxy", () => {
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
      "Qwen Image Edit 2.1 unavailable. Falling back",
    );
    expect(worker).toContain(
      '"characterCardEngine": "qwen-image-edit-2.1"',
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

  it("claims the newest queued Character Card job before stale queued work", () => {
    const oldJob = createCharacterCompletionJob("owner", {
      characterId: "old-character",
      characterName: "Old",
      sourceImagePath: "/tmp/old.png",
      expression: "neutral",
    });
    expect(oldJob.ok).toBe(true);

    const newJob = createCharacterCompletionJob("owner", {
      characterId: "new-character",
      characterName: "New",
      sourceImagePath: "/tmp/new.png",
      expression: "happy",
    });
    expect(newJob.ok).toBe(true);

    const claimed = claimCharacterCompletionJob("test-worker");
    expect(claimed?.characterId).toBe("new-character");
    expect(claimed?.input.expression).toBe("happy");
  });

  it("fails fast when the control-plane worker token is missing", () => {
    expect(completionRoute).toContain("expectedWorkerToken()");
    expect(completionRoute).toContain("Character Card Worker Manager token is not configured");
    expect(completionRoute).toContain("503");
  });

  it("packages runtime config files needed by Comfy routing into TEST releases", () => {
    expect(testActivationScript).toContain("comfy_workflows config scripts");
    expect(testActivationScript).toContain('rsync -a --delete "$REPO_DIR/$item/" "$release/$item/"');
  });
});
