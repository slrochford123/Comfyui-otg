import {
  LTX25_INGREDIENTS_QUALIFIED_GRAPH_V1,
} from "@/lib/production/ltx25IngredientsQualifiedGraph";

export const LTX25_INGREDIENTS_WORKFLOW_VERSION =
  "ltx25-ingredients-qualified-2026-09-05-v1" as const;

export const LTX25_INGREDIENTS_WIDTH = 960 as const;
export const LTX25_INGREDIENTS_HEIGHT = 544 as const;
export const LTX25_INGREDIENTS_FPS = 24 as const;

/*
 * R13C source integration permits exactly 5- and 10-second Ingredients jobs.
 * Runtime smoke qualification is tracked separately; never infer any other
 * duration from frame-count arithmetic alone.
 */
export const LTX25_INGREDIENTS_QUALIFIED_DURATIONS = [5, 10] as const;

export type Ltx25IngredientsQualifiedDuration =
  (typeof LTX25_INGREDIENTS_QUALIFIED_DURATIONS)[number];

export type Ltx25IngredientsBackendId =
  | "rtx5060ti"
  | "rtx3090";

export type Ltx25IngredientsGraphNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

export type Ltx25IngredientsGraph =
  Record<string, Ltx25IngredientsGraphNode>;

export type BuildLtx25IngredientsWorkflowInput = {
  backend: Ltx25IngredientsBackendId;
  ingredientsSheetFilename: string;
  continuationFirstFrameFilename?: string;
  finalPrompt: string;
  negativePrompt?: string;
  durationSeconds: Ltx25IngredientsQualifiedDuration;
  seed: number;
  outputPrefix: string;
};

const TRANSFORMER =
  "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors";

const TEXT_ENCODER =
  "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors";

const VIDEO_VAE =
  "ltx-2.5-video-vae-bf16.safetensors";

const AUDIO_VAE =
  "ltx-2.5-audio-vae-bf16.safetensors";

const INGREDIENTS_LORA =
  "LTX-2.x/Control-and-Editing/"
  + "ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";

const DEFAULT_NEGATIVE_PROMPT = [
  "identity drift",
  "duplicate subject",
  "duplicate object",
  "deformed geometry",
  "flicker",
  "unintended text",
  "logo",
  "watermark",
].join(", ");

function cloneQualifiedGraph(): Ltx25IngredientsGraph {
  return JSON.parse(
    JSON.stringify(
      LTX25_INGREDIENTS_QUALIFIED_GRAPH_V1,
    ),
  ) as Ltx25IngredientsGraph;
}

function requiredNode(
  graph: Ltx25IngredientsGraph,
  id: string,
  classType: string,
) {
  const node = graph[id];

  if (!node || node.class_type !== classType) {
    throw new Error(
      `Qualified LTX 2.5 Ingredients graph node ${id} `
      + `must be ${classType}.`,
    );
  }

  return node;
}

function cleanFilename(value: unknown, label: string) {
  const text = String(value ?? "").trim();

  if (!text) {
    throw new Error(`${label} is required.`);
  }

  return text;
}

function cleanPrompt(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function safeSeed(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("LTX 2.5 Ingredients seed must be a non-negative number.");
  }

  return Math.floor(numeric);
}

export function ltx25IngredientsFrameCount(
  durationSeconds: Ltx25IngredientsQualifiedDuration,
) {
  if (
    !LTX25_INGREDIENTS_QUALIFIED_DURATIONS.includes(
      durationSeconds,
    )
  ) {
    throw new Error(
      `LTX 2.5 Ingredients duration ${durationSeconds}s `
      + "has not been production-qualified.",
    );
  }

  return durationSeconds * LTX25_INGREDIENTS_FPS + 1;
}

