import { describe, expect, it } from "vitest";

import {
  clampAnglesWorkflowVertical,
  clampAnglesWorkflowZoom,
  normalizeAnglesWorkflowHorizontal,
  serializeAnglesCamera,
} from "@/lib/anglesCamera";

describe("Angles Qwen camera contract", () => {
  it.each([
    ["front", 0, 0],
    ["camera right", 90, 90],
    ["rear", 180, 180],
    ["camera left", -90, 270],
    ["full positive turn", 360, 0],
    ["full negative turn", -360, 0],
    ["wrapped left", 270, 270],
  ])("serializes %s horizontal input as 0-359 degrees", (_label, input, expected) => {
    expect(normalizeAnglesWorkflowHorizontal(input)).toBe(expected);
  });

  it("preserves valid low and high camera elevations", () => {
    expect(clampAnglesWorkflowVertical(-30)).toBe(-30);
    expect(clampAnglesWorkflowVertical(0)).toBe(0);
    expect(clampAnglesWorkflowVertical(60)).toBe(60);
  });

  it("clamps vertical camera elevation to the custom-node contract", () => {
    expect(clampAnglesWorkflowVertical(-90)).toBe(-30);
    expect(clampAnglesWorkflowVertical(120)).toBe(60);
  });

  it("clamps workflow zoom to 0-10 and keeps one decimal place", () => {
    expect(clampAnglesWorkflowZoom(-1)).toBe(0);
    expect(clampAnglesWorkflowZoom(5.26)).toBe(5.3);
    expect(clampAnglesWorkflowZoom(11)).toBe(10);
  });

  it("converts the signed UI camera state to Qwen workflow inputs", () => {
    expect(serializeAnglesCamera(-90, -18, -5)).toEqual({
      horizontal: 270,
      vertical: -18,
      zoom: 0,
    });

    expect(serializeAnglesCamera(180, 60, 5)).toEqual({
      horizontal: 180,
      vertical: 60,
      zoom: 10,
    });
  });
});
