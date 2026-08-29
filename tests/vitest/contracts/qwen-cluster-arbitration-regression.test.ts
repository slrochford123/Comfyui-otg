import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const routerSource = fs.readFileSync(
  path.join(repoRoot, "lib/workers/qwenClusterRouter.ts"),
  "utf8",
);

const clusterGpuSource = fs.readFileSync(
  path.join(repoRoot, "lib/workers/clusterGpu.ts"),
  "utf8",
);

describe("Qwen cluster arbitration regression contract", () => {
  it("allows the Qwen router to reuse its own warm Shawn model", () => {
    expect(routerSource).toContain(
      'occupancy.reason === "qwen-resident-stale" && occupancy.recoverable',
    );

    expect(routerSource).toContain(
      "if (!occupancy.available && !qwenResidentIsReusable) return null;",
    );
  });

  it("checks Comfy before classifying resident Qwen as reusable", () => {
    const residentCapture = clusterGpuSource.indexOf(
      "qwenResident = hasResidentModel",
    );

    const comfyBusyReturn = clusterGpuSource.indexOf(
      'return { available: false, external: false, recoverable: false, reason: "comfy-active" };',
    );

    const residentReturn = clusterGpuSource.indexOf(
      'return { available: false, external: true, recoverable: true, reason: "qwen-resident-stale" };',
    );

    expect(residentCapture).toBeGreaterThan(-1);
    expect(comfyBusyReturn).toBeGreaterThan(residentCapture);
    expect(residentReturn).toBeGreaterThan(comfyBusyReturn);
  });

  it("preserves generic Shawn protection for non-Qwen GPU workloads", () => {
    expect(clusterGpuSource).toContain(
      'reason: "qwen-resident-stale"',
    );

    expect(clusterGpuSource).toContain(
      'reason: "qwen-code"',
    );

    expect(clusterGpuSource).toContain(
      'reason: "comfy-active"',
    );
  });

  it("bounds Qwen leases to the request lifetime instead of fifteen minutes", () => {
    expect(routerSource).toContain(
      "Math.max(30, Math.ceil(totalTimeoutMs / 1000) + 30)",
    );

    expect(routerSource).toContain(
      "leaseTtlSeconds,",
    );
  });

  it("releases leases immediately for definite connection failures", () => {
    expect(routerSource).toContain('"ECONNREFUSED"');
    expect(routerSource).toContain('"ENETUNREACH"');
    expect(routerSource).toContain('"EHOSTUNREACH"');
    expect(routerSource).toContain('"UND_ERR_CONNECT_TIMEOUT"');

    expect(routerSource).toContain(
      "leaseCanReleaseImmediatelyAfterTransportFailure(error)",
    );

    expect(routerSource).toContain(
      "responseCompleted || releaseLeaseAfterFailure",
    );
  });

  it("does not classify abort failures as definitely safe to release", () => {
    const connectFailureBlock = routerSource.match(
      /const DEFINITE_CONNECT_FAILURE_CODES = new Set\(\[([\s\S]*?)\]\);/,
    );

    expect(connectFailureBlock).not.toBeNull();
    expect(connectFailureBlock?.[1]).not.toContain("AbortError");
    expect(connectFailureBlock?.[1]).not.toContain("ECONNRESET");
  });
});
