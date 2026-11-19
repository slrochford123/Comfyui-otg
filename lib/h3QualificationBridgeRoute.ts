import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type H3QualificationBridgeRoute = {
  build: string;
  pid: number;
  environment: "TEST";
  port: 3001;
};

const bridgeDirectory = "/home/shawn-rochford/AI/integrations/slr-test-mcp";
const inspectInstalledBridge = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("slr_installed_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)
print(json.dumps(bridge.guard_test()))
`;

/** Ask the installed bridge to attest its current TEST pin using its existing guard. */
export async function verifyH3QualificationBridgeRoute(expected?: H3QualificationBridgeRoute) {
  let route: Partial<H3QualificationBridgeRoute>;
  try {
    const { stdout } = await promisify(execFile)(
      `${bridgeDirectory}/.venv/bin/python`,
      ["-I", "-B", "-c", inspectInstalledBridge, `${bridgeDirectory}/bridge.py`],
      { cwd: bridgeDirectory, timeout: 7_000, maxBuffer: 16_384 },
    );
    route = JSON.parse(stdout);
  } catch {
    throw new Error("Installed TEST approval bridge routing is blocked. Operator review is required before qualification.");
  }
  if (!route || typeof route.build !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(route.build)
    || !Number.isSafeInteger(route.pid) || route.pid! <= 0 || route.environment !== "TEST" || route.port !== 3001) {
    throw new Error("The installed approval bridge did not verify canonical TEST routing.");
  }
  if (expected && (route.build !== expected.build || route.pid !== expected.pid
    || route.environment !== expected.environment || route.port !== expected.port)) {
    throw new Error("TEST approval bridge routing changed since this job was approved.");
  }
  return { build: route.build, pid: route.pid!, environment: route.environment, port: route.port } satisfies H3QualificationBridgeRoute;
}
