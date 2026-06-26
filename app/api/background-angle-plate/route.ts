import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

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

function cleanImageValue(value: string) {
  let text = decodeSafe(String(value || "").trim());

  try {
    const parsed = new URL(text);
    text = parsed.searchParams.get("path") || parsed.searchParams.get("filename") || text;
  } catch {
    // Not a URL.
  }

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
    process.env.NEXT_PUBLIC_BACKGROUND_COMFYUI_URL ||
    "http://127.0.0.1:8188";

  return String(value).replace(/\/+$/, "");
}

function outputRoots() {
  const comfyRoot =
    process.env.COMFYUI_ROOT_DIR ||
    process.env.COMFY_ROOT_DIR ||
    process.env.OTG_COMFY_ROOT_DIR ||
    "";

  return uniqueList([
    process.env.COMFYUI_OUTPUT_DIR,
    process.env.COMFY_OUTPUT_DIR,
    process.env.OTG_COMFY_OUTPUT_DIR,
    "E:\\Renders\\ComfyUI",
    "E:\\Renders\\ComfyUI\\output",
    comfyRoot ? path.join(comfyRoot, "output") : "",
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
    for (const root of outputRoots()) {
      const candidate = path.normalize(clean);
      if (isInsideRoot(root, candidate) && await existsFile(candidate)) {
        return candidate;
      }
    }
  }

  for (const root of outputRoots()) {
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
  sourcePath: string;
  uploadName: string;
}) {
  const bytes = await readFile(args.sourcePath);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: contentTypeFor(args.uploadName),
  });

  const form = new FormData();
  form.set("image", blob, args.uploadName);
  form.set("type", "input");
  form.set("overwrite", "true");

  const response = await fetch(`${comfyBaseUrl()}/upload/image`, {
    method: "POST",
    body: form,
  });

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
  const response = await fetch(`${comfyBaseUrl()}/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      prompt: workflow,
      client_id: `otg-background-angle-plate-${Date.now().toString(36)}`,
    }),
  });

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

// OTG_BACKGROUND_ANGLE_PLATE_ROUTE_V36AF
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
          marker: "OTG_BACKGROUND_ANGLE_PLATE_ROUTE_V36AF",
          error: "Missing selected source image.",
        },
        { status: 400 },
      );
    }

    const sourcePath = await resolveSourceImagePath(sourceValue);

    if (!sourcePath) {
      return NextResponse.json(
        {
          ok: false,
          marker: "OTG_BACKGROUND_ANGLE_PLATE_ROUTE_V36AF",
          error: "Could not resolve selected preview image to a local ComfyUI output file.",
          sourceValue,
          searchedRoots: outputRoots(),
        },
        { status: 404 },
      );
    }

    const sourceFilename = path.basename(sourcePath);
    const uploadName = safeUploadName(sourceFilename);
    const upload = await uploadImageToComfy({
      sourcePath,
      uploadName,
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
          marker: "OTG_BACKGROUND_ANGLE_PLATE_ROUTE_V36AF",
          error: queued.error,
          details: queued.details,
          sourcePath,
          uploadedInput: upload,
          filenamePrefix,
          targetComfyBaseUrl: comfyBaseUrl(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      marker: "OTG_BACKGROUND_ANGLE_PLATE_ROUTE_V36AF",
      prompt_id: queued.json?.prompt_id || null,
      number: queued.json?.number ?? null,
      node_errors: queued.json?.node_errors || {},
      sourcePath,
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
        marker: "OTG_BACKGROUND_ANGLE_PLATE_ROUTE_V36AF",
        error: error?.message || "Background angle plate route failed.",
      },
      { status: 500 },
    );
  }
}
