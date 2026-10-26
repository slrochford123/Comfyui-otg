import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { readBuildIdentity } from "@/lib/buildIdentityServer";
import { BUILD_VERSION } from "@/lib/buildHistory";
const require = createRequire(import.meta.url);
const historyTool = require("../../../scripts/release/record-build.cjs");
const directories: string[] = [];
function fixture(record?: unknown) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slr-build-identity-")); directories.push(directory);
  if (record !== undefined) fs.writeFileSync(path.join(directory, "RELEASE_PROVENANCE.json"), JSON.stringify(record));
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe("owner-facing build identity and append-only release history", () => {
  it("identifies this release as Build 2.02 independently of package semver", () => {
    expect(BUILD_VERSION).toBe("2.02");
    expect(readBuildIdentity(fixture())).toMatchObject({ buildVersion: BUILD_VERSION, softwareVersion: "2.0.1", commit: null, releaseName: null });
  });
  it("reads the exact packaged release identity but never private provenance fields", () => {
    const identity = readBuildIdentity(fixture({ buildVersion: BUILD_VERSION, commit: "a".repeat(40), name: "prod-build-2.01-aaaaaaaaaaaa", builtAt: "2026-10-25T22:00:00Z", secret: "private-fixture", paths: ["/private"] }));
    expect(identity).toMatchObject({ commit: "a".repeat(40), releaseName: "prod-build-2.01-aaaaaaaaaaaa", builtAt: "2026-10-25T22:00:00Z" });
    expect(JSON.stringify(identity)).not.toContain("private-fixture"); expect(JSON.stringify(identity)).not.toContain("/private");
  });
  it("does not reuse a different build's provenance", () => {
    expect(readBuildIdentity(fixture({ buildVersion: "1", commit: "a".repeat(40), name: "old" })).commit).toBeNull();
  });
  it("rejects filesystem paths and invalid revisions in displayed metadata", () => {
    expect(readBuildIdentity(fixture({ buildVersion: BUILD_VERSION, commit: "not-a-commit", name: "/private/release", builtAt: "wrong" }))).toMatchObject({ commit: null, releaseName: null, builtAt: null });
  });
  it("ignores malformed and symlinked provenance", () => {
    const root = fixture(); fs.writeFileSync(path.join(root, "bad"), "{"); fs.symlinkSync("bad", path.join(root, "RELEASE_PROVENANCE.json"));
    expect(readBuildIdentity(root).commit).toBeNull(); fs.unlinkSync(path.join(root, "RELEASE_PROVENANCE.json")); fs.writeFileSync(path.join(root, "RELEASE_PROVENANCE.json"), "{");
    expect(readBuildIdentity(root).commit).toBeNull();
  });
  it("orders two-digit increments without floating-point rounding", () => {
    expect(["2", "2.01", "2.02", "2.09", "2.10"].map(historyTool.ordinal)).toEqual([200, 201, 202, 209, 210]);
  });
  it.each(["2.1", "02", "2.001", "2e2", "../2", 2])("rejects ambiguous or manipulated version %s", value => expect(() => historyTool.ordinal(value)).toThrow());
  it("appends a new build without modifying prior rollback history", () => {
    const before = { schemaVersion: 1, current: "2", builds: [{ version: "2", summary: "Existing" }] };
    const result = historyTool.recordBuild(before, "2.01", "Next update", "b".repeat(40), "2026-10-24");
    expect(result.current).toBe("2.01"); expect(result.builds[0]).toEqual(before.builds[0]); expect(before.builds).toHaveLength(1);
    expect(result.builds[1]).toMatchObject({ version: "2.01", sourceBaseCommit: "b".repeat(40) });
  });
  it.each(["2", "2.00", "1.99"])("cannot overwrite or downgrade history to %s", version => {
    expect(() => historyTool.recordBuild({ schemaVersion: 1, current: "2", builds: [{ version: "2" }] }, version, "Update", "b".repeat(40), "2026-10-24")).toThrow(/append-only/);
  });
});
