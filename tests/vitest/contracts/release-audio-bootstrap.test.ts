import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = fs.readFileSync(path.resolve("scripts/audio-editing-release-bootstrap.cjs"), "utf8");
function run(env: Record<string, string>) {
  const copy = { ...env };
  vm.runInNewContext(source, { process: { env: copy }, require: () => path, __dirname: "/candidate/scripts" });
  return copy;
}
describe("qualified release-local audio bootstrap", () => {
  it("restores audio only on TEST and uses this candidate's worker", () => {
    expect(run({ OTG_ENV: "test" })).toMatchObject({
      OTG_AUDIO_EDITING_ENABLED: "1", OTG_AUDIO_WORKER_SCRIPT: "/candidate/scripts/audio-editing-worker.py",
    });
  });
  it("does not override an explicit operator disable or runtime configuration", () => {
    const env = { OTG_ENV: "test", OTG_AUDIO_EDITING_ENABLED: "0", OTG_AUDIO_ENGINE_CONFIG: "/custom/config.json" };
    expect(run(env)).toMatchObject(env);
  });
  it("never enables production or unknown deployments", () => {
    expect(run({ OTG_ENV: "prod" })).toEqual({ OTG_ENV: "prod" });
    expect(run({})).toEqual({});
  });
  it("pins the previous CPU runtime for rollback, not an obsolete hardcoded runtime", () => {
    const activation = fs.readFileSync(path.resolve("scripts/story-creator/activate-talkback.py"), "utf8");
    expect(activation).toContain("CPU_OVERRIDE.write_text(previous_cpu if args.rollback else CPU_TEXT)");
    expect(activation).toContain("CPU configuration changed since packaging");
  });
});
