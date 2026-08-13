import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";
import { getOwnerContext } from "@/lib/ownerKey";
import {
  isTelevisionAnimeStyleId,
  televisionAnimeStylePrompt,
  type TelevisionAnimeStyleId,
} from "@/lib/characters/televisionAnimeStyles";
import {
  isThreeDAnimationStyleId,
  threeDAnimationStylePrompt,
  type ThreeDAnimationStyleId,
} from "@/lib/characters/threeDAnimationStyles";
// OTG_CHARACTER_3D_ANIMATION_STYLES_PHASE11_ROUTE
import {
  claimCharacterCreateRequest,
  isCharacterCreateRequestId,
  markCharacterCreateRequestFailed,
  markCharacterCreateRequestSubmitted,
} from "@/lib/characters/characterCreateRequestStore";
// OTG_CHARACTER_TELEVISION_ANIME_STYLES_PHASE9_ROUTE
// OTG_CHARACTER_MOBILE_GENERATION_PERSISTENCE_PHASE10_ROUTE

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const MAGE_INTERNAL_WIDTH = 1088;
const BACKEND_PROBE_TIMEOUT_MS = 12_000;
const SUBMIT_TIMEOUT_MS = 30_000;

type CharacterCreateMode = "standard" | "freeform";
type CharacterCreateModelId =
  | "ernie-image"
  | "z-image"
  | "krea-2"
  | "boogu"
  | "mage-flow";
type CharacterStylePresetId =
  | "cartoon"
  | "anime"
  | "pixar-3d"
  | "unreal-engine"
  | "photorealistic"
  | "cinematic";

type ModelConfig = {
  id: CharacterCreateModelId;
  label: string;
  workflowFile: string;
  outputNodeId: string;
  requiredNodes: string[];
  requirements: {
    unet: string;
    clip: string;
    vae: string;
  };
  preferredBackend: "image-primary" | "local-3090";
};

const MODEL_CONFIG: Record<CharacterCreateModelId, ModelConfig> = {
  "ernie-image": {
    id: "ernie-image",
    label: "Ernie Image",
    workflowFile: "workflows/characters/create/image_ernie_image_turbo.json",
    outputNodeId: "73",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptyFlux2LatentImage",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "ernie-image-turbo.safetensors",
      clip: "ministral-3-3b.safetensors",
      vae: "flux2-vae.safetensors",
    },
    preferredBackend: "image-primary",
  },
  "z-image": {
    id: "z-image",
    label: "Z Image",
    workflowFile: "workflows/characters/create/image_z_image_turbo.json",
    outputNodeId: "9",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptySD3LatentImage",
      "ModelSamplingAuraFlow",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "z_image_turbo_bf16.safetensors",
      clip: "qwen_3_4b.safetensors",
      vae: "ae.safetensors",
    },
    preferredBackend: "image-primary",
  },
  "krea-2": {
    id: "krea-2",
    label: "Krea 2",
    workflowFile: "workflows/characters/create/image_krea2_turbo_t2i.json",
    outputNodeId: "29",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptyLatentImage",
      "ComfySwitchNode",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "krea2_turbo_fp8_scaled.safetensors",
      clip: "qwen3vl_4b_fp8_scaled.safetensors",
      vae: "qwen_image_vae.safetensors",
    },
    preferredBackend: "image-primary",
  },
  boogu: {
    id: "boogu",
    label: "Boogu",
    workflowFile: "workflows/characters/create/image_boogu_image_0_1_turbo_t2i.json",
    outputNodeId: "33",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "PreviewImage",
    ],
    requirements: {
      unet: "boogu_image_turbo_fp8_scaled.safetensors",
      clip: "qwen3vl_8b_fp8_scaled.safetensors",
      vae: "ae.safetensors",
    },
    preferredBackend: "image-primary",
  },
  "mage-flow": {
    id: "mage-flow",
    label: "Mage Flow",
    workflowFile: "workflows/characters/create/image_mage_flow_turbo_t2i_int8.json",
    outputNodeId: "10",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "TextEncodeMageFlowEdit",
      "KSampler",
      "VAEDecode",
      "ImageScale",
      "PreviewImage",
    ],
    requirements: {
      unet: "mage_flow_turbo_int8_convrot.safetensors",
      clip: "qwen3vl_4b_bf16.safetensors",
      vae: "mage_flow_vae_bf16.safetensors",
    },
    preferredBackend: "image-primary",
  },
};

