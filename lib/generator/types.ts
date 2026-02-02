export type Ratio = "auto" | "16:9" | "9:16" | "1:1" | "4:3";
export type Size = 256 | 384 | 512 | 768;
export type Seconds = 5 | 7 | 10;
export type EnhanceLevel = "small" | "medium" | "large";


export type GeneratorState = {
  presetId: string;
  prompt: string;
  negative: string;

  ratio: Ratio;
  size: Size;
  seconds: Seconds;
  enhanceLevel: EnhanceLevel;

  seedMode: "random" | "fixed";
  seed: number;
};
