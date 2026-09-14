import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";
import { buildInternalSourceProxyFetch } from "./internalSourceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const SOURCE_FETCH_TIMEOUT_MS = 30_000;

function decodeSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlash(value: string) {
  return String(value || "").replace(/\\/g, "/");
}

function stripComfyTypeSuffix(value: string) {
  return String(value || "")
    .replace(/\s\[(output|input|temp)\]$/i, "")
    .trim();
}

function parseImageReference(value: string) {
  const raw = String(value || "").trim();
  let parsed: URL | null = null;

  try {
    parsed = new URL(raw, "http://otg.local");
  } catch {
    parsed = null;
  }

  const filename = parsed?.searchParams.get("filename") || "";
  const sourcePath = parsed?.searchParams.get("path") || "";
  const promptId = parsed?.searchParams.get("promptId") || "";
  const comfyBaseUrl = parsed?.searchParams.get("comfyBaseUrl") || "";

  return {
    raw,
    parsed,
    filename: decodeSafe(filename),
    sourcePath: decodeSafe(sourcePath),
    promptId: decodeSafe(promptId),
    comfyBaseUrl: decodeSafe(comfyBaseUrl),
  };
}

function cleanImageValue(value: string) {
  const reference = parseImageReference(value);
  let text = reference.sourcePath || reference.filename || decodeSafe(reference.raw);

  text = decodeSafe(text).replace(/\?.*$/, "").trim();
  text = stripComfyTypeSuffix(text);
  return normalizeSlash(text);
}

function cleanFilename(value: string) {
  const clean = cleanImageValue(value);
  const filename = clean.split("/").filter(Boolean).pop() || "";
  const ext = path.extname(filename).toLowerCase();

  if (!filename || !IMAGE_EXTENSIONS.has(ext)) return "";
  return filename;
}

function contentTypeFor(filename: string) {
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";

  return "application/octet-stream";
}

