import type { GeneratorState } from "./types";

export function buildComfyPayloadFromState(state: GeneratorState) {
  return {
    preset: state.presetId,
    positivePrompt: state.prompt,
    negativePrompt: state.negative,
    videoProfile: {
      ratio: state.ratio,
      size: state.size,
      seconds: state.seconds,
    },
  };
}
