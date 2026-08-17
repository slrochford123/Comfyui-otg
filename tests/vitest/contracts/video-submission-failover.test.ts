import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { shouldAttemptVideoSubmissionFallback } from "@/lib/videoSubmissionFailover";

describe("video submission fallback policy", () => {
  const base = {
    routeKind: "video",
    selectionOk: true,
    backendId: "rtx3090",
    hasFallbackRequestClone: true,
  } as const;

  it("returns deterministic primary 4xx rejections without cross-GPU replay", () => {
    for (const upstreamStatus of [400, 404, 409, 422, 429]) {
      expect(shouldAttemptVideoSubmissionFallback({ ...base, upstreamStatus })).toBe(false);
    }
  });

  it("allows one verified fallback attempt for primary server-side rejections", () => {
    for (const upstreamStatus of [500, 502, 503]) {
      expect(shouldAttemptVideoSubmissionFallback({ ...base, upstreamStatus })).toBe(true);
    }
  });

  it("requires the video route, primary RTX 3090 selection, and a replayable request clone", () => {
    expect(shouldAttemptVideoSubmissionFallback({ ...base, routeKind: "image", upstreamStatus: 503 })).toBe(false);
    expect(shouldAttemptVideoSubmissionFallback({ ...base, selectionOk: false, upstreamStatus: 503 })).toBe(false);
    expect(shouldAttemptVideoSubmissionFallback({ ...base, backendId: "rtx5060ti", upstreamStatus: 503 })).toBe(false);
    expect(shouldAttemptVideoSubmissionFallback({ ...base, hasFallbackRequestClone: false, upstreamStatus: 503 })).toBe(false);
  });

  it("keeps the route policy ahead of fallback graph preparation", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/comfy/route.ts"), "utf8");
    const decision = source.indexOf("shouldAttemptVideoSubmissionFallback({");
    const prepare = source.indexOf("const prepared = await prepareFallbackGraph(", decision);
    expect(decision).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(decision);
    expect(source).toContain("if (!canTryFallback || !fallbackRequestClone)");
    expect(source).toContain("upstreamStatus: upstream.status, response: parsed");
  });
});
