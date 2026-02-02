import type { GeneratorState } from "./types";

export const defaultGeneratorState: GeneratorState = {
  presetId: "Text To Video",
  prompt: "",
  negative: "",

  ratio: "auto",
  size: 512,
  seconds: 7,

  enhanceLevel: "medium",
  seedMode: "random",
  seed: 0,
};
