import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(relative: string) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

describe("Production V2 H3 scheduler single-flight contract", () => {
  it("coalesces timer and request wakeups behind one shared running state", () => {
    const scheduler = source("lib/production/h3GenerationScheduler.ts");

    expect(scheduler).toContain("pending: boolean;");
    expect(scheduler).toContain("export function requestProductionV2H3SchedulerTick()");
    expect(scheduler).toContain("if (state.running) {");
    expect(scheduler).toContain("state.pending = true;");
    expect(scheduler).toContain("state.pending = false;");
    expect(scheduler).toContain("requestProductionV2H3SchedulerTick();");
    expect(scheduler).toContain("setInterval(\n    requestProductionV2H3SchedulerTick,");
  });

  it("prevents API polling from bypassing the shared scheduler gate", () => {
    const route = source("app/api/production/v2/generation/route.ts");

    expect(route).toContain("requestProductionV2H3SchedulerTick");
    expect(route).not.toContain("runProductionV2H3SchedulerTick");
  });
});
