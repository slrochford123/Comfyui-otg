import type { H3Quality } from "@/lib/production/h3ProductionRecipes";
import type { H3AdvancedSettings } from "@/lib/production/h3Settings";

export type H3SpeedRating = "slow" | "medium" | "fast";
export type H3SpeedQuality = H3Quality | "0.2" | "0.6" | "1";
export type H3SpeedSettings = Pick<H3AdvancedSettings, "checkpointMode" | "renderMode">;

// Owner-defined relative UI ratings, not measured ETAs or workflow settings.
const NATIVE = { sh: "medium", lq: "slow", hq: "slow" } as const;
const TURBO = { sh: "fast", lq: "medium", hq: "medium" } as const;
const FAST_H3 = { sh: "fast", lq: "medium", hq: "slow" } as const;

export function getH3SpeedRating(settings: H3SpeedSettings, quality: H3SpeedQuality): H3SpeedRating {
  const key = quality === "0.2" ? "sh" : quality === "0.6" ? "lq" : quality === "1" ? "hq" : quality;
  if (settings.checkpointMode === "selflift") return "fast";
  if (settings.checkpointMode === "fasth3") return FAST_H3[key];
  return (settings.renderMode === "native" ? NATIVE : TURBO)[key];
}
