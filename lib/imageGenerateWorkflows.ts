export type GenerateMediaMode = "image" | "video";
export type ImageOperation = "create" | "edit" | "anime";
export type ImageOrientation = "portrait" | "landscape";

export type ImageModelDefinition = {
  id: string;
  label: string;
  operation: ImageOperation;
  maxInputImages: 0 | 1 | 3;
  defaultLora: string | null;
  optionalLoras: ImageLoraDefinition[];
};

export type ImageLoraDefinition = {
  name: string;
  label: string;
  strength: number;
  mature: boolean;
  description: string;
  usage: string;
};

export type ImageLoraSelection = { name: string; strength?: number };

export const IMAGE_LORA_MAX_SELECTIONS = 3;
export const IMAGE_LORA_ADULT_ACK_VERSION = "image-lora-adult-v1";

export const LOCKED_IMAGE_SIZES: Record<ImageOrientation, { width: number; height: number }> = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
};

export const IMAGE_OPERATION_LABELS: Record<ImageOperation, string> = {
  create: "Create an Image",
  edit: "Edit an Image",
  anime: "Create an Anime Image",
};

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: "presets/image_ernie_image_turbo",
    label: "Ernie Image Turbo",
    operation: "create",
    maxInputImages: 0,
    defaultLora: null,
    optionalLoras: [
      {
        name: "ernie-image-prompt-enhancer.safetensors",
        label: "Ernie Prompt Enhancer",
        strength: 1,
        mature: false,
        description: "Adds the installed Ernie prompt-enhancement adapter.",
        usage: "Start at strength 1.0 and describe the subject, scene, lighting, and style clearly.",
      },
    ],
  },
  {
    id: "presets/image_z_image_turbo",
    label: "Z Image Turbo",
    operation: "create",
    maxInputImages: 0,
    defaultLora: null,
    optionalLoras: [
      {
        name: "Z-Turbo/Mystic-XXX-ZIT-V7.safetensors",
        label: "Mystic XXX ZIT V7",
        strength: 0.8,
        mature: true,
        description: "Mature-content style adapter for Z Image Turbo.",
        usage: "Start at 0.8; reduce the strength if the style overwhelms the prompt.",
      },
      {
        name: "Z-Turbo/ZITnsfwLoRAv3.safetensors",
        label: "ZIT NSFW LoRA v3",
        strength: 0.8,
        mature: true,
        description: "Mature-content adapter trained for Z Image Turbo.",
        usage: "Start at 0.8 and use a direct, detailed positive prompt.",
      },
      {
        name: "Z-Turbo/pornmasterZImage_turboV35Bf16.safetensors",
        label: "Pornmaster Z Image Turbo v3.5",
        strength: 0.75,
        mature: true,
        description: "Large mature-content adapter for Z Image Turbo.",
        usage: "Start at 0.75. Use alone first before combining it with another LoRA.",
      },
      {
        name: "zit/block_11.safetensors",
        label: "ZIT Block 11",
        strength: 1,
        mature: false,
        description: "Installed Z Image Turbo model adapter.",
        usage: "Use at 1.0 unless testing shows the adapter is too strong.",
      },
    ],
  },
  {
    id: "presets/image_krea2_turbo_t2i",
    label: "Krea 2 Turbo",
    operation: "create",
    maxInputImages: 0,
    defaultLora: null,
    optionalLoras: [
      {
        name: "krea2_darkbrush.safetensors",
        label: "Darkbrush",
        strength: 0.8,
        mature: false,
        description: "Dark, painterly brush style for Krea 2 Turbo.",
        usage: "Start at 0.8 and include the desired medium, lighting, and color palette.",
      },
      {
        name: "krea/KREA2turboNSFW.safetensors",
        label: "Krea 2 Turbo NSFW",
        strength: 0.8,
        mature: true,
        description: "Mature-content adapter for Krea 2 Turbo.",
        usage: "Start at 0.8; lower the strength when combining it with another Krea LoRA.",
      },
      {
        name: "krea/MysticXXX_KREA2_v2.safetensors",
        label: "Mystic XXX Krea 2 v2",
        strength: 0.8,
        mature: true,
        description: "Mature-content style adapter for Krea 2 Turbo.",
        usage: "Start at 0.8 and use a specific positive prompt for composition and lighting.",
      },
    ],
  },
  {
    id: "presets/image_boogu_image_0_1_turbo_t2i",
    label: "Boogu Image 0.1 Turbo",
    operation: "create",
    maxInputImages: 0,
    defaultLora: null,
    optionalLoras: [],
  },
  {
    id: "presets/image_anima_base_v1",
    label: "Anima Base V1",
    operation: "anime",
    maxInputImages: 0,
    defaultLora: null,
    optionalLoras: [],
  },
  {
    id: "presets/image_qwen_image_edit_2511_int8",
    label: "Qwen Image Edit 2511 INT8",
    operation: "edit",
    maxInputImages: 3,
    defaultLora: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    optionalLoras: [],
  },
  {
    id: "presets/image_firered_image_edit1_1",
    label: "FireRed Image Edit 1.1",
    operation: "edit",
    maxInputImages: 3,
    defaultLora: "FireRed-Image-Edit-1.0-Lightning-8steps-v1.0.safetensors",
    optionalLoras: [],
  },
  {
    id: "presets/image_qwen_image_edit",
    label: "Qwen Image Edit",
    operation: "edit",
    maxInputImages: 1,
    defaultLora: "Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors",
    optionalLoras: [],
  },
];

