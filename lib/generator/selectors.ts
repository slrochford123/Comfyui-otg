import type { GeneratorState } from "./types";

export function buildComfyPayloadFromState(state: GeneratorState) {
  // Keep this small and pure: just transform state into a submit-ready payload.
  return {
    preset: state.presetId,
    positivePrompt: state.prompt,
    negativePrompt: state.negative,
    seedMode: state.seedMode,
    seed: state.seed,
    videoProfile: {
      ratio: state.ratio,
      size: state.size,
      seconds: state.seconds,
    },
  };
}
