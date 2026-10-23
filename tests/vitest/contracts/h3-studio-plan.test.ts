import { describe, expect, it } from "vitest";
import { DEFAULT_H3_STUDIO_PLAN, parseH3StudioPlan, makeLocalH3Plan, studioDimensions, studioFrames } from "@/lib/h3StudioPlan";
const plan = { ...DEFAULT_H3_STUDIO_PLAN, prompt: "A quiet test landscape", originalPrompt: "A quiet test landscape" };
describe("H3 Auto / Manual strict shared plan", () => {
  it("round-trips without changing creative intent", () => expect(parseH3StudioPlan(plan)).toEqual(plan));
  it.each(["file", "graph", "url", "cost", "constructor", "toString"])("rejects injected %s", key => expect(() => parseH3StudioPlan({ ...plan, [key]: "untrusted" })).toThrow());
  it.each(["profile", "attention", "audio", "fps", "quality", "version", "workflowId"])("rejects unknown %s", key => expect(() => parseH3StudioPlan({ ...plan, [key]: "unregistered" })).toThrow());
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects seed %s", seed => expect(() => parseH3StudioPlan({ ...plan, seed })).toThrow());
  it.each([2, 4, 15])("does not promise unqualified native duration %s", durationSeconds => expect(() => parseH3StudioPlan({ ...plan, durationSeconds })).toThrow());
  it("does not substitute FL2VA for a Ref2VA accelerator", () => expect(() => parseH3StudioPlan({ ...plan, profile: "ref2va-8step" })).toThrow(/Ref2VA/));
  it("does not apply the Ref2VA checkpoint to FL2VA", () => expect(() => parseH3StudioPlan({ ...plan, checkpoint: "singularity" })).toThrow());
  it("requires a source-video workflow for original audio", () => expect(() => parseH3StudioPlan({ ...plan, audio: "original" })).toThrow());
  it("does not conflate original with generated audio", () => expect(parseH3StudioPlan({ ...plan, workflowId: "reference-edit", audio: "original" }).audio).toBe("original"));
  it("keeps Combat independent of Singularity's automatic Realism", () => expect(parseH3StudioPlan({ ...plan, workflowId: "native-r2v", checkpoint: "singularity", combatEnabled: false }).combatEnabled).toBe(false));
  it.each([["0.2", 608, 352], ["0.6", 1056, 608], ["1", 1344, 768]] as const)("uses correct %s MP dimensions", (quality, width, height) => {
    expect(studioDimensions({ quality, orientation: "landscape" })).toEqual({ width, height });
    expect(studioDimensions({ quality, orientation: "portrait" })).toEqual({ width: height, height: width });
  });
  it.each([5, 10])("keeps %ss frames on the 17k+5 temporal grid", seconds => { expect((studioFrames(seconds) - 5) % 17).toBe(0); expect(studioFrames(seconds)).toBeGreaterThanOrEqual(seconds * 24); });
  it.each([[{ first: false, images: 0, videos: 0, audios: 0 }, "native-t2v"], [{ first: true, images: 0, videos: 0, audios: 0 }, "native-i2v"], [{ first: false, images: 1, videos: 0, audios: 0 }, "native-r2v"], [{ first: false, images: 1, videos: 1, audios: 0 }, "reference-edit"]] as const)("local plan uses real media requirements", (media, workflowId) => {
    expect(makeLocalH3Plan(plan.prompt, media, plan).workflowId).toBe(workflowId);
  });
  it("rejects duplicate, arbitrary-path and out-of-range LoRAs", () => {
    const lora = { id: "civitai-1-2", strength: 1, enabled: true };
    for (const loras of [[lora, lora], [{ ...lora, id: "../weights" }], [{ ...lora, strength: 2.1 }], [{ ...lora, filename: "arbitrary" }]]) expect(() => parseH3StudioPlan({ ...plan, loras })).toThrow();
  });
  it("asks for an essential missing source rather than pretending a text-only generation edits a video", () => {
    expect(() => makeLocalH3Plan("Edit this clip to change the lighting", { first: false, images: 0, videos: 0, audios: 0 }, plan)).toThrow(/source video/);
  });
});
