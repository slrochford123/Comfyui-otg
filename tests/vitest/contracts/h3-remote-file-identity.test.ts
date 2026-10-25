import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const command = vi.hoisted(() => ({ exec: vi.fn(), input: vi.fn(), stdout: '{"host":"slr","verified":["fixture"]}', error: null as Error | null }));
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => {
  command.exec(...args.slice(0, 3));
  queueMicrotask(() => (args[3] as Function)(command.error, command.stdout));
  return { stdin: { on: vi.fn(), end: command.input } };
} }));
import { H3_REMOTE_FILE_PROBE, verifyH3RemoteAssetFiles } from "@/lib/h3StudioRemoteInventory";
const files = { fixture: { path: "/opt/ComfyUI/models/loras/fixture.safetensors", dev: 1, ino: 2, size: 3, mtimeMs: 1, ctimeMs: 1, mtimeNs: "1000000", ctimeNs: "1000000" } };
beforeEach(() => { vi.stubEnv("OTG_ENV", "test"); command.exec.mockClear(); command.input.mockClear(); command.stdout = '{"host":"slr","verified":["fixture"]}'; command.error = null; });
afterEach(() => vi.unstubAllEnvs());
describe("TEST remote model integrity without a daily qualification gate", () => {
  it("uses one fixed host, strict SSH identity and a read-only fixed command", async () => {
    expect(await verifyH3RemoteAssetFiles(files)).toEqual(["fixture"]);
    const [executable, args, options] = command.exec.mock.calls[0];
    expect(executable).toBe("ssh"); expect(args).toContain("StrictHostKeyChecking=yes"); expect(args).toContain("otg-slr");
    expect(args.at(-1)).not.toContain(files.fixture.path); expect(options.timeout).toBe(8000);
    expect(JSON.parse(command.input.mock.calls[0][0])).toEqual(files);
    expect(H3_REMOTE_FILE_PROBE).toContain("s.st_ino == expected.get('ino')");
    expect(H3_REMOTE_FILE_PROBE).toContain("str(s.st_ctime_ns) == expected.get('ctimeNs')");
    expect(H3_REMOTE_FILE_PROBE).toContain("candidate.is_relative_to(root)");
  });
  it("never runs in PROD and rejects empty or excessive receipts", async () => {
    vi.stubEnv("OTG_ENV", "prod"); expect(await verifyH3RemoteAssetFiles(files)).toEqual([]);
    vi.stubEnv("OTG_ENV", "test"); expect(await verifyH3RemoteAssetFiles({})).toEqual([]);
    expect(await verifyH3RemoteAssetFiles(Object.fromEntries(Array.from({length:101}, (_, i) => [String(i), files.fixture])))).toEqual([]);
    expect(command.exec).not.toHaveBeenCalled();
  });
  it("does not approve changed or removed files", async () => {
    command.stdout = '{"host":"slr","verified":[]}'; expect(await verifyH3RemoteAssetFiles(files)).toEqual([]);
  });
  it("rejects the wrong host and unexpected file identities", async () => {
    command.stdout = '{"host":"shawn","verified":["fixture"]}'; await expect(verifyH3RemoteAssetFiles(files)).rejects.toThrow("Invalid H3 remote");
    command.stdout = '{"host":"slr","verified":["other"]}'; await expect(verifyH3RemoteAssetFiles(files)).rejects.toThrow("Invalid H3 remote");
  });
  it("fails closed with sanitized connection errors", async () => {
    command.error = new Error("private SSH diagnostics sentinel"); await expect(verifyH3RemoteAssetFiles(files)).rejects.toThrow(/^H3 remote model identity check unavailable\.$/);
  });
});
