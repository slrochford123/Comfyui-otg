import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const configPath = path.join(repoRoot, "vitest.config.ts");

describe("Vitest test discovery contract", () => {
  it("preserves Vitest default exclusions and excludes patch-backup test copies", () => {
    if (!fs.existsSync(configPath)) {
      throw new Error("RED_EXPECTED_VITEST_CONFIG_MISSING");
    }

    const source = fs.readFileSync(configPath, "utf8");

    expect(source).toContain('from "vitest/config"');
    expect(source).toContain("configDefaults");
    expect(source).toContain("defineConfig");

    expect(source).toMatch(
      /exclude\s*:\s*\[[\s\S]*\.\.\.configDefaults\.exclude[\s\S]*["']\*\*\/\.patch-backups\/\*\*["']/,
    );
  });
});