const STYLE_PROMPTS: Record<CharacterStylePresetId, string> = {
  cartoon:
    "cartoon illustration, clean bold shape language, expressive readable features, polished character-design finish",
  anime:
    "anime character illustration, clear character shape, clean linework, stylized facial design, polished modern anime rendering",
  "pixar-3d":
    "family-friendly stylized 3D animated feature character render, appealing forms, polished materials, expressive face, studio-quality lighting",
  "unreal-engine":
    "high-end Unreal Engine character render, physically based materials, detailed real-time 3D lighting, production-quality game character presentation",
  photorealistic:
    "photorealistic character image, realistic anatomy and materials, natural skin or surface detail, realistic studio lighting, high fidelity",
  cinematic:
    "cinematic character image, dramatic film lighting, controlled contrast, atmospheric depth, premium production design, film-quality finish",
};

const STANDARD_CHARACTER_STRUCTURE_RULE = [
  "Create exactly one character.",
  "Show a full-body standing character in a neutral pose.",
  "The entire figure must be visible in frame from the top of the head to the bottom of the feet.",
  "Both arms must be fully visible.",
  "Both legs must be fully visible.",
  "The character must have exactly two arms and exactly two legs.",
  "Keep the body unobstructed and clearly readable.",
  "Use a full-body composition with enough space to include the whole character.",
  "Do not crop the head, hands, legs, or feet.",
  "Do not make a portrait, bust shot, half-body shot, close-up, or chibi character.",
  "Use long-shot full-figure framing, not portrait framing.",
  "Keep the camera far enough back to show the entire body.",
].join(" ");

const STANDARD_CHARACTER_NEGATIVE_PROMPT = [
  "cropped head",
  "cropped feet",
  "cropped hands",
  "out of frame",
  "partial body",
  "upper body only",
  "half body",
  "bust shot",
  "close-up",
  "portrait crop",
  "sitting pose",
  "kneeling pose",
  "curled pose",
  "chibi",
  "super-deformed",
  "extra arms",
  "extra legs",
  "missing arms",
  "missing legs",
  "hidden feet",
  "cut off limbs",
].join(", ");

const supportCache = new Map<
  string,
  { expiresAt: number; objectInfo: Record<string, any> }
>();

function normalizeBaseUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function imagePrimaryBaseUrl() {
  return normalizeBaseUrl(
    process.env.OTG_CHARACTER_IMAGE_COMFY_URL ||
      process.env.COMFYUI_IMAGE_URL ||
      process.env.COMFY_BASE_URL ||
      process.env.COMFYUI_URL ||
      "",
  );
}

function local3090BaseUrl(request: NextRequest) {
  return normalizeBaseUrl(
    process.env.OTG_CHARACTER_MAGE_COMFY_URL ||
      process.env.OTG_CHARACTER_IMAGE_FALLBACK_COMFY_URL ||
      `http://${request.nextUrl.hostname}:8188`,
  );
}