function uniqueList(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;

    const normalized = path.normalize(text);
    const key = normalized.toLowerCase();

    if (seen.has(key)) continue;

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function comfyBaseUrl() {
  const value =
    process.env.BACKGROUND_ANGLE_PLATE_COMFYUI_BASE_URL ||
    process.env.OTG_BACKGROUND_COMFYUI_BASE_URL ||
    process.env.COMFYUI_IMAGE_URL ||
    process.env.NEXT_PUBLIC_BACKGROUND_COMFYUI_URL ||
    "http://127.0.0.1:8188";

  return String(value).replace(/\/+$/, "");
}

function sourceRoots() {
  const comfyRoot =
    process.env.COMFYUI_ROOT_DIR ||
    process.env.COMFY_ROOT_DIR ||
    process.env.OTG_COMFY_ROOT_DIR ||
    "";

  const dataRoot =
    process.env.OTG_DATA_ROOT ||
    process.env.OTG_DATA_DIR ||
    "";

  return uniqueList([
    process.env.COMFYUI_OUTPUT_DIR,
    process.env.COMFY_OUTPUT_DIR,
    process.env.OTG_COMFY_OUTPUT_DIR,
    comfyRoot ? path.join(comfyRoot, "output") : "",
    dataRoot,
    "/home/shawn-rochford/AI/ComfyUI/ComfyUI/output",
    "/home/shawn-rochford/AI/ComfyUI/output",
    "/opt/ComfyUI/output",
    "/mnt/otg_fast/comfyui/output",
                ]);
}

async function existsFile(filePath: string) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isInsideRoot(root: string, filePath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedFile = path.resolve(filePath);
  const relative = path.relative(normalizedRoot, normalizedFile);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveSourceImagePath(value: string) {
  const clean = cleanImageValue(value);
  const filename = cleanFilename(clean);

  if (!filename) return "";

  if (path.isAbsolute(clean)) {
    for (const root of sourceRoots()) {
      const candidate = path.normalize(clean);
      if (isInsideRoot(root, candidate) && await existsFile(candidate)) {
        return candidate;
      }
    }
  }

  for (const root of sourceRoots()) {
    const candidate = path.join(root, filename);
    if (isInsideRoot(root, candidate) && await existsFile(candidate)) {
      return candidate;
    }
  }

  return "";
}

function safeSlug(value: string) {
  return String(value || "background")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "background";
}

function safeUploadName(filename: string) {
  const ext = path.extname(filename).toLowerCase() || ".png";
  const base = safeSlug(path.basename(filename, ext));
  return `otg-angle-source-${base}-${Date.now().toString(36)}${ext}`;
}

type LoadedSourceImage = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  sourcePath: string;
  sourceUrl: string;
  sourcePromptId: string;
  sourceComfyBaseUrl: string;
};

async function fetchSourceImageFromProxy(request: NextRequest, sourceValue: string): Promise<LoadedSourceImage> {
  const reference = parseImageReference(sourceValue);
  const { sourceUrl, fetchUrl, headers } = buildInternalSourceProxyFetch({
    requestOrigin: request.nextUrl.origin,
    sourceValue,
    requestHeaders: request.headers,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(fetchUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error(
        `Internal OTG image proxy fetch timed out for ${sourceUrl.pathname}.`,
      );
    }

    throw new Error(
      `Internal OTG image proxy fetch failed for ${sourceUrl.pathname} through the local Next.js origin.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail ||
        `Internal OTG image proxy returned HTTP ${response.status} for ${sourceUrl.pathname}.`,
    );
  }

  const responseContentType = String(response.headers.get("content-type") || "").split(";")[0].trim();
  if (responseContentType && !responseContentType.startsWith("image/")) {
    throw new Error(`Selected preview returned non-image content: ${responseContentType}.`);
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error("Selected preview returned an empty image.");
  }

  const responseFilename = response.headers.get("x-otg-comfy-filename") || "";
  const filename =
    cleanFilename(reference.filename) ||
    cleanFilename(responseFilename) ||
    `background-source-${Date.now().toString(36)}.png`;

  return {
    bytes: new Uint8Array(buffer),
    filename,
    contentType: responseContentType || contentTypeFor(filename),
    sourcePath: "",
    sourceUrl: sourceUrl.pathname + sourceUrl.search,
    sourcePromptId: reference.promptId,
    sourceComfyBaseUrl: reference.comfyBaseUrl,
  };
}

async function loadSourceImage(request: NextRequest, sourceValue: string): Promise<LoadedSourceImage> {
  const reference = parseImageReference(sourceValue);
  const sourcePath = await resolveSourceImagePath(sourceValue);

  if (sourcePath) {
    const bytes = await readFile(sourcePath);
    const filename = path.basename(sourcePath);

    return {
      bytes: new Uint8Array(bytes),
      filename,
      contentType: contentTypeFor(filename),
      sourcePath,
      sourceUrl: "",
      sourcePromptId: reference.promptId,
      sourceComfyBaseUrl: reference.comfyBaseUrl,
    };
  }

  return fetchSourceImageFromProxy(request, sourceValue);
}

async function loadAngleWorkflow() {
  const candidates = [
    path.join(process.cwd(), "workflows", "backgrounds", "qwen-background-angle-plate.json"),
    path.join(process.cwd(), "app", "workflows", "backgrounds", "qwen-background-angle-plate.json"),
  ];

  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, "utf8");
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      // Try next.
    }
  }

  throw new Error("Could not read workflows/backgrounds/qwen-background-angle-plate.json");
}

function setNodeInput(workflow: any, nodeId: string, inputName: string, value: any) {
  const node = workflow?.[nodeId];

  if (!node || typeof node !== "object") {
    throw new Error(`Workflow node not found: ${nodeId}`);
  }

  if (!node.inputs || typeof node.inputs !== "object") {
    node.inputs = {};
  }

  node.inputs[inputName] = value;
}

// OTG_BACKGROUND_CANONICAL_DIRECTIONALS_V36B
const CANONICAL_DIRECTIONAL_OUTPUTS_V36B = {
  left: {
    nodeId: "47",
    promptNodeId: "72",
    suffix: "left90",
  },
  right: {
    nodeId: "38",
    promptNodeId: "68",
    suffix: "right90",
  },
  rear: {
    nodeId: "34",
    promptNodeId: "67",
    suffix: "rear180",
  },
  up: {
    nodeId: "41",
    promptNodeId: "70",
    suffix: "up",
  },
  down: {
    nodeId: "43",
    promptNodeId: "71",
    suffix: "down",
  },
} as const;

const GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C = Object.keys(
  CANONICAL_DIRECTIONAL_OUTPUTS_V36B,
).length;
const FINAL_BACKGROUND_CARD_DIRECTION_COUNT_V36C =
  GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C + 1;

function collectWorkflowAncestorsV36C(
  workflow: any,
  nodeId: string,
  retainedNodeIds: Set<string>,
) {
  if (retainedNodeIds.has(nodeId)) return;

  const node = workflow?.[nodeId];
  if (!node || typeof node !== "object") return;

  retainedNodeIds.add(nodeId);

  const visitInput = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "string" &&
      workflow?.[value[0]]
    ) {
      collectWorkflowAncestorsV36C(
        workflow,
        value[0],
        retainedNodeIds,
      );
      return;
    }

    if (Array.isArray(value)) {
      for (const child of value) visitInput(child);
      return;
    }

    if (value && typeof value === "object") {
      for (const child of Object.values(value)) visitInput(child);
    }
  };

  visitInput(node.inputs);
}

function retainCanonicalDirectionalOutputsV36C(workflow: any) {
  const keep = new Set<string>(
    Object.values(CANONICAL_DIRECTIONAL_OUTPUTS_V36B).map(
      (entry) => entry.nodeId,
    ),
  );
  let removedPreviewOutputCount = 0;
  let removedSaveOutputCount = 0;

  for (
    const [nodeId, node] of Object.entries(workflow || {}) as Array<
      [string, any]
    >
  ) {
    if (!node || typeof node !== "object") continue;

    // PreviewImage is an executable ComfyUI output node. The source template
    // contains eight of them, so retaining them alongside the five canonical
    // SaveImage branches produces the misleading 13-image result.
    if (node.class_type === "PreviewImage") {
      delete workflow[nodeId];
      removedPreviewOutputCount += 1;
      continue;
    }

    if (node.class_type !== "SaveImage" || keep.has(nodeId)) continue;

    delete workflow[nodeId];
    removedSaveOutputCount += 1;
  }

  const retainedNodeIds = new Set<string>();
  for (const nodeId of keep) {
    collectWorkflowAncestorsV36C(
      workflow,
      nodeId,
      retainedNodeIds,
    );
  }

  let removedUnusedNodeCount = 0;
  for (const nodeId of Object.keys(workflow || {})) {
    if (retainedNodeIds.has(nodeId)) continue;
    delete workflow[nodeId];
    removedUnusedNodeCount += 1;
  }

  const remainingOutputNodeIds = Object.entries(workflow || {})
    .filter(([, node]) => {
      const outputNode = node as any;
      return outputNode?.class_type === "SaveImage" ||
        outputNode?.class_type === "PreviewImage";
    })
    .map(([nodeId]) => nodeId);

  if (
    remainingOutputNodeIds.length !== GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C ||
    remainingOutputNodeIds.some((nodeId) => !keep.has(nodeId))
  ) {
    throw new Error(
      `Canonical directional workflow must contain exactly ${GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C} generated outputs. Found: ${remainingOutputNodeIds.join(", ") || "none"}.`,
    );
  }

  return {
    removedPreviewOutputCount,
    removedSaveOutputCount,
    removedUnusedNodeCount,
    remainingNodeCount: Object.keys(workflow || {}).length,
    remainingOutputNodeIds,
  };
}

function canonicalDirectionalFilenamePrefixV36B(
  filenamePrefix: string,
  suffix: string,
) {
  return `${filenamePrefix}-${suffix}`;
}

function randomizeSamplerSeeds(workflow: any) {
  for (const node of Object.values(workflow || {}) as any[]) {
    if (!node || typeof node !== "object") continue;
    if (node.class_type !== "KSampler") continue;

    if (!node.inputs || typeof node.inputs !== "object") {
      node.inputs = {};
    }

    node.inputs.seed = Math.floor(Math.random() * 9007199254740991);
  }
}

// OTG_BACKGROUND_CANONICAL_DIRECTION_GEOMETRY_PP06_V1
function applyCanonicalDirectionalSourceGraphV1(workflow: any) {
  // The Multiple-Angles LoRA is strongest at a direct +/-90-degree
  // camera rotation. Build Back cumulatively:
  //
  // Front -> Left 90 -> another Left 90 -> Back 180.
  //
  // Rear branch input scaler:
  //   65:35:82
  //
  // Left-90 decoded result:
  //   65:40:107
  //
  // This creates a true graph dependency rather than asking the model
  // to infer a 180-degree reversal directly from Front.
  setNodeInput(
    workflow,
    "65:35:82",
    "image",
    ["65:40:107", 0],
  );

  // FAL's Multiple-Angles implementation uses 1.25 as its default
  // LoRA control strength. Strengthen camera control while keeping the
  // Lightning LoRA and sampler settings unchanged.
  setNodeInput(
    workflow,
    "48:20",
    "strength_model",
    1.25,
  );
}

// OTG_BACKGROUND_FIXED_PIVOT_DIRECTION_SEMANTICS_PP06_V2
function applyAnglePromptOverrides(workflow: any) {
  const continuity =
    "Preserve the same environment identity, architecture, geometry, permanent objects, materials, lighting continuity, scale, lens character, and cinematic style. Do not add people, characters, text, logos, signs, or new props.";

  const prompts: Record<string, string> = {
    // Back consumes the generated physical Left view through scaler 65:35:82.
    // This is a second fixed-pivot Left turn, producing cumulative Back 180.
    "67":
      `Keep the camera at the exact same physical position, standing eye height, fixed pivot, roll, lens character, and scale. The input image is already the physical Left 90-degree view relative to the original Front. Rotate camera yaw another 90 degrees to the left around that same fixed pivot so it faces the true opposite direction from the original Front. Do not translate, strafe, orbit, crane, fly, zoom out, mirror, flip, or reuse the original Front composition. Do not produce a diagonal remix or a slightly reframed Front. Produce the strongest coherent inferred rear-facing view possible from the available scene evidence. ${continuity}`,

    "68":
      `Keep the camera at the exact same physical position, fixed pivot, standing eye height, roll at 0 degrees, pitch, lens character, and scale as the Front reference. Rotate camera yaw exactly 90 degrees to the right. Turn the camera lens toward the physical right-hand side visible at the right edge of Front, so that side becomes dominant in the resulting view. Do not strafe, orbit, crane, fly, translate, zoom out, mirror, flip, or reposition the camera. Produce the true right-facing view of the same environment. ${continuity}`,

    "70":
      `Keep the camera at the exact same physical position and standing eye height as the Front reference. Keep yaw unchanged and roll at 0 degrees. Do not fly, rise, crane, orbit, strafe, translate, mirror, invert, or reposition the camera. Pitch only the camera lens upward. Reveal substantially more sky and upper architecture while retaining enough lower structure to establish the same physical camera location. ${continuity}`,

    "71":
      `Keep the camera at the exact same physical position and standing eye height as the Front reference. Keep camera roll at 0 degrees and keep the same yaw. Do not move the camera in space. Do not fly, rise, crane, orbit, strafe, translate, zoom out, or create an aerial, drone, bird's-eye, or top-down camera view. Pitch only the camera lens downward approximately 45-60 degrees from the Front orientation. The lower environment must dominate the frame: floor, road, compass mosaic, paving, steps, drainage, foreground geometry, lower walls, and other structure below the original horizon. Retain enough distant architecture near the upper edge to prove the camera remained at the same physical location. ${continuity}`,

    "72":
      `Keep the camera at the exact same physical position, fixed pivot, standing eye height, roll at 0 degrees, pitch, lens character, and scale as the Front reference. Rotate camera yaw exactly 90 degrees to the left. Turn the camera lens toward the physical left-hand side visible at the left edge of Front, so that side becomes dominant in the resulting view. Do not strafe, orbit, crane, fly, translate, zoom out, mirror, flip, or reposition the camera. Produce the true left-facing view of the same environment. ${continuity}`,
  };

  for (const [nodeId, prompt] of Object.entries(prompts)) {
    setNodeInput(
      workflow,
      nodeId,
      "value",
      prompt,
    );
  }
}

// OTG_ANGLE_PROMPT_OVERRIDES_ROUTE_V36AF2
async function uploadImageToComfy(args: {
  bytes: Uint8Array;
  uploadName: string;
  contentType: string;
}) {
  const blob = new Blob([new Uint8Array(args.bytes)], {
    type: args.contentType || contentTypeFor(args.uploadName),
  });

  const form = new FormData();
  form.set("image", blob, args.uploadName);
  form.set("type", "input");
  form.set("overwrite", "true");

  const targetBaseUrl = comfyBaseUrl();
  const uploadUrl = `${targetBaseUrl}/upload/image`;

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      body: form,
    });
  } catch (error: any) {
    throw new Error(
      `Could not reach angle-plate ComfyUI upload endpoint ${uploadUrl}: ${error?.cause?.message || error?.message || String(error)}`,
    );
  }

  const text = await response.text();
  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(json?.error || text || `ComfyUI upload failed (${response.status}).`);
  }

  return {
    name: String(json?.name || args.uploadName),
    subfolder: String(json?.subfolder || ""),
    type: String(json?.type || "input"),
    raw: json,
  };
}

