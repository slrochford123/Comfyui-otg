import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSwapPlanFromForm } from "@/lib/editVideoSwapCharacters";
import { h3CandidateBackends } from "@/lib/h3GpuRouting";

function form(engine = "minimax-h3", target?: string) {
  const value = new FormData();
  value.set("engine", engine);value.set("video_name", "owner-cafe.mp4");
  value.set("swap_count", "1");value.set("swap_0_replacement_name", "owner-reference.png");
  if (target !== undefined) value.set("targetBackend", target);
  return value;
}
describe("Edit Video H3 Swap Characters selected GPU", () => {
  it.each(["rtx3090", "rtx5060ti"])("binds %s through request, plan and existing no-fallback selector", target => {
    const result = buildSwapPlanFromForm(form("minimax-h3", target));
    expect(result.ok).toBe(true);if (!result.ok) return;
    expect(result.request.targetBackend).toBe(target);expect(result.plan.targetBackend).toBe(target);
    expect(h3CandidateBackends(result.request.targetBackend, ["rtx3090", "rtx5060ti"])).toEqual([target]);
    expect(result.request.clipDurationSeconds).toBe(5);expect(result.request.preserveAudio).toBe(true);
    expect(result.plan.prompt).toContain("<Video 1>");expect(result.plan.prompt).toContain("<Picture 1>");
  });
  it.each(["rtx6060ti", "http://localhost:8188", "", "../rtx3090"])("rejects unsupported target %s before media handling", target => {
    expect(buildSwapPlanFromForm(form("minimax-h3", target))).toMatchObject({ok:false,status:400});
  });
  it("preserves older unpinned H3 callers and the separate SCAIL path", () => {
    for (const input of [form(),form("scail2","ignored-scail-setting")]) {
      const result=buildSwapPlanFromForm(input);expect(result.ok).toBe(true);if(!result.ok) continue;
      expect(result.request.targetBackend).toBeUndefined();expect(result.plan.targetBackend).toBeUndefined();
    }
  });
  it("hands the validated selection to the established H3 job engine", () => {
    const route=fs.readFileSync("app/api/edit-video/swap-characters/submit/route.ts","utf8");
    expect(route).toMatch(/validateH3DirectInput\(\{\s*targetBackend: args\.request\.targetBackend,/);
    expect(route).toContain("createH3DirectJob(args.owner.ownerKey, input, args.owner)");
  });
});
