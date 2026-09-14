import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sourcePath = path.join(repoRoot, "lib/production/h3Workflows.ts");
const source = fs.readFileSync(sourcePath, "utf8");

describe("H3 physical backend endpoint contract", () => {
  it("routes RTX 5060 Ti H3 work to the SLR Tailscale Comfy endpoint", () => {
    expect(source).toContain(
      'baseUrl: "http://100.98.212.116:8188"'
    );
  });

  it("does not identify loopback 8188 as the RTX 5060 Ti backend", () => {
    expect(source).not.toContain(
      'baseUrl: "http://127.0.0.1:8188"'
    );
  });

  it("keeps RTX 3090 H3 work on Shawn port 8189", () => {
    expect(source).toContain(
      'baseUrl: "http://100.75.162.64:8189"'
    );
  });

  it("keeps distinct physical endpoints for the two H3 GPUs", () => {
    const endpointMatches = [
      ...source.matchAll(/baseUrl:\s*"([^"]+)"/g),
    ].map((match) => match[1]);

    expect(endpointMatches).toContain(
      "http://100.98.212.116:8188"
    );

    expect(endpointMatches).toContain(
      "http://100.75.162.64:8189"
    );

    expect("http://100.98.212.116:8188").not.toBe(
      "http://100.75.162.64:8189"
    );
  });
});