export function buildLtx25IngredientsWorkflow(
  input: BuildLtx25IngredientsWorkflowInput,
) {
  const graph = cloneQualifiedGraph();

  const sheetFilename = cleanFilename(
    input.ingredientsSheetFilename,
    "Ingredients sheet filename",
  );

  const continuationFirstFrameFilename =
    String(
      input.continuationFirstFrameFilename
      ?? "",
    ).trim();

  const finalPrompt = cleanPrompt(input.finalPrompt);

  if (!finalPrompt) {
    throw new Error(
      "LTX 2.5 Ingredients final prompt is required.",
    );
  }

  const outputPrefix = cleanFilename(
    input.outputPrefix,
    "LTX output prefix",
  );

  const seed = safeSeed(input.seed);

  const frames =
    ltx25IngredientsFrameCount(
      input.durationSeconds,
    );

  const loadImage =
    requiredNode(graph, "1", "LoadImage");

  const audioVae =
    requiredNode(graph, "2", "VAELoader");

  const videoVae =
    requiredNode(graph, "3", "VAELoader");

  const transformer =
    requiredNode(graph, "4", "UNETLoader");

  const clip =
    requiredNode(graph, "5", "CLIPLoader");

  const icLora =
    requiredNode(
      graph,
      "6",
      "LTXICLoRALoaderModelOnly",
    );

  const positive =
    requiredNode(graph, "7", "CLIPTextEncode");

  const negative =
    requiredNode(graph, "8", "CLIPTextEncode");

  const conditioning =
    requiredNode(graph, "9", "LTXVConditioning");

  const videoLatent =
    requiredNode(
      graph,
      "10",
      "EmptyLTXVLatentVideo",
    );

  const repeat =
    requiredNode(graph, "11", "RepeatImageBatch");

  const guide =
    requiredNode(
      graph,
      "12",
      "LTXAddVideoICLoRAGuide",
    );

  const audioLatent =
    requiredNode(
      graph,
      "13",
      "LTXVEmptyLatentAudio",
    );

  const cfg =
    requiredNode(graph, "15", "CFGGuider");

  const sampler =
    requiredNode(graph, "16", "KSamplerSelect");

  requiredNode(graph, "17", "ManualSigmas");

  const noise =
    requiredNode(graph, "18", "RandomNoise");

  const createVideo =
    requiredNode(graph, "24", "CreateVideo");

  const saveVideo =
    requiredNode(graph, "25", "SaveVideo");

  /*
   * Fixed qualified model contract.
   */
  transformer.inputs.unet_name = TRANSFORMER;
  transformer.inputs.weight_dtype = "default";

  clip.inputs.clip_name = TEXT_ENCODER;
  clip.inputs.type = "ltxv";

  videoVae.inputs.vae_name = VIDEO_VAE;
  audioVae.inputs.vae_name = AUDIO_VAE;

  icLora.inputs.lora_name = INGREDIENTS_LORA;
  icLora.inputs.strength_model = 1.3;

  sampler.inputs.sampler_name =
    "euler_ancestral_cfg_pp";

  cfg.inputs.cfg = 1.0;

  /*
   * Dynamic Production inputs.
   */
  loadImage.inputs.image = sheetFilename;

  positive.inputs.text = finalPrompt;

  negative.inputs.text =
    cleanPrompt(input.negativePrompt)
    || DEFAULT_NEGATIVE_PROMPT;

  conditioning.inputs.frame_rate =
    LTX25_INGREDIENTS_FPS;

  videoLatent.inputs.width =
    LTX25_INGREDIENTS_WIDTH;

  videoLatent.inputs.height =
    LTX25_INGREDIENTS_HEIGHT;

  videoLatent.inputs.length = frames;

  repeat.inputs.amount = frames;

  audioLatent.inputs.frames_number = frames;
  audioLatent.inputs.frame_rate =
    LTX25_INGREDIENTS_FPS;

  noise.inputs.noise_seed = seed;

  createVideo.inputs.fps =
    LTX25_INGREDIENTS_FPS;

  saveVideo.inputs.filename_prefix =
    outputPrefix;

  /*
   * These links are the key Ingredients behavior:
   * the reference sheet is repeated and fed to IC-LoRA guidance.
   * It is not used as a conventional first-frame I2V guide.
   */
  guide.inputs.image = ["11", 0];
  guide.inputs.latent = ["10", 0];
  guide.inputs.latent_downscale_factor = ["6", 1];
  guide.inputs.frame_idx = 0;
  guide.inputs.strength = 1.0;
  guide.inputs.crop = "disabled";

  /*
   * OTG_PRODUCTION_V2_LTX_CONTINUATION_FIRST_FRAME_V1
   *
   * The qualified Ingredients reference sheet remains on
   * the existing IC-LoRA image branch:
   *
   *   LoadImage(Ingredients)
   *     -> RepeatImageBatch
   *     -> LTXAddVideoICLoRAGuide.image
   *
   * A carried scene-tail frame is instead applied to the
   * original EmptyLTXVLatentVideo before the Ingredients
   * guide:
   *
   *   EmptyLTXVLatentVideo
   *     -> LTXVImgToVideoInplace
   *     -> LTXAddVideoICLoRAGuide.latent
   *
   * When no continuation filename is supplied these nodes
   * do not exist, preserving the exact qualified 25-node
   * base topology.
   */
  if (continuationFirstFrameFilename) {
    graph["26"] = {
      class_type:
        "LoadImage",

      inputs: {
        image:
          cleanFilename(
            continuationFirstFrameFilename,
            "LTX continuation first-frame filename",
          ),
      },
    };

    graph["27"] = {
      class_type:
        "LTXVImgToVideoInplace",

      inputs: {
        vae: ["3", 0],
        image: ["26", 0],
        latent: ["10", 0],
        strength: 1.0,
        bypass: false,
      },
    };

    guide.inputs.latent = ["27", 0];
  }

  return {
    backend: input.backend,
    graph,
    workflowId:
      LTX25_INGREDIENTS_WORKFLOW_VERSION,
    workflowFile:
      "qualified-inline/ltx25-ingredients-v1",
    nativeWidth:
      LTX25_INGREDIENTS_WIDTH,
    nativeHeight:
      LTX25_INGREDIENTS_HEIGHT,
    fps:
      LTX25_INGREDIENTS_FPS,
    frames,
    nativeAudio: true as const,
    preSubmitCleanup: null,
  };
}
