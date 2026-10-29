import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("read-only PROD private-research readiness", () => {
  const file = path.join(process.cwd(), "scripts/deploy/check-private-research-readiness.py");
  const source = fs.readFileSync(file, "utf8");
  it("parses without creating Python cache files or running the probe", () => {
    const result = spawnSync("/usr/bin/python3", ["-c", "import ast,sys;ast.parse(open(sys.argv[1]).read())", file]);
    expect(result.status).toBe(0);
  });
  it("supports help without privileges or live operations", () => {
    const result = spawnSync("/usr/bin/python3", [file, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.replace(/\s+/g, " ")).toContain("Never activate, install, cancel or restart");
  });
  it("does not contain deployment, package installation or GPU interruption commands", () => {
    expect(source).not.toMatch(/['"](?:restart|stop|start|daemon-reload|kill|pkill|pip|apt|nvidia-smi --gpu-reset)['"]/);
    expect(source).not.toContain("/interrupt");
    expect(source).not.toContain("authorized_keys");
    expect(source).toContain("if os.geteuid()!=0 or socket.gethostname()!='slr'");
  });
  it("uses only the existing SSH identity and preserves release, PID and config", () => {
    expect(source).toContain("OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE");
    expect(source).toContain("'IdentitiesOnly=yes'");
    expect(source).toContain("fingerprint(Path(file))!=digest");
    expect(source).toContain("property_value('MainPID')!=pid");
    expect(source).toContain("'applicationEnablementStillRequired':True");
  });
});