export function imageModelsForOperation(operation: ImageOperation) {
  return IMAGE_MODELS.filter((model) => model.operation === operation);
}

export function imageModelById(id: string | null | undefined) {
  return IMAGE_MODELS.find((model) => model.id === String(id || "")) || null;
}

function safeLoraStrength(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.min(2, numberValue)) : fallback;
}

export function resolveImageLoraSelections(
  model: ImageModelDefinition,
  selections: ImageLoraSelection[] | null | undefined,
) {
  const requested = Array.isArray(selections) ? selections : [];
  if (requested.length > IMAGE_LORA_MAX_SELECTIONS) {
    return { ok: false as const, error: `A maximum of ${IMAGE_LORA_MAX_SELECTIONS} LoRAs may be selected.` };
  }

  const allowed = new Map(model.optionalLoras.map((lora) => [lora.name.toLowerCase(), lora]));
  const seen = new Set<string>();
  const resolved: Array<ImageLoraDefinition & { selectedStrength: number }> = [];

  for (const selection of requested) {
    const requestedName = String(selection?.name || "").trim();
    const key = requestedName.toLowerCase();
    if (!requestedName || seen.has(key)) {
      return { ok: false as const, error: "LoRA selections must be non-empty and unique." };
    }
    const definition = allowed.get(key);
    if (!definition) {
      return { ok: false as const, error: `LoRA ${requestedName} is not compatible with ${model.label}.` };
    }
    seen.add(key);
    resolved.push({ ...definition, selectedStrength: safeLoraStrength(selection.strength, definition.strength) });
  }

  return { ok: true as const, selections: resolved };
}