function randomSeed() {
  return randomInt(0, 281_474_976_710_000);
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function getNode(graph: Record<string, any>, id: string) {
  const node = graph[id];
  if (!node || typeof node !== "object") {
    throw new Error(`Workflow node ${id} is missing.`);
  }
  if (!node.inputs || typeof node.inputs !== "object") {
    node.inputs = {};
  }
  return node;
}

function setInput(
  graph: Record<string, any>,
  nodeId: string,
  key: string,
  value: unknown,
) {
  const node = getNode(graph, nodeId);
  node.inputs[key] = value;
}

function replaceOutputWithPreview(
  graph: Record<string, any>,
  nodeId: string,
  imageSource?: [string, number],
) {
  const current = getNode(graph, nodeId);
  const source =
    imageSource ||
    (Array.isArray(current.inputs?.images) ? current.inputs.images : null);

  if (!source) {
    throw new Error(`Workflow output node ${nodeId} has no image source.`);
  }

  graph[nodeId] = {
    inputs: { images: source },
    class_type: "PreviewImage",
    _meta: { title: "OTG Character Candidate Preview" },
  };
}

function loadWorkflow(config: ModelConfig) {
  const absolute = path.join(process.cwd(), config.workflowFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Character workflow file is missing: ${config.workflowFile}`);
  }
  return asRecord(JSON.parse(fs.readFileSync(absolute, "utf8")));
}

function negativePrompt(mode: CharacterCreateMode) {
  return mode === "standard" ? STANDARD_CHARACTER_NEGATIVE_PROMPT : "";
}

function buildPrompt(args: {
  description: string;
  mode: CharacterCreateMode;
  style: CharacterStylePresetId;
  televisionAnimeStyle: TelevisionAnimeStyleId;
  threeDAnimationStyle: ThreeDAnimationStyleId;
}) {
  const selectedArtStylePrompt = STYLE_PROMPTS[args.style];
  const televisionAnimePrompt =
    args.style === "anime"
      ? televisionAnimeStylePrompt(args.televisionAnimeStyle)
      : "";
  const threeDAnimationPrompt =
    args.style === "pixar-3d"
      ? threeDAnimationStylePrompt(args.threeDAnimationStyle)
      : "";

  return [
    args.mode === "standard" ? STANDARD_CHARACTER_STRUCTURE_RULE : "",
    args.description.trim(),
    selectedArtStylePrompt?.trim() || "",
    televisionAnimePrompt.trim(),
    threeDAnimationPrompt.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

function mutateWorkflow(args: {
  graph: Record<string, any>;
  config: ModelConfig;
  prompt: string;
  mode: CharacterCreateMode;
  seed: number;
}) {
  const { graph, config, prompt, mode, seed } = args;

  switch (config.id) {
    case "ernie-image":
      setInput(graph, "88:94", "value", prompt);
      setInput(graph, "88:96", "value", false);
      setInput(graph, "88:71", "width", OUTPUT_WIDTH);
      setInput(graph, "88:71", "height", OUTPUT_HEIGHT);
      setInput(graph, "88:70", "seed", seed);
      replaceOutputWithPreview(graph, config.outputNodeId);
      break;

    case "z-image":
      setInput(graph, "57:27", "text", prompt);
      setInput(graph, "57:13", "width", OUTPUT_WIDTH);
      setInput(graph, "57:13", "height", OUTPUT_HEIGHT);
      setInput(graph, "57:3", "seed", seed);
      replaceOutputWithPreview(graph, config.outputNodeId);
      break;

    case "krea-2":
      setInput(graph, "30:19", "value", prompt);
      setInput(graph, "30:24", "value", false);
      setInput(graph, "30:5", "width", OUTPUT_WIDTH);
      setInput(graph, "30:5", "height", OUTPUT_HEIGHT);
      setInput(graph, "30:3", "seed", seed);
      replaceOutputWithPreview(graph, config.outputNodeId);
      break;

    case "boogu":
      setInput(graph, "34:11", "text", prompt);
      setInput(graph, "34:8", "width", OUTPUT_WIDTH);
      setInput(graph, "34:8", "height", OUTPUT_HEIGHT);
      setInput(graph, "34:32", "seed", seed);
      replaceOutputWithPreview(graph, config.outputNodeId);
      break;

    case "mage-flow":
      setInput(graph, "12:5", "prompt", prompt);
      setInput(graph, "12:5", "negative_prompt", negativePrompt(mode));
      setInput(graph, "12:5", "width", MAGE_INTERNAL_WIDTH);
      setInput(graph, "12:5", "height", OUTPUT_HEIGHT);
      setInput(graph, "12:6", "seed", seed);

      graph["900001"] = {
        inputs: {
          upscale_method: "lanczos",
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          crop: "disabled",
          image: ["12:8", 0],
        },
        class_type: "ImageScale",
        _meta: { title: "OTG Exact 1080x1920 Output" },
      };

      replaceOutputWithPreview(graph, config.outputNodeId, ["900001", 0]);
      break;
  }

  return graph;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}.`);
    }
    return asRecord(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

async function objectInfo(baseUrl: string) {
  const cached = supportCache.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.objectInfo;

  const info = await fetchJsonWithTimeout(
    `${baseUrl}/object_info`,
    BACKEND_PROBE_TIMEOUT_MS,
  );

  supportCache.set(baseUrl, {
    expiresAt: Date.now() + 30_000,
    objectInfo: info,
  });
  return info;
}

function loaderChoices(
  info: Record<string, any>,
  loader: string,
  inputName: string,
) {
  const value = info?.[loader]?.input?.required?.[inputName]?.[0];
  return Array.isArray(value) ? value.map(String) : [];
}

async function validateBackend(baseUrl: string, config: ModelConfig) {
  if (!baseUrl) return { ok: false, reason: "Backend URL is not configured." };

  try {
    const info = await objectInfo(baseUrl);

    for (const node of config.requiredNodes) {
      if (!info[node]) {
        return { ok: false, reason: `Required ComfyUI node is missing: ${node}` };
      }
    }

    const unets = loaderChoices(info, "UNETLoader", "unet_name");
    const clips = loaderChoices(info, "CLIPLoader", "clip_name");
    const vaes = loaderChoices(info, "VAELoader", "vae_name");

    if (!unets.includes(config.requirements.unet)) {
      return { ok: false, reason: `Required diffusion model is missing: ${config.requirements.unet}` };
    }
    if (!clips.includes(config.requirements.clip)) {
      return { ok: false, reason: `Required text encoder is missing: ${config.requirements.clip}` };
    }
    if (!vaes.includes(config.requirements.vae)) {
      return { ok: false, reason: `Required VAE is missing: ${config.requirements.vae}` };
    }

    return { ok: true, reason: "" };
  } catch (error: any) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

async function chooseBackend(request: NextRequest, config: ModelConfig) {
  const imagePrimary = imagePrimaryBaseUrl();
  const local3090 = local3090BaseUrl(request);

  if (config.preferredBackend === "local-3090") {
    const probe = await validateBackend(local3090, config);
    if (!probe.ok) {
      throw new Error(
        `${config.label} requires the local 3090 Character backend, but it is unavailable: ${probe.reason}`,
      );
    }
    return { label: "local-3090", baseUrl: local3090, fallbackUsed: false };
  }

  const primaryProbe = await validateBackend(imagePrimary, config);
  if (primaryProbe.ok) {
    return { label: "image-primary", baseUrl: imagePrimary, fallbackUsed: false };
  }

  const fallbackProbe = await validateBackend(local3090, config);
  if (fallbackProbe.ok) {
    return {
      label: "local-3090-fallback",
      baseUrl: local3090,
      fallbackUsed: true,
      primaryFailure: primaryProbe.reason,
    };
  }

  throw new Error(
    `${config.label} is unavailable on both Character image backends. ` +
      `Image primary: ${primaryProbe.reason} Local 3090: ${fallbackProbe.reason}`,
  );
}

async function submitPrompt(baseUrl: string, graph: Record<string, any>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const response = await submitComfyPromptWith5060Lease({
      baseUrl,
      workerId: "api-character-create-image",
      init: {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: graph,
          client_id: `otg-character-${randomUUID()}`,
        }),
        signal: controller.signal,
      },
    });

    const text = await response.text();
    let json: Record<string, any> = {};
    try {
      json = text ? asRecord(JSON.parse(text)) : {};
    } catch {
      json = {};
    }

    if (!response.ok) {
      throw new Error(
        String(
          json?.error ||
            json?.node_errors ||
            text ||
            `ComfyUI prompt submission failed (${response.status}).`,
        ),
      );
    }

    const promptId = String(json.prompt_id || json.promptId || "").trim();
    if (!promptId) {
      throw new Error("ComfyUI accepted the request but returned no prompt id.");
    }
    return promptId;
  } finally {
    clearTimeout(timer);
  }
}

