import type {GeneratorState, Ratio, Size, Seconds, EnhanceLevel } from "./types";

export type GeneratorAction =
  | { type: "setPreset"; presetId: string }
  | { type: "setPrompt"; prompt: string }
  | { type: "setNegative"; negative: string }
  | { type: "setRatio"; ratio: Ratio }
  | { type: "setSize"; size: Size }
  | { type: "setSeconds"; seconds: Seconds }
  | { type: "setEnhanceLevel"; enhanceLevel: EnhanceLevel }
  | { type: "setSeedMode"; seedMode: GeneratorState["seedMode"] }
  | { type: "setSeed"; seed: number };

export function generatorReducer(state: GeneratorState, action: GeneratorAction): GeneratorState {
  switch (action.type) {
    case "setPreset":
      return { ...state, presetId: action.presetId };
    case "setPrompt":
      return { ...state, prompt: action.prompt };
    case "setNegative":
      return { ...state, negative: action.negative };
    case "setRatio":
      return { ...state, ratio: action.ratio };
    case "setSize":
      return { ...state, size: action.size };
    case "setSeconds":
      return { ...state, seconds: action.seconds };
    case "setEnhanceLevel":
      return { ...state, enhanceLevel: action.enhanceLevel };
    case "setSeedMode":
      return { ...state, seedMode: action.seedMode };
    case "setSeed":
      return { ...state, seed: action.seed };
    default:
      return state;
  }
}