async function queueWorkflow(workflow: any) {
  const targetBaseUrl = comfyBaseUrl();
  const promptUrl = `${targetBaseUrl}/prompt`;

  let response: Response;
  try {
    response = await submitComfyPromptWith5060Lease({
      baseUrl: targetBaseUrl,
      workerId: "api-background-angle-plate",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: `otg-background-angle-plate-${Date.now().toString(36)}`,
        }),
      },
    });
  } catch (error: any) {
    return {
      ok: false,
      status: 502,
      error: `Could not reach angle-plate ComfyUI prompt endpoint ${promptUrl}: ${error?.cause?.message || error?.message || String(error)}`,
      details: null,
    };
  }

  const text = await response.text();
  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: json?.error || json?.message || text || `ComfyUI prompt failed (${response.status}).`,
      details: json,
    };
  }

  return {
    ok: true,
    status: response.status,
    json,
  };
}


  // OTG_BACKGROUND_QWEN_EDIT_360_PROJECTION_PP06_V1
  const BACKGROUND_360_DIRECTION_MODE_PP06_V1 =
    "qwen-edit-360-projection-v1";

  const BACKGROUND_360_WORKFLOW_PATH_PP06_V1 =
    "workflows/backgrounds/qwen-edit-360-panorama-v1.json";

  const BACKGROUND_360_LORA_PP06_V1 =
    "251018_MICKMUMPITZ_QWEN-EDIT_360_03.safetensors";

  const BACKGROUND_360_PANORAMA_PROMPT_PP06_V1 =
    "Create a complete 360 panoramic image of the exact same cinematic environment shown in the input image. Extend the unseen surrounding environment coherently. An ultra-wide HDRI image captured on a 360 degree camera, equirectangular projection. Preserve the same architecture, materials, lighting, scale, color palette, atmosphere, and visual style. Keep the input-facing environment recognizable. No people, characters, text, logos, signs, vehicles, or new focal props.";

  const BACKGROUND_360_PROJECTION_SPECS_PP06_V1 = [
    {
      direction: "left",
      suffix: "left90",
      yawDegrees: -90,
      pitchDegrees: 0,
    },
    {
      direction: "right",
      suffix: "right90",
      yawDegrees: 90,
      pitchDegrees: 0,
    },
    {
      direction: "rear",
      suffix: "rear180",
      yawDegrees: 180,
      pitchDegrees: 0,
    },
    {
      direction: "up",
      suffix: "up",
      yawDegrees: 0,
      pitchDegrees: 45,
    },
    {
      direction: "down",
      suffix: "down",
      yawDegrees: 0,
      pitchDegrees: -45,
    },
  ] as const;

  function backgroundDirectionGenerationModePP06V1(
    formData: FormData,
  ) {
    const requested = String(
      formData.get("directionGenerationMode") ||
        formData.get("direction_mode") ||
        process.env.OTG_BACKGROUND_DIRECTION_GENERATION_MODE ||
        "",
    )
      .trim()
      .toLowerCase();

    if (
      requested === "multiple-angles" ||
      requested === "legacy-multiple-angles"
    ) {
      return "multiple-angles";
    }

    return BACKGROUND_360_DIRECTION_MODE_PP06_V1;
  }

  async function loadQwenEdit360WorkflowPP06V1() {
    const candidates = [
      path.join(
        process.cwd(),
        BACKGROUND_360_WORKFLOW_PATH_PP06_V1,
      ),
      path.join(
        process.cwd(),
        "app",
        BACKGROUND_360_WORKFLOW_PATH_PP06_V1,
      ),
    ];

    let lastError = "";

    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw);

        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          throw new Error(
            "360 workflow JSON is not a ComfyUI API graph.",
          );
        }

        return parsed;
      } catch (error: any) {
        lastError =
          error?.message ||
          String(error);
      }
    }

    throw new Error(
      `Qwen-Edit_360 workflow could not be loaded: ${lastError}`,
    );
  }

  function findSingleWorkflowNodePP06V1(
    workflow: any,
    predicate: (
      nodeId: string,
      node: any,
    ) => boolean,
    label: string,
  ) {
    const matches = Object.entries(
      workflow || {},
    ).filter(
      ([nodeId, node]) =>
        predicate(
          String(nodeId),
          node,
        ),
    );

    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${label}; found ${matches.length}.`,
      );
    }

    return {
      nodeId:
        String(matches[0][0]),
      node:
        matches[0][1] as any,
    };
  }

  function configureQwenEdit360WorkflowPP06V1(
    workflow: any,
    inputName: string,
    panoramaPrefix: string,
  ) {
    const loadImage =
      findSingleWorkflowNodePP06V1(
        workflow,
        (_nodeId, node) =>
          String(
            node?.class_type ||
              "",
          ) === "LoadImage",
        "360 LoadImage node",
      );

    const saveImage =
      findSingleWorkflowNodePP06V1(
        workflow,
        (_nodeId, node) =>
          String(
            node?.class_type ||
              "",
          ) === "SaveImage",
        "360 SaveImage node",
      );

    const lora =
      findSingleWorkflowNodePP06V1(
        workflow,
        (_nodeId, node) =>
          String(
            node?.class_type ||
              "",
          ) ===
            "LoraLoaderModelOnly" &&
          String(
            node?.inputs?.lora_name ||
              "",
          ).includes(
            "MICKMUMPITZ_QWEN-EDIT_360",
          ),
        "Qwen-Edit_360 LoRA node",
      );

    // OTG_BACKGROUND_QWEN_EDIT_360_POSITIVE_ENCODER_PP06_V1
    const sampler =
      findSingleWorkflowNodePP06V1(
        workflow,
        (_nodeId, node) =>
          String(
            node?.class_type ||
              "",
          ) === "KSampler",
        "Qwen-Edit_360 KSampler",
      );

    const positiveConditioning =
      sampler.node?.inputs?.positive;

    const positiveEncoderNodeId =
      Array.isArray(
        positiveConditioning,
      ) &&
      positiveConditioning.length >= 1
        ? String(
            positiveConditioning[0] ||
              "",
          ).trim()
        : "";

    const positiveEncoderNode =
      positiveEncoderNodeId
        ? workflow?.[
            positiveEncoderNodeId
          ]
        : null;

    if (
      !positiveEncoderNodeId ||
      !positiveEncoderNode ||
      !String(
        positiveEncoderNode?.class_type ||
          "",
      ).includes(
        "TextEncodeQwenImageEdit",
      )
    ) {
      throw new Error(
        "Qwen-Edit_360 KSampler positive conditioning does not resolve to a Qwen Image Edit encoder.",
      );
    }

    const encoder = {
      nodeId:
        positiveEncoderNodeId,
      node:
        positiveEncoderNode,
    };

    setNodeInput(
      workflow,
      loadImage.nodeId,
      "image",
      inputName,
    );

    setNodeInput(
      workflow,
      lora.nodeId,
      "lora_name",
      BACKGROUND_360_LORA_PP06_V1,
    );

    setNodeInput(
      workflow,
      lora.nodeId,
      "strength_model",
      0.9,
    );

    const promptInput =
      encoder.node?.inputs?.prompt;

    if (
      Array.isArray(promptInput) &&
      promptInput.length >= 1 &&
      workflow?.[
        String(promptInput[0])
      ]
    ) {
      const promptNodeId =
        String(promptInput[0]);

      if (
        Object.prototype.hasOwnProperty.call(
          workflow[
            promptNodeId
          ]?.inputs ||
            {},
          "value",
        )
      ) {
        setNodeInput(
          workflow,
          promptNodeId,
          "value",
          BACKGROUND_360_PANORAMA_PROMPT_PP06_V1,
        );
      } else {
        setNodeInput(
          workflow,
          encoder.nodeId,
          "prompt",
          BACKGROUND_360_PANORAMA_PROMPT_PP06_V1,
        );
      }
    } else {
      setNodeInput(
        workflow,
        encoder.nodeId,
        "prompt",
        BACKGROUND_360_PANORAMA_PROMPT_PP06_V1,
      );
    }

    setNodeInput(
      workflow,
      saveImage.nodeId,
      "filename_prefix",
      panoramaPrefix,
    );

    randomizeSamplerSeeds(
      workflow,
    );

    return {
      loadImageNodeId:
        loadImage.nodeId,
      saveImageNodeId:
        saveImage.nodeId,
      loraNodeId:
        lora.nodeId,
      encoderNodeId:
        encoder.nodeId,
      panoramaPrefix,
    };
  }

  async function prepareBackground360ReferencePP06V1(
    sourceBytes: Buffer,
  ) {
    return await sharp(
      sourceBytes,
    )
      .resize(
        2048,
        1024,
        {
          fit: "contain",
          position: "centre",
          background: {
            r: 127,
            g: 127,
            b: 127,
            alpha: 1,
          },
        },
      )
      .png()
      .toBuffer();
  }

  function radiansPP06V1(
    degrees: number,
  ) {
    return (
      degrees *
      Math.PI /
      180
    );
  }

  async function projectEquirectangularViewPP06V1(
    panoramaBytes: Buffer,
    yawDegrees: number,
    pitchDegrees: number,
    outputWidth = 1280,
    outputHeight = 720,
    horizontalFovDegrees = 90,
  ) {
    const decoded =
      await sharp(
        panoramaBytes,
      )
        .toColorspace("srgb")
        .removeAlpha()
        .raw()
        .toBuffer({
          resolveWithObject:
            true,
        });

    const source =
      decoded.data;

    const sourceWidth =
      Number(
        decoded.info.width ||
          0,
      );

    const sourceHeight =
      Number(
        decoded.info.height ||
          0,
      );

    const channels =
      Number(
        decoded.info.channels ||
          0,
      );

    if (
      !sourceWidth ||
      !sourceHeight ||
      channels < 3
    ) {
      throw new Error(
        "The 360 panorama could not be decoded as an RGB image.",
      );
    }

    const ratio =
      sourceWidth /
      sourceHeight;

    if (
      ratio < 1.95 ||
      ratio > 2.05
    ) {
      throw new Error(
        `Expected an approximately 2:1 equirectangular panorama; received ${sourceWidth}x${sourceHeight}.`,
      );
    }

    const output =
      Buffer.alloc(
        outputWidth *
          outputHeight *
          3,
      );

    const yaw =
      radiansPP06V1(
        yawDegrees,
      );

    const pitch =
      radiansPP06V1(
        pitchDegrees,
      );

    const cosYaw =
      Math.cos(yaw);
    const sinYaw =
      Math.sin(yaw);
    const cosPitch =
      Math.cos(pitch);
    const sinPitch =
      Math.sin(pitch);

    const tanHalfHorizontal =
      Math.tan(
        radiansPP06V1(
          horizontalFovDegrees,
        ) /
          2,
      );

    const aspect =
      outputWidth /
      outputHeight;

    const tanHalfVertical =
      tanHalfHorizontal /
      aspect;

    const xRays =
      new Float64Array(
        outputWidth,
      );

    for (
      let x = 0;
      x < outputWidth;
      x += 1
    ) {
      xRays[x] =
        (
          2 *
            (
              x +
              0.5
            ) /
            outputWidth -
          1
        ) *
        tanHalfHorizontal;
    }

    for (
      let y = 0;
      y < outputHeight;
      y += 1
    ) {
      const cameraY =
        (
          1 -
          2 *
            (
              y +
              0.5
            ) /
            outputHeight
        ) *
        tanHalfVertical;

      for (
        let x = 0;
        x < outputWidth;
        x += 1
      ) {
        let dx =
          xRays[x];
        let dy =
          cameraY;
        let dz = 1;

        const inverseLength =
          1 /
          Math.sqrt(
            dx * dx +
              dy * dy +
              dz * dz,
          );

        dx *=
          inverseLength;
        dy *=
          inverseLength;
        dz *=
          inverseLength;

        const pitchY =
          cosPitch *
            dy +
          sinPitch *
            dz;

        const pitchZ =
          -sinPitch *
            dy +
          cosPitch *
            dz;

        const worldX =
          cosYaw *
            dx +
          sinYaw *
            pitchZ;

        const worldY =
          pitchY;

        const worldZ =
          -sinYaw *
            dx +
          cosYaw *
            pitchZ;

        const longitude =
          Math.atan2(
            worldX,
            worldZ,
          );

        const latitude =
          Math.asin(
            Math.max(
              -1,
              Math.min(
                1,
                worldY,
              ),
            ),
          );

        let sourceX =
          (
            longitude /
              (
                2 *
                Math.PI
              ) +
            0.5
          ) *
          sourceWidth;

        sourceX =
          (
            (
              sourceX %
              sourceWidth
            ) +
            sourceWidth
          ) %
          sourceWidth;

        let sourceY =
          (
            0.5 -
            latitude /
              Math.PI
          ) *
          (
            sourceHeight -
            1
          );

        sourceY =
          Math.max(
            0,
            Math.min(
              sourceHeight -
                1,
              sourceY,
            ),
          );

        const x0 =
          Math.floor(
            sourceX,
          );

        const y0 =
          Math.floor(
            sourceY,
          );

        const x1 =
          (
            x0 +
            1
          ) %
          sourceWidth;

        const y1 =
          Math.min(
            y0 +
              1,
            sourceHeight -
              1,
          );

        const fx =
          sourceX -
          x0;

        const fy =
          sourceY -
          y0;

        const destinationOffset =
          (
            y *
              outputWidth +
            x
          ) *
          3;

        for (
          let channel = 0;
          channel < 3;
          channel += 1
        ) {
          const p00 =
            source[
              (
                y0 *
                  sourceWidth +
                x0
              ) *
                channels +
                channel
            ];

          const p10 =
            source[
              (
                y0 *
                  sourceWidth +
                x1
              ) *
                channels +
                channel
            ];

          const p01 =
            source[
              (
                y1 *
                  sourceWidth +
                x0
              ) *
                channels +
                channel
            ];

          const p11 =
            source[
              (
                y1 *
                  sourceWidth +
                x1
              ) *
                channels +
                channel
            ];

          const top =
            p00 +
            (
              p10 -
              p00
            ) *
              fx;

          const bottom =
            p01 +
            (
              p11 -
              p01
            ) *
              fx;

          output[
            destinationOffset +
              channel
          ] =
            Math.max(
              0,
              Math.min(
                255,
                Math.round(
                  top +
                    (
                      bottom -
                      top
                    ) *
                      fy,
                ),
              ),
            );
        }
      }
    }

    return await sharp(
      output,
      {
        raw: {
          width:
            outputWidth,
          height:
            outputHeight,
          channels: 3,
        },
      },
    )
      .png()
      .toBuffer();
  }

  async function projectBackground360PanoramaPP06V1(
    panoramaBytes: Buffer,
    filenamePrefix: string,
    panoramaPromptId: string,
  ) {
    const metadata =
      await sharp(
        panoramaBytes,
      ).metadata();

    const panoramaWidth =
      Number(
        metadata.width ||
          0,
      );

    const panoramaHeight =
      Number(
        metadata.height ||
          0,
      );

    if (
      !panoramaWidth ||
      !panoramaHeight
    ) {
      throw new Error(
        "Could not inspect the generated 360 panorama.",
      );
    }

    const ratio =
      panoramaWidth /
      panoramaHeight;

    if (
      ratio < 1.95 ||
      ratio > 2.05
    ) {
      throw new Error(
        `Generated 360 panorama must be approximately 2:1; received ${panoramaWidth}x${panoramaHeight}.`,
      );
    }

    const canonicalDirections:
      Record<
        string,
        any
      > = {};

    for (
      const spec of
        BACKGROUND_360_PROJECTION_SPECS_PP06_V1
    ) {
      const bytes =
        await projectEquirectangularViewPP06V1(
          panoramaBytes,
          spec.yawDegrees,
          spec.pitchDegrees,
          1280,
          720,
          90,
        );

      const uploadName =
        safeUploadName(
          `${safeSlug(
            filenamePrefix,
          )}-${spec.suffix}.png`,
        );

      const upload =
        await uploadImageToComfy({
          bytes,
          uploadName,
          contentType:
            "image/png",
        });

      const uploadedName =
        String(
          upload?.name ||
            uploadName,
        ).trim();

      if (!uploadedName) {
        throw new Error(
          `Projected ${spec.direction} image was created but ComfyUI returned no uploaded filename.`,
        );
      }

      const directImage =
        `/api/comfy-image?filename=${encodeURIComponent(
          uploadedName,
        )}&type=input`;

      canonicalDirections[
        spec.direction
      ] = {
        direction:
          spec.direction,
        directImage,
        imageUrl:
          directImage,
        workflowImage:
          directImage,
        imagePath:
          directImage,
        filename:
          uploadedName,
        filenamePrefix:
          `${safeSlug(
            filenamePrefix,
          )}-${spec.suffix}`,
        promptId:
          panoramaPromptId,
        yawDegrees:
          spec.yawDegrees,
        pitchDegrees:
          spec.pitchDegrees,
        horizontalFovDegrees:
          90,
        width: 1280,
        height: 720,
        projection:
          "equirectangular-perspective",
      };
    }

    return {
      panoramaWidth,
      panoramaHeight,
      canonicalDirections,
    };
  }

// OTG_BACKGROUND_ANGLE_PLATE_CONFIGURED_BACKEND_V36AL
// OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

      const action = String(
        formData.get("action") || "",
      )
        .trim()
        .toLowerCase();

    const sourceValue =
      String(formData.get("loadImageValue") || "") ||
      String(formData.get("loadImage") || "") ||
      String(formData.get("inputImage") || "") ||
      String(formData.get("sourceImage") || "") ||
      String(formData.get("sourceImagePath") || "") ||
      String(formData.get("imagePath") || "") ||
      String(formData.get("image") || "");

    const title =
      String(formData.get("title") || "") ||
      String(formData.get("name") || "") ||
      "background";

    const runId = Date.now().toString(36);
    const filenamePrefix =
      String(formData.get("filenamePrefix") || "") ||
      String(formData.get("filename_prefix") || "") ||
      `${safeSlug(title)}-complete-background-plate-${runId}`;

    if (!sourceValue.trim()) {
      return NextResponse.json(
        {
          ok: false,
          marker: "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
          error: "Missing selected source image.",
        },
        { status: 400 },
      );
    }

    let source: LoadedSourceImage;
    try {
      source = await loadSourceImage(request, sourceValue);
    } catch (error: any) {
      return NextResponse.json(
        {
          ok: false,
          marker: "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
          error: error?.message || "Could not load the selected preview image.",
          sourceValue,
          searchedRoots: sourceRoots(),
        },
        { status: 404 },
      );
    }


      if (
        action ===
        "project-panorama"
      ) {
        const panoramaPromptId =
          String(
            formData.get(
              "panoramaPromptId",
            ) ||
              formData.get(
                "promptId",
              ) ||
              "",
          ).trim();

        const projected =
          await projectBackground360PanoramaPP06V1(
            Buffer.from(source.bytes),
            filenamePrefix,
            panoramaPromptId,
          );

        return NextResponse.json({
          ok: true,
          marker:
            "OTG_BACKGROUND_360_PROJECTIONS_PP06_V1",
          directionGenerationMode:
            BACKGROUND_360_DIRECTION_MODE_PP06_V1,
          sourceMarker:
            "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
          panoramaPromptId,
          filenamePrefix,
          expectedOutputPrefix:
            filenamePrefix,
          frontUsesMaster:
            true,
          canonicalDirections:
            projected.canonicalDirections,
          panoramaWidth:
            projected.panoramaWidth,
          panoramaHeight:
            projected.panoramaHeight,
          projectionWidth:
            1280,
          projectionHeight:
            720,
          horizontalFovDegrees:
            90,
          generatedDirectionalOutputCount:
            GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C,
          finalDirectionalReferenceCount:
            FINAL_BACKGROUND_CARD_DIRECTION_COUNT_V36C,
        });
      }

      const directionGenerationMode =
        backgroundDirectionGenerationModePP06V1(
          formData,
        );

      if (
        directionGenerationMode ===
        BACKGROUND_360_DIRECTION_MODE_PP06_V1
      ) {
        const referenceBytes =
          await prepareBackground360ReferencePP06V1(
            Buffer.from(source.bytes),
          );

        const panoramaReferenceName =
          safeUploadName(
            `${safeSlug(
              filenamePrefix,
            )}-360-reference.png`,
          );

        const panoramaReferenceUpload =
          await uploadImageToComfy({
            bytes:
              referenceBytes,
            uploadName:
              panoramaReferenceName,
            contentType:
              "image/png",
          });

        const panoramaInputName =
          String(
            panoramaReferenceUpload?.name ||
              panoramaReferenceName,
          ).trim();

        if (!panoramaInputName) {
          throw new Error(
            "Qwen-Edit_360 reference upload returned no filename.",
          );
        }

        const panoramaPrefix =
          `${safeSlug(
            filenamePrefix,
          )}-qwen-edit-360-panorama`;

        const panoramaWorkflow =
          await loadQwenEdit360WorkflowPP06V1();

        const panoramaConfiguration =
          configureQwenEdit360WorkflowPP06V1(
            panoramaWorkflow,
            panoramaInputName,
            panoramaPrefix,
          );

        const queued =
          await queueWorkflow(
            panoramaWorkflow,
          );

        if (!queued.ok) {
          return NextResponse.json(
            {
              ok: false,
              marker:
                "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
              directionGenerationMode,
              error:
                queued.error,
              details:
                queued.details,
              sourcePath:
                source.sourcePath,
              sourceUrl:
                source.sourceUrl,
              panoramaReferenceUpload,
              filenamePrefix,
              targetComfyBaseUrl:
                comfyBaseUrl(),
            },
            {
              status: 400,
            },
          );
        }

        const promptId =
          String(
            queued.json?.prompt_id ||
              queued.json?.promptId ||
              "",
          ).trim();

        if (!promptId) {
          return NextResponse.json(
            {
              ok: false,
              marker:
                "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
              directionGenerationMode,
              error:
                "ComfyUI accepted the Qwen-Edit_360 panorama workflow but did not return a prompt id.",
              panoramaReferenceUpload,
              filenamePrefix,
              targetComfyBaseUrl:
                comfyBaseUrl(),
            },
            {
              status: 502,
            },
          );
        }

        return NextResponse.json({
          ok: true,
          marker:
            "OTG_BACKGROUND_CANONICAL_DIRECTIONALS_V36B",
          sourceMarker:
            "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
          directionGenerationMode,
          prompt_id:
            promptId,
          promptId,
          number:
            queued.json?.number ??
            null,
          node_errors:
            queued.json?.node_errors ||
            {},
          sourcePath:
            source.sourcePath,
          sourceUrl:
            source.sourceUrl,
          sourcePromptId:
            source.sourcePromptId,
          sourceComfyBaseUrl:
            source.sourceComfyBaseUrl,
          panoramaReferenceUpload,
          filenamePrefix,
          expectedOutputPrefix:
            panoramaPrefix,
          targetComfyBaseUrl:
            comfyBaseUrl(),
          frontUsesMaster:
            true,
          panorama: {
            promptId,
            nodeId:
              panoramaConfiguration.saveImageNodeId,
            filenamePrefix:
              panoramaPrefix,
            width: 2048,
            height: 1024,
            projection:
              "equirectangular",
            lora:
              BACKGROUND_360_LORA_PP06_V1,
          },
          canonicalDirections:
            null,
          generatedDirectionalOutputCount:
            GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C,
          finalDirectionalReferenceCount:
            FINAL_BACKGROUND_CARD_DIRECTION_COUNT_V36C,
          outputPruning: {
            mode:
              "single-qwen-edit-360-panorama",
            saveNodeId:
              panoramaConfiguration.saveImageNodeId,
          },
        });
      }

    const uploadName = safeUploadName(source.filename);
    const upload = await uploadImageToComfy({
      bytes: source.bytes,
      uploadName,
      contentType: source.contentType,
    });

    const workflow = await loadAngleWorkflow();

    applyCanonicalDirectionalSourceGraphV1(workflow);

    const outputPruning =
      retainCanonicalDirectionalOutputsV36C(workflow);
    randomizeSamplerSeeds(workflow);
    applyAnglePromptOverrides(workflow);

    setNodeInput(workflow, "25", "image", upload.name);

    const canonicalDirectionPrefixes = Object.fromEntries(
      Object.entries(CANONICAL_DIRECTIONAL_OUTPUTS_V36B).map(
        ([direction, output]) => [
          direction,
          canonicalDirectionalFilenamePrefixV36B(
            filenamePrefix,
            output.suffix,
          ),
        ],
      ),
    ) as Record<string, string>;

    for (
      const [direction, output] of Object.entries(
        CANONICAL_DIRECTIONAL_OUTPUTS_V36B,
      )
    ) {
      setNodeInput(
        workflow,
        output.nodeId,
        "filename_prefix",
        canonicalDirectionPrefixes[direction],
      );
    }

    const queued = await queueWorkflow(workflow);

    if (!queued.ok) {
      return NextResponse.json(
        {
          ok: false,
          marker: "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
          error: queued.error,
          details: queued.details,
          sourcePath: source.sourcePath,
          sourceUrl: source.sourceUrl,
          uploadedInput: upload,
          filenamePrefix,
          targetComfyBaseUrl: comfyBaseUrl(),
        },
        { status: 400 },
      );
    }

    const promptId = String(queued.json?.prompt_id || queued.json?.promptId || "").trim();
    if (!promptId) {
      return NextResponse.json(
        {
          ok: false,
          marker: "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
          error: "ComfyUI accepted the angle workflow but did not return a prompt id.",
          uploadedInput: upload,
          filenamePrefix,
          targetComfyBaseUrl: comfyBaseUrl(),
        },
        { status: 502 },
      );
    }

    const canonicalDirections = Object.fromEntries(
      Object.entries(CANONICAL_DIRECTIONAL_OUTPUTS_V36B).map(
        ([direction, output]) => [
          direction,
          {
            direction,
            nodeId: output.nodeId,
            promptNodeId: output.promptNodeId,
            filenamePrefix:
              canonicalDirectionPrefixes[direction],
            promptId,
          },
        ],
      ),
    );

    return NextResponse.json({
      ok: true,
      marker: "OTG_BACKGROUND_CANONICAL_DIRECTIONALS_V36B",
      sourceMarker:
        "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
      prompt_id: promptId,
      promptId,
      number: queued.json?.number ?? null,
      node_errors: queued.json?.node_errors || {},
      sourcePath: source.sourcePath,
      sourceUrl: source.sourceUrl,
      sourcePromptId: source.sourcePromptId,
      sourceComfyBaseUrl: source.sourceComfyBaseUrl,
      uploadedInput: upload,
      filenamePrefix,
      expectedOutputPrefix: filenamePrefix,
      targetComfyBaseUrl: comfyBaseUrl(),
      inputNodeId: "25",
      frontUsesMaster: true,
      canonicalDirections,
      nonCanonicalSavesRemoved: true,
      previewOutputsRemoved: true,
      generatedDirectionalOutputCount:
        GENERATED_DIRECTIONAL_OUTPUT_COUNT_V36C,
      finalDirectionalReferenceCount:
        FINAL_BACKGROUND_CARD_DIRECTION_COUNT_V36C,
      outputPruning,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        marker: "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
        error: error?.message || "Background angle plate route failed.",
      },
      { status: 500 },
    );
  }
}
