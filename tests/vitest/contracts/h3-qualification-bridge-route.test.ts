import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyH3QualificationBridgeRoute } from "@/lib/h3QualificationBridgeRoute";

const { inspect } = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], options: object, callback: (error: Error | null, result?: object) => void) => {
    inspect(file, args, options).then(
      (route: object) => callback(null, { stdout: JSON.stringify(route) }),
      (error: Error) => callback(error),
    );
  },
}));

const reviewed = { build: "reviewed-build-123", environment: "TEST", port: 3001, pid: 15945 } as const;

describe("H3 qualification's installed TEST approval route", () => {
  beforeEach(() => { inspect.mockReset(); });

  it("returns only the canonical TEST service attestation from the installed bridge guard", async () => {
    inspect.mockResolvedValue({ ...reviewed, privateField: "ignored" });
    expect(await verifyH3QualificationBridgeRoute(reviewed)).toEqual(reviewed);
    expect(inspect).toHaveBeenCalledWith(
      "/home/shawn-rochford/AI/integrations/slr-test-mcp/.venv/bin/python",
      ["-I", "-B", "-c", expect.stringContaining("bridge.guard_test()"), "/home/shawn-rochford/AI/integrations/slr-test-mcp/bridge.py"],
      expect.objectContaining({ timeout: 7000 }),
    );
  });

  it("fails closed on the installed guard's stale pin", async () => {
    inspect.mockRejectedValue(new Error("TEST release/routing changed."));
    await expect(verifyH3QualificationBridgeRoute()).rejects.toThrow("Installed TEST approval bridge routing is blocked");
  });

  it.each([{ build: "different-build" }, { pid: 15946 }])("refuses a changed routing attestation %o", async change => {
    inspect.mockResolvedValue({ ...reviewed, ...change });
    await expect(verifyH3QualificationBridgeRoute(reviewed)).rejects.toThrow("routing changed since this job was approved");
  });

  it.each([{ environment: "PROD" }, { port: 3011 }, { pid: 0 }, { build: null }])("refuses invalid route %o", async change => {
    inspect.mockResolvedValue({ ...reviewed, ...change });
    await expect(verifyH3QualificationBridgeRoute()).rejects.toThrow("did not verify canonical TEST routing");
  });
});