function validModel(value: unknown): value is CharacterCreateModelId {
  return Object.prototype.hasOwnProperty.call(MODEL_CONFIG, String(value || ""));
}

function validStyle(value: unknown): value is CharacterStylePresetId {
  return Object.prototype.hasOwnProperty.call(STYLE_PROMPTS, String(value || ""));
}

function validTelevisionAnimeStyle(
  value: unknown,
): value is TelevisionAnimeStyleId {
  return isTelevisionAnimeStyleId(value);
}

function validThreeDAnimationStyle(
  value: unknown,
): value is ThreeDAnimationStyleId {
  return isThreeDAnimationStyleId(value);
}

function validMode(value: unknown): value is CharacterCreateMode {
  return value === "standard" || value === "freeform";
}

export async function POST(request: NextRequest) {
  let persistentRequestId = "";
  try {
    // Authentication may consume the incoming Request body.
    // Clone it first so JSON parsing has an independent stream.
    const bodyRequest = request.clone();

    await getOwnerContext(request);
    const body = asRecord(await bodyRequest.json());

    if (!validModel(body.model)) {
      return NextResponse.json({ ok: false, error: "Invalid Character image model." }, { status: 400 });
    }
    if (!validStyle(body.style)) {
      return NextResponse.json({ ok: false, error: "Invalid Character art style." }, { status: 400 });
    }
    const televisionAnimeStyleValue = String(
      body.televisionAnimeStyle || "default",
    );
    if (!validTelevisionAnimeStyle(televisionAnimeStyleValue)) {
      return NextResponse.json(
        { ok: false, error: "Invalid Television Anime art style." },
        { status: 400 },
      );
    }
    const televisionAnimeStyle: TelevisionAnimeStyleId =
      body.style === "anime" ? televisionAnimeStyleValue : "default";
    const threeDAnimationStyleValue = String(
      body.threeDAnimationStyle || "default",
    );
    if (!validThreeDAnimationStyle(threeDAnimationStyleValue)) {
      return NextResponse.json(
        { ok: false, error: "Invalid 3D Animation art style." },
        { status: 400 },
      );
    }
    const threeDAnimationStyle: ThreeDAnimationStyleId =
      body.style === "pixar-3d" ? threeDAnimationStyleValue : "default";

    if (!validMode(body.mode)) {
      return NextResponse.json({ ok: false, error: "Invalid Character creation mode." }, { status: 400 });
    }

    const description = String(body.description || "").trim();
    if (!description) {
      return NextResponse.json({ ok: false, error: "Character description is required." }, { status: 400 });
    }
    if (description.length > 4000) {
      return NextResponse.json({ ok: false, error: "Character description is too long." }, { status: 400 });
    }

    const config = MODEL_CONFIG[body.model];
    const seed = randomSeed();
    const clientRequestId = String(body.clientRequestId || randomUUID()).trim();
    if (!isCharacterCreateRequestId(clientRequestId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid Character create request id." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    persistentRequestId = clientRequestId;

    const persistentTelevisionAnimeStyle =
      body.style === "anime"
        ? String(body.televisionAnimeStyle || "default").trim() || "default"
        : "default";
    const persistentThreeDAnimationStyle =
      body.style === "pixar-3d" ? threeDAnimationStyle : "default";
    const claim = claimCharacterCreateRequest({
      requestId: clientRequestId,
      model: body.model,
      modelLabel: config.label,
      style: body.style,
      televisionAnimeStyle: persistentTelevisionAnimeStyle,
      threeDAnimationStyle: persistentThreeDAnimationStyle,
      mode: body.mode,
      seed,
      outputNodeId: config.outputNodeId,
    });

    if (!claim.claimed) {
      if (claim.record.status === "submitted" && claim.record.promptId) {
        return NextResponse.json(
          {
            ok: true,
            clientRequestId: claim.record.requestId,
            promptId: claim.record.promptId,
            prompt_id: claim.record.promptId,
            model: claim.record.model,
            modelLabel: claim.record.modelLabel,
            style: claim.record.style,
            televisionAnimeStyle: claim.record.televisionAnimeStyle,
            threeDAnimationStyle: claim.record.threeDAnimationStyle || "default",
            mode: claim.record.mode,
            seed: claim.record.seed,
            width: OUTPUT_WIDTH,
            height: OUTPUT_HEIGHT,
            orientation: "portrait",
            aspectRatio: "9:16",
            outputNodeId: claim.record.outputNodeId,
            comfyBaseUrl: claim.record.comfyBaseUrl || "",
            backend: claim.record.backend || "",
            fallbackUsed: Boolean(claim.record.fallbackUsed),
            temporaryCandidate: true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (claim.record.status === "submitting") {
        return NextResponse.json(
          { ok: true, pending: true, status: "submitting", clientRequestId },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          clientRequestId,
          error: claim.record.error || "Character generation request failed.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const prompt = buildPrompt({
      description,
      mode: body.mode,
      style: body.style,
      televisionAnimeStyle,
      threeDAnimationStyle,
    });
    const graph = mutateWorkflow({
      graph: loadWorkflow(config),
      config,
      prompt,
      mode: body.mode,
      seed,
    });

    // Backend selection completes before POST /prompt. Never fail over after
    // submission begins; a lost HTTP response could otherwise duplicate work.
    const backend = await chooseBackend(request, config);
    const promptId = await submitPrompt(backend.baseUrl, graph);
    markCharacterCreateRequestSubmitted(clientRequestId, {
      promptId,
      comfyBaseUrl: backend.baseUrl,
      backend: backend.label,
      fallbackUsed: backend.fallbackUsed,
    });

    return NextResponse.json(
      {
        ok: true,
        clientRequestId,
        promptId,
        prompt_id: promptId,
        model: config.id,
        modelLabel: config.label,
        style: body.style,
        televisionAnimeStyle,
        threeDAnimationStyle,
        mode: body.mode,
        seed,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        orientation: "portrait",
        aspectRatio: "9:16",
        outputNodeId: config.outputNodeId,
        comfyBaseUrl: backend.baseUrl,
        backend: backend.label,
        fallbackUsed: backend.fallbackUsed,
        temporaryCandidate: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const message = error?.message || String(error);
    if (persistentRequestId) {
      try {
        markCharacterCreateRequestFailed(persistentRequestId, message);
      } catch {
        // Preserve the original generation error if request-state persistence fails.
      }
    }
    const status = /session|auth|unauthor/i.test(message) ? 401 : 502;
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
