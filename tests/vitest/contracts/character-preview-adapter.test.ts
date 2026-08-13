import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const adapterPath = path.join(process.cwd(), "scripts", "windows", "otg-character-preview-adapter.py");
const pythonPath = process.env.APPLIO_PYTHON && fs.existsSync(process.env.APPLIO_PYTHON)
  ? process.env.APPLIO_PYTHON
  : "python3";

function runAdapter(env: Record<string, string | undefined>) {
  return spawnSync(pythonPath, [adapterPath], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function makeJobFixture(overrides: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-character-preview-adapter-"));
  const source = path.join(dir, "source.png");
  const model = path.join(dir, "model.pth");
  const index = path.join(dir, "model.index");
  fs.writeFileSync(source, "source-image");
  fs.writeFileSync(model, "model-bytes");
  fs.writeFileSync(index, "index-bytes");

  const jobJson = path.join(dir, "job-input.json");
  const resultJson = path.join(dir, "result.json");
  const payload = {
    ownerKey: "owner-a",
    characterId: "char-a",
    jobId: "cvp_preview",
    input: {
      sourceImagePath: source,
      trainedModelPath: model,
      trainedIndexPath: index,
      ...overrides,
    },
  };
  fs.writeFileSync(jobJson, JSON.stringify(payload), "utf8");
  return { dir, source, model, index, jobJson, resultJson };
}

describe("character preview adapter contract", () => {
  it("refuses missing job JSON env", () => {
    const result = runAdapter({});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OTG_CHARACTER_PREVIEW_JOB_JSON is required.");
  });

  it("refuses a missing source image", () => {
    const fixture = makeJobFixture({ sourceImagePath: path.join(os.tmpdir(), "missing-source.png") });
    const result = runAdapter({
      OTG_CHARACTER_PREVIEW_JOB_JSON: fixture.jobJson,
      OTG_CHARACTER_PREVIEW_RESULT_JSON: fixture.resultJson,
      OTG_CHARACTER_PREVIEW_WORK_DIR: fixture.dir,
      OTG_CHARACTER_PREVIEW_SCRIPT: "hello",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Character source image is missing. Cannot generate preview.");
  });

  it("refuses missing trained model and index", () => {
    const fixture = makeJobFixture({
      trainedModelPath: path.join(os.tmpdir(), "missing-model.pth"),
      trainedIndexPath: path.join(os.tmpdir(), "missing-model.index"),
    });
    const result = runAdapter({
      OTG_CHARACTER_PREVIEW_JOB_JSON: fixture.jobJson,
      OTG_CHARACTER_PREVIEW_RESULT_JSON: fixture.resultJson,
      OTG_CHARACTER_PREVIEW_WORK_DIR: fixture.dir,
      OTG_CHARACTER_PREVIEW_SCRIPT: "hello",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Trained Applio .pth model is missing or empty:");
  });

  it("requires an explicit LTX command after guide TTS is available", () => {
    const fixture = makeJobFixture();
    const writeGuide = `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync(process.env.OTG_CHARACTER_PREVIEW_GUIDE_AUDIO, 'RIFFGUIDE')"`;
    const result = runAdapter({
      OTG_CHARACTER_PREVIEW_JOB_JSON: fixture.jobJson,
      OTG_CHARACTER_PREVIEW_RESULT_JSON: fixture.resultJson,
      OTG_CHARACTER_PREVIEW_WORK_DIR: fixture.dir,
      OTG_CHARACTER_PREVIEW_SCRIPT: "hello",
      OTG_CHARACTER_PREVIEW_TTS_COMMAND: writeGuide,
      OTG_CHARACTER_PREVIEW_LTX_COMMAND: "",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Character preview LTX command is not configured.");
    expect(fs.existsSync(path.join(fixture.dir, "guide.wav"))).toBe(true);
    expect(fs.existsSync(fixture.resultJson)).toBe(false);
  });
});
