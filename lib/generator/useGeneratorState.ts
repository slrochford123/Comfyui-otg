"use client";

import { useEffect, useReducer } from "react";
import { defaultGeneratorState } from "./defaults";
import type { GeneratorState } from "./types";
import { generatorReducer, type GeneratorAction } from "./reducer";

const STORAGE_KEY = "otg_generator_state_v1";

function safeParse(json: string | null): any | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeState(input: any): GeneratorState {
  const s = input && typeof input === "object" ? input : {};

  const ratioOk = s.ratio === "auto" || s.ratio === "16:9" || s.ratio === "9:16" || s.ratio === "1:1" || s.ratio === "4:3";
  const sizeOk = s.size === 256 || s.size === 384 || s.size === 512 || s.size === 768;
  const secondsOk = s.seconds === 5 || s.seconds === 7 || s.seconds === 10;
  const enhanceOk = s.enhanceLevel === "small" || s.enhanceLevel === "medium" || s.enhanceLevel === "large";
  const seedModeOk = s.seedMode === "random" || s.seedMode === "fixed";
  const seedOk = Number.isFinite(Number(s.seed));

  return {
    ...defaultGeneratorState,
    presetId: typeof s.presetId === "string" ? s.presetId : defaultGeneratorState.presetId,
    prompt: typeof s.prompt === "string" ? s.prompt : defaultGeneratorState.prompt,
    negative: typeof s.negative === "string" ? s.negative : defaultGeneratorState.negative,
    ratio: ratioOk ? s.ratio : defaultGeneratorState.ratio,
    size: sizeOk ? s.size : defaultGeneratorState.size,
    seconds: secondsOk ? s.seconds : defaultGeneratorState.seconds,
    enhanceLevel: enhanceOk ? s.enhanceLevel : defaultGeneratorState.enhanceLevel,
    seedMode: seedModeOk ? s.seedMode : defaultGeneratorState.seedMode,
    seed: seedOk ? Math.floor(Number(s.seed)) : defaultGeneratorState.seed,
  };
}

export function useGeneratorState(): [GeneratorState, React.Dispatch<GeneratorAction>] {
  const [state, dispatch] = useReducer(generatorReducer, defaultGeneratorState, (initial) => {
    if (typeof window === "undefined") return initial;
    const saved = safeParse(window.localStorage.getItem(STORAGE_KEY));
    return normalizeState(saved);
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  return [state, dispatch];
}