export function applyImageLoraSelections(
  graph: Record<string, any>,
  model: ImageModelDefinition,
  selections: ImageLoraSelection[] | null | undefined,
) {
  const resolution = resolveImageLoraSelections(model, selections);
  if (!resolution.ok) return resolution;
  if (!resolution.selections.length) {
    applyOptionalLoraSwitches(graph, []);
    return { ok: true as const, applied: 0, selections: resolution.selections };
  }

  const selectedNames = resolution.selections.map((selection) => selection.name);
  applyOptionalLoraSwitches(graph, selectedNames);

  const authoredSelections = new Set<string>();
  for (const node of Object.values<any>(graph || {})) {
    if (String(node?.class_type || "") !== "ComfySwitchNode" || !node?.inputs?.switch) continue;
    const trueLink = node.inputs.on_true;
    const loraNode = Array.isArray(trueLink) ? graph[String(trueLink[0])] : null;
    if (String(loraNode?.class_type || "") === "LoraLoaderModelOnly") {
      const authoredName = String(loraNode?.inputs?.lora_name || "").toLowerCase();
      const selected = resolution.selections.find((selection) => selection.name.toLowerCase() === authoredName);
      if (selected) {
        loraNode.inputs.strength_model = selected.selectedStrength;
        authoredSelections.add(authoredName);
      }
    }
  }

  const toAppend = resolution.selections.filter((selection) => !authoredSelections.has(selection.name.toLowerCase()));
  if (!toAppend.length) {
    return { ok: true as const, applied: authoredSelections.size, selections: resolution.selections };
  }

  const samplers = Object.values<any>(graph || {}).filter((node) =>
    /sampler/i.test(String(node?.class_type || "")) && Array.isArray(node?.inputs?.model)
  );
  if (!samplers.length) {
    return { ok: false as const, error: `Unable to attach LoRAs to ${model.label}: no sampler model input was found.` };
  }

  let applied = authoredSelections.size;
  samplers.forEach((sampler, samplerIndex) => {
    let previousModel = sampler.inputs.model as [string, number];
    toAppend.forEach((selection, loraIndex) => {
      const nodeId = `otg_image_lora_${samplerIndex + 1}_${loraIndex + 1}`;
      graph[nodeId] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          model: previousModel,
          lora_name: selection.name,
          strength_model: selection.selectedStrength,
        },
        _meta: { title: `OTG Image LoRA ${loraIndex + 1}` },
      };
      previousModel = [nodeId, 0];
      applied += 1;
    });
    sampler.inputs.model = previousModel;
  });

  return { ok: true as const, applied, selections: resolution.selections };
}

export function applyLockedImageSize(graph: Record<string, any>, orientation: ImageOrientation) {
  const size = LOCKED_IMAGE_SIZES[orientation];
  let applied = 0;
  for (const node of Object.values(graph || {})) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    const classType = String(node.class_type || "");
    if (!/^Empty.*LatentImage$/i.test(classType)) continue;
    node.inputs.width = size.width;
    node.inputs.height = size.height;
    if ("batch_size" in node.inputs) node.inputs.batch_size = 1;
    applied += 1;
  }
  return { ...size, applied };
}

export function applyEditImageReferences(graph: Record<string, any>, inputImages: string[], maxImages: 1 | 3) {
  const images = inputImages.map(String).map((value) => value.trim()).filter(Boolean).slice(0, maxImages);
  const loadNodes = Object.entries<any>(graph || {}).filter(([, node]) => node?.class_type === "LoadImage");
  if (images[0] && loadNodes[0]) loadNodes[0][1].inputs.image = images[0];

  const plusEncoders = Object.values<any>(graph || {}).filter((node) =>
    String(node?.class_type || "").includes("TextEncodeQwenImageEditPlus")
  );
  if (!plusEncoders.length || maxImages === 1) return { applied: images.length ? 1 : 0, maxImages: 1 };

  for (let index = 1; index < images.length; index += 1) {
    const nodeId = `otg_edit_reference_${index + 1}`;
    graph[nodeId] = {
      class_type: "LoadImage",
      inputs: { image: images[index] },
      _meta: { title: `OTG Edit Reference ${index + 1}` },
    };
    for (const encoder of plusEncoders) encoder.inputs[`image${index + 1}`] = [nodeId, 0];
  }

  for (const encoder of plusEncoders) {
    for (let index = images.length; index < 3; index += 1) delete encoder.inputs[`image${index + 1}`];
  }
  return { applied: images.length, maxImages: 3 };
}

export function applyOptionalLoraSwitches(graph: Record<string, any>, selectedLoraNames: string[]) {
  const selected = new Set(selectedLoraNames.map((name) => String(name).toLowerCase()));
  let changed = 0;
  for (const node of Object.values<any>(graph || {})) {
    if (String(node?.class_type || "") !== "ComfySwitchNode" || !node?.inputs) continue;
    const trueLink = node.inputs.on_true;
    if (!Array.isArray(trueLink)) continue;
    const loraNode = graph[String(trueLink[0])];
    if (String(loraNode?.class_type || "") !== "LoraLoaderModelOnly") continue;
    const name = String(loraNode?.inputs?.lora_name || "").toLowerCase();
    node.inputs.switch = selected.has(name);
    changed += 1;
  }
  return changed;
}
