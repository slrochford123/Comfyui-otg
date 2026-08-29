import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const targetSource = fs.readFileSync(
  path.join(repoRoot, "app/api/_lib/comfyTarget.ts"),
  "utf8",
);

const routeSource = fs.readFileSync(
  path.join(repoRoot, "app/api/comfy/route.ts"),
  "utf8",
);

describe("Generate image backend routing contract", () => {
  it("classifies the canonical Krea 2 Turbo Generate workflow as image work", () => {
    expect(targetSource).toContain(
      'key.includes("image_krea2_turbo_t2i")',
    );
  });

  it("does not let manifest routing replace an already classified image backend", () => {
    const start = routeSource.indexOf(
      "const descriptor = await peekWorkflowDescriptor(req);",
    );
    const end = routeSource.indexOf(
      "let COMFY_BASE_URL = route.baseUrl;",
      start,
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const routingBlock = routeSource.slice(start, end);

    expect(routingBlock).toContain(
      'if (route.kind === "video")',
    );

    expect(routingBlock).toContain(
      '} else if (route.kind === "default") {',
    );

    expect(routingBlock).not.toMatch(
      /}\s*else\s*{\s*manifestSelection\s*=\s*await\s+selectManifestBackend/,
    );
  });

  it("locks the selected backend before multipart uploads are parsed", () => {
    const backendIndex = routeSource.indexOf(
      "let COMFY_BASE_URL = route.baseUrl;",
    );

    const parseIndex = routeSource.indexOf(
      "body = await parseOtgBody(req, COMFY_BASE_URL);",
    );

    expect(backendIndex).toBeGreaterThanOrEqual(0);
    expect(parseIndex).toBeGreaterThan(backendIndex);
  });
});
