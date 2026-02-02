import type { GeneratorState } from "./types";

export type ComfySubmitPayloadV2 = {
  preset: string;
  positivePrompt: string;
  negativePrompt?: string;
  seedMode?: "random" | "fixed";
  seed?: number;
  useImg2Img?: boolean;
  forceImg2Img?: boolean;
  imagePath?: string;

  // New UI fields (safe: server ignores if unused)
  videoProfile?: {
    ratio: GeneratorState["ratio"];
    size: GeneratorState["size"];
  };
  seconds?: GeneratorState["seconds"];
};

export function buildComfySubmitPayloadFromState(state: GeneratorState): ComfySubmitPayloadV2 {
  return {
    preset: state.presetId,
    positivePrompt: state.prompt,
    negativePrompt: state.negative || "",
    videoProfile: { ratio: state.ratio, size: state.size },
    seconds: state.seconds,
  };
}
