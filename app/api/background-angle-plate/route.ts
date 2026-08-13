import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";

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
    "E:\\Renders\\ComfyUI",
    "E:\\Renders\\ComfyUI\\output",
    "C:\\AI\\ComfyUI\\output",
    "C:\\AI\\ComfyUI_windows_portable\\ComfyUI\\output",
    "C:\\AI\\ComfyUI_windows_portable\\output",
    "C:\\ComfyUI\\output",
    "D:\\ComfyUI\\output",
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

function allowedSourceProxyPath(pathname: string) {
  return new Set([
    "/api/comfy/history-image",
    "/api/comfy-image",
    "/api/file",
    "/api/gallery/file",
  ]).has(pathname);
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
  const sourceUrl = new URL(sourceValue, request.nextUrl.origin);

  if (sourceUrl.origin !== request.nextUrl.origin || !allowedSourceProxyPath(sourceUrl.pathname)) {
    throw new Error("Selected preview is not a supported OTG image reference.");
  }

  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const deviceId = request.headers.get("x-otg-device-id");
  if (cookie) headers.set("cookie", cookie);
  if (deviceId) headers.set("x-otg-device-id", deviceId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(sourceUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Selected preview fetch failed (${response.status}).`);
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

function removeIntermediateSaves(workflow: any) {
  for (const nodeId of ["31", "34", "36", "38", "41", "43", "45", "47"]) {
    delete workflow[nodeId];
  }
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
  const prompts: Record<string, string> = {
    "66": "Create a closer forward camera view of the same empty background environment. Move the camera forward into the scene without changing the location. Preserve architecture, room layout, lighting, materials, color palette, perspective continuity, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "67": "Create a wider establishing camera view of the same empty background environment. Pull the camera backward slightly with a wider lens, revealing more of the left and right sides while preserving the same location, architecture, lighting, materials, color palette, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "68": "Rotate the camera viewpoint 90 degrees to the right from the original position, as if capturing the right side of a 360 environment. Preserve the same room, architecture, lighting direction, materials, scale, color palette, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "69": "Rotate the camera viewpoint 45 degrees to the right from the original position, creating a natural intermediate right-angle background plate for a 360-style environment. Preserve the same room, architecture, lighting, materials, scale, color palette, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "70": "Create a high aerial view looking down into the same empty background environment. Keep the same room layout, architecture, floor plan, lighting, materials, color palette, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "71": "Create a low floor-level camera view looking slightly upward through the same empty background environment. Preserve the same architecture, lighting, materials, color palette, scale, perspective continuity, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "72": "Rotate the camera viewpoint 90 degrees to the left from the original position, as if capturing the left side of a 360 environment. Preserve the same room, architecture, lighting direction, materials, scale, color palette, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
    "73": "Rotate the camera viewpoint 45 degrees to the left from the original position, creating a natural intermediate left-angle background plate for a 360-style environment. Preserve the same room, architecture, lighting, materials, scale, color palette, and cinematic style. Do not add people, characters, text, logos, signs, or new props.",
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

    removeIntermediateSaves(workflow);
    randomizeSamplerSeeds(workflow);
    applyAnglePromptOverrides(workflow);

    setNodeInput(workflow, "25", "image", upload.name);
    setNodeInput(workflow, "142", "filename_prefix", filenamePrefix);

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

    return NextResponse.json({
      ok: true,
      marker: "OTG_BACKGROUND_ANGLE_PLATE_CROSS_BACKEND_SOURCE_V36AK",
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
      finalSaveNodeId: "142",
      inputNodeId: "25",
      intermediateSavesRemoved: true,
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
