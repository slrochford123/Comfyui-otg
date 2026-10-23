import { describe, expect, it } from "vitest";
import { parseSimpleVideoEdit, simpleVideoEditPlan } from "@/lib/h3SimpleVideoEdit";
import { DEFAULT_H3_STUDIO_PLAN, parseH3StudioPlan, reconcileH3StudioPlan, studioFrames, studioTemplateDuration } from "@/lib/h3StudioPlan";
const body = { sourceId: "e028b5a5-b70e-4cf7-b91f-bc45f3f380f4", prompt: "Change the coat to blue", quality: "0.6", requestId: "qa-edit-request" };
const probe = { width: 1920, height: 1080, codec: "h264", fps: 30, durationSeconds: 4.76 };
describe("simple manual edit's server-owned controls", () => {
  it.each([2, 4.76, 5, 10])("retains actual %s-second selected duration with fixed SLA/Turbo", durationSeconds => {
    const plan = simpleVideoEditPlan(parseSimpleVideoEdit(body), { ...probe, durationSeconds });
    expect(plan).toMatchObject({ workflowId: "reference-edit", durationSeconds, profile: "ref2va-8step", steps: 8, sampler: "euler", attention: "project-sla", orientation: "landscape", loras: [], combatEnabled: false });
    expect((studioFrames(durationSeconds) - 5) % 17).toBe(0);
    expect(studioFrames(durationSeconds) / 24).toBeGreaterThanOrEqual(durationSeconds);
    expect(studioTemplateDuration(durationSeconds)).toBe(durationSeconds <= 5 ? 5 : 10);
  });
  it.each([1.99, 10.01, NaN, Infinity, null])("rejects source duration %s from the server probe", durationSeconds => {
    expect(() => simpleVideoEditPlan(parseSimpleVideoEdit(body), { ...probe, durationSeconds })).toThrow(/2 and 10/);
  });
  it("uses display rotation rather than forcing the raw landscape encoding", () => {
    expect(simpleVideoEditPlan(parseSimpleVideoEdit(body), { ...probe, displayWidth: 1080, displayHeight: 1920 }).orientation).toBe("portrait");
  });
  it.each(["durationSeconds", "orientation", "profile", "attention", "target", "graph", "path", "plan", "reviewId", "generationConsent"])("rejects forged %s", key => {
    expect(() => parseSimpleVideoEdit({ ...body, [key]: "forged" })).toThrow(/Unsupported/);
  });
  it("invalidates request identity for source, prompt or MP changes", () => {
    const original = parseSimpleVideoEdit(body).requestFingerprint;
    for (const patch of [{ prompt: "Red coat" }, { quality: "1" }, { sourceId: "e128b5a5-b70e-4cf7-b91f-bc45f3f380f4" }]) expect(parseSimpleVideoEdit({ ...body, ...patch }).requestFingerprint).not.toBe(original);
  });
  it("keeps other Studio workflow durations restricted and reconciles when leaving edit", () => {
    const plan = simpleVideoEditPlan(parseSimpleVideoEdit(body), probe);
    expect(() => parseH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, prompt: "kite", originalPrompt: "kite", durationSeconds: 4.76 })).toThrow(/duration/);
    expect(reconcileH3StudioPlan(plan, { workflowId: "native-t2v" })).toMatchObject({ durationSeconds: 5, profile: "native" });
  });
});
