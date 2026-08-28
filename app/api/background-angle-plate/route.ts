import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
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
    process.env.OTG_ANGLES_MULTIVIEW_COMFY_URL ||
    process.env.OTG_ANGLES_IMAGE_COMFY_URL ||
    process.env.OTG_ANGLES_3D_MODEL_COMFY_URL ||
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

function applyAnglePromptOverrides(workflow: any) {
  const fixedPivot =
    "Use the accepted Front Master as the only environment source. Maintain the exact same camera location and pivot. Do not translate the camera or move its position. Preserve architecture, geometry, dimensions, spatial relationships, fixed objects, landmarks, materials, lighting direction, scale, base color palette, lens character, and cinematic style. Do not add people, characters, text, logos, signs, or new props.";

  const prompts: Record<string, string> = {
    "67":
      `${fixedPivot} Rotate the camera yaw exactly 180 degrees from the Front view around the fixed pivot, keeping the same camera position and eye height. Show the true Rear view of the same environment.`,
    "68":
      `${fixedPivot} Rotate the camera yaw exactly 90 degrees to the right from the Front view around the fixed pivot. Keep camera height and pitch unchanged.`,
    "70":
      `${fixedPivot} Keep yaw unchanged and pitch the camera upward from the fixed pivot. This is camera rotation only; do not elevate, crane, orbit, or reposition the camera.`,
    "71":
      `${fixedPivot} Keep yaw unchanged and pitch the camera downward from the fixed pivot. This is camera rotation only; do not lower, drop, orbit, or reposition the camera.`,
    "72":
      `${fixedPivot} Rotate the camera yaw exactly 90 degrees to the left from the Front view around the fixed pivot. Keep camera height and pitch unchanged.`,
  };

  for (const [nodeId, prompt] of Object.entries(prompts)) {
    setNodeInput(workflow, nodeId, "value", prompt);
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

// OTG_BACKGROUND_ANGLE_PLATE_CONFIGURED_BACKEND_V36AL
// OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

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

    const uploadName = safeUploadName(source.filename);
    const upload = await uploadImageToComfy({
      bytes: source.bytes,
      uploadName,
      contentType: source.contentType,
    });

    const workflow = await loadAngleWorkflow();

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
