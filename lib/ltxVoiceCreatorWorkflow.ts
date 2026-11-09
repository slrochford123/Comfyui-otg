const NEGATIVE_PROMPT =
  "music, background music, singing, crowd, multiple speakers, overlapping speech, ambient noise, unrelated sound effects, clipping, distortion, unintelligible speech, captions, subtitles";

export function patchProviderWorkflow(input: {
  workflow: Record<string, any>;
  provider: "ltx25";
  prompt: string;
  durationSeconds: number;
  seed: number;
  outputPrefix: string;
}) {
  const workflow = input.workflow;

  if (
    !workflow?.["432"]?.inputs ||
    !workflow?.["433"]?.inputs ||
    !workflow?.["450"]?.inputs ||
    !workflow?.["429"]?.inputs ||
    !workflow?.["421"]?.inputs ||
    !workflow?.["455"]?.inputs
  ) {
    throw new Error(
      "LTX 2.5 workflow contract is missing required nodes 432/433/450/429/421/455.",
    );
  }

  workflow["432"].inputs.text = input.prompt;
  workflow["433"].inputs.text = NEGATIVE_PROMPT;
  workflow["450"].inputs.value = input.durationSeconds;
  workflow["429"].inputs.noise_seed = input.seed;
  workflow["421"].inputs.noise_seed =
    (input.seed + 104_729) % 900_000_000_000_000;
  workflow["455"].class_type = "SaveAudio";
  workflow["455"]._meta = { title: "Save Audio (WAV)" };
  workflow["455"].inputs = {
    filename_prefix: input.outputPrefix,
    audio: workflow["455"].inputs.audio || ["417", 0],
  };

  return workflow;
}
