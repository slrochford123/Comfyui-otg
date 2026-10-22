import fs from "node:fs";
import { describe, expect, it } from "vitest";
describe("Production VSR live required inputs", () => {
  it("preserves ULTRA quality and supplies the current SDK required defaults", () => {
    const graph = JSON.parse(fs.readFileSync("comfy_workflows/internal/production-v2/minimax_h3_rtx_vsr_ultra_1080p.json", "utf8"));
    expect(graph["1"].inputs).toMatchObject({ quality: "ULTRA", strength: 1, image_encoding: "8-bit RGB", "resize_type.width": 1920, "resize_type.height": 1080 });
  });
  it("completes native Scene Hunter previews before submitting optional VSR", () => {
    const source = fs.readFileSync("lib/production/h3GenerationScheduler.ts", "utf8");
    const prepare = source.slice(source.indexOf("async function prepareAndSubmitVsr"));
    expect(prepare.indexOf('job.payload.h3Quality === "sh"')).toBeLessThan(prepare.indexOf("schedulerProbe(dependencies)"));
    expect(prepare).toContain('"Complete - native Scene Hunter preview"');
  });
});
