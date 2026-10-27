// @vitest-environment jsdom
import fs from "node:fs";
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import H3SpeedIndicator from "@/app/app/components/H3SpeedIndicator";
import H3AdvancedControls from "@/app/app/components/H3AdvancedControls";
import { getH3SpeedRating, type H3SpeedQuality, type H3SpeedRating, type H3SpeedSettings } from "@/lib/h3SpeedRating";
import { DEFAULT_H3_ADVANCED_SETTINGS, type H3AdvancedSettings } from "@/lib/production/h3Settings";

afterEach(cleanup);
const profiles = [
  { checkpointMode: "standard", renderMode: "native", ratings: ["medium", "slow", "slow"] },
  { checkpointMode: "standard", renderMode: "turbo", ratings: ["fast", "medium", "medium"] },
  { checkpointMode: "singularity", renderMode: "native", ratings: ["medium", "slow", "slow"] },
  { checkpointMode: "singularity", renderMode: "turbo", ratings: ["fast", "medium", "medium"] },
  { checkpointMode: "fasth3", renderMode: "turbo", ratings: ["fast", "medium", "slow"] },
  { checkpointMode: "selflift", renderMode: "turbo", ratings: ["fast", "fast", "fast"] },
] as const;
const cases = profiles.flatMap(profile => (["sh", "lq", "hq"] as const).map((quality, index) => ({
  checkpointMode: profile.checkpointMode, renderMode: profile.renderMode, quality,
  studioQuality: (["0.2", "0.6", "1"] as const)[index], expected: profile.ratings[index],
})));
const label = (rating: string) => rating[0].toUpperCase() + rating.slice(1);
const visuals = {
  slow: { color: "text-red-400", bars: 1 },
  medium: { color: "text-yellow-300", bars: 2 },
  fast: { color: "text-green-400", bars: 3 },
};

describe("owner-defined H3 speed ratings", () => {
  it.each(cases)("$checkpointMode $renderMode $quality maps to $expected in both interfaces", row => {
    expect(getH3SpeedRating(row, row.quality)).toBe(row.expected);
    expect(getH3SpeedRating(row, row.studioQuality)).toBe(row.expected);
  });
  it.each(cases)("$checkpointMode $renderMode $quality has the exact word, color and bar count", row => {
    const { container } = render(<H3SpeedIndicator settings={row} quality={row.quality} />);
    expect(screen.getByRole("status", { name: `Generation speed: ${label(row.expected)}` })).toHaveAttribute("aria-live", "polite");
    const word = screen.getByText(label(row.expected));
    expect(word).toHaveClass("text-3xl", "font-black");
    expect(word.parentElement).toHaveClass(visuals[row.expected].color);
    const bars = [...container.querySelectorAll('[data-otg="h3-speed-bar"]')];
    expect(bars).toHaveLength(visuals[row.expected].bars);
    expect(bars[0].parentElement).toHaveAttribute("aria-hidden", "true");
    expect(word.nextElementSibling).toBe(bars[0].parentElement);
    expect(container.textContent).not.toMatch(/\d|\bminutes?\b|\bseconds?\b/);
  });
  it.each(["fasth3", "selflift"] as const)("%s ignores a retained legacy Native toggle", checkpointMode => {
    for (const quality of ["sh", "lq", "hq"] as const) {
      expect(getH3SpeedRating({ checkpointMode, renderMode: "native" }, quality)).toBe(getH3SpeedRating({ checkpointMode, renderMode: "turbo" }, quality));
    }
  });
  it("updates through the existing model/render controls without mutating their behavior", () => {
    function Harness() {
      const [settings, setSettings] = useState<H3AdvancedSettings>({ ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode: "native" });
      const [quality, setQuality] = useState<H3SpeedQuality>("sh");
      return <><H3AdvancedControls value={settings} onChange={setSettings} allowFastH3 />
        <button onClick={() => setQuality("hq")}>1 MP</button><button onClick={() => setQuality("sh")}>0.2 MP</button>
        <H3SpeedIndicator settings={settings} quality={quality} /></>;
    }
    render(<Harness />);
    const rating = (speed: H3SpeedRating) => expect(screen.getByRole("status", { name: `Generation speed: ${label(speed)}` })).toBeVisible();
    rating("medium");
    fireEvent.click(screen.getByRole("button", { name: "Turbo", exact: true })); rating("fast");
    fireEvent.click(screen.getByRole("button", { name: "1 MP", exact: true })); rating("medium");
    fireEvent.click(screen.getByRole("button", { name: "Singularity", exact: true })); rating("medium");
    fireEvent.click(screen.getByRole("button", { name: "Native", exact: true })); rating("slow");
    fireEvent.click(screen.getByRole("button", { name: "SelfLift", exact: true })); rating("fast");
    fireEvent.click(screen.getByRole("button", { name: "FastH3", exact: true })); rating("slow");
    fireEvent.click(screen.getByRole("button", { name: "0.2 MP", exact: true })); rating("fast");
    fireEvent.click(screen.getByRole("button", { name: "Standard", exact: true })); rating("medium");
    expect(screen.getByRole("button", { name: "Native", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
  it("re-renders selected quality and checkpoint without retaining an old rating", () => {
    const settings: H3SpeedSettings = { checkpointMode: "fasth3", renderMode: "turbo" };
    const { rerender } = render(<H3SpeedIndicator settings={settings} quality="sh" />);
    rerender(<H3SpeedIndicator settings={settings} quality="lq" />);
    expect(within(screen.getByRole("status")).getByText("Medium")).toBeVisible();
    rerender(<H3SpeedIndicator settings={settings} quality="hq" />);
    expect(within(screen.getByRole("status")).getByText("Slow")).toBeVisible();
    rerender(<H3SpeedIndicator settings={{ ...settings, checkpointMode: "selflift" }} quality="hq" />);
    expect(within(screen.getByRole("status")).getByText("Fast")).toBeVisible();
  });
  it("replaces runtime numbers at both existing UI locations, retaining credits and actual elapsed progress", () => {
    const panel = fs.readFileSync("app/app/components/H3Panel.tsx", "utf8");
    const studio = fs.readFileSync("app/app/components/H3StudioControls.tsx", "utf8");
    expect(panel).toContain('<H3SpeedIndicator settings={h3Settings} quality={quality} />');
    expect(panel).not.toContain('>Estimate:</span>');
    expect(panel).not.toContain("getH3ProductionTimeEstimate");
    expect(panel).toContain("Elapsed {formatDuration(elapsedSeconds(job, now))}");
    expect(studio).not.toContain("Runtime estimate:");
    expect(studio).toContain("Generation credits:");
    expect(studio).toContain("<H3SpeedIndicator settings={{ checkpointMode: plan.checkpoint");
  });
});
