import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Linux Qwen3 voice worker virtualenv launcher", () => {
  const workerPath = path.join(process.cwd(), "scripts/linux/otg-character-voice-worker.py");
  const worker = fs.readFileSync(workerPath, "utf8");

  it("preserves the virtualenv Python symlink", () => {
    expect(worker).toContain("Path(path_text).expanduser().absolute()");
    expect(worker).not.toContain("Path(path_text).expanduser().resolve()");
  });

  it("continues to launch the bridge with qwen_python", () => {
    expect(worker).toContain("str(qwen_python)");
    expect(worker).toContain('require_path(args.qwen_python, "QWEN_TTS_PYTHON")');
  });
});
