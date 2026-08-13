// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/characters/enhance-description/route.ts",
  ),
  "utf8",
);

describe("Character Description Provider Phase 8d", () => {
  it("uses a dedicated Character model setting", () => {
    expect(route).toContain(
      "OLLAMA_CHARACTER_DESCRIPTION_MODEL",
    );
    expect(route).toContain(
      '"qwen2.5:3b"',
    );
  });

  it("does not inherit the weak generic prompt-enhancer model", () => {
    expect(route).not.toContain(
      "OLLAMA_PROMPT_ENHANCE_MODEL_LARGE",
    );
    expect(route).not.toContain(
      "OLLAMA_PROMPT_ENHANCE_MODEL_MEDIUM",
    );
  });

  it("keeps Character enhancement provider URL independently configurable", () => {
    expect(route).toContain(
      "OLLAMA_CHARACTER_DESCRIPTION_URL",
    );
    expect(route).toContain(
      "OLLAMA_BASE_URL",
    );
  });

  it("keeps the Character model warm for five minutes by default", () => {
    expect(route).toContain(
      "OLLAMA_CHARACTER_DESCRIPTION_KEEP_ALIVE",
    );
    expect(route).toContain(
      '"5m"',
    );
  });

  it("uses only the dedicated Character timeout with a 45s default and 60s maximum", () => {
    expect(route).toContain(
      "OLLAMA_CHARACTER_DESCRIPTION_TIMEOUT_MS",
    );
    expect(route).toContain(
      "DEFAULT_CHARACTER_TIMEOUT_MS = 45_000",
    );
    expect(route).toContain(
      "MAX_CHARACTER_TIMEOUT_MS = 60_000",
    );
    expect(route).not.toContain(
      "OLLAMA_PROMPT_ENHANCE_TIMEOUT_MS",
    );
  });

  it("still preserves the original prompt on provider failure", () => {
    expect(route).toContain(
      "The original description was preserved.",
    );
  });
});
