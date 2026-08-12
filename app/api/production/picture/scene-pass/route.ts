import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type ScenePassReference = {
  slot?: number;
  type?: string;
  name?: string;
  description?: string;
  workflowImage?: string;
  workflowImagePath?: string;
  workflowImageUrl?: string;
  fileName?: string;
  image?: string;
  imagePath?: string;
  imageUrl?: string;
  locked?: boolean;
};

type ScenePassRequest = {
  sceneId?: string;
  passIndex?: number;
  prompt?: string;
  positivePrompt?: string;
  negativePrompt?: string;
  clientId?: string;
  waitForResult?: boolean;
  waitMs?: number;
  references?: ScenePassReference[];
};

type NormalizedReference = {
  slot: number;
  type: string;
  name: string;
  description: string;
  workflowImage: string;
  locked: boolean;
};

type ComfyImage = {
  filename: string;
  subfolder?: string;
  type?: string;
};

const WORKFLOW_RELATIVE_PATH = path.join("app", "comfy-workflows", "production-picture-qwen-next-scene-v36bo1.json");
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const DEFAULT_NEGATIVE_PROMPT = "low quality, blurry, distorted, deformed, bad anatomy";

function jsonResponse(status: number, body: JsonRecord) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function positiveRandomSeed() {
  return Math.floor(Math.random() * 9007199254740991) + 1;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanPromptText(value: unknown) {
  let text = asString(value).replace(/\r\n/g, "\n");

  const hardStops = [
    "Composition rules:",
    "OTG anti-duplicate guard:",
    "Identity/Face lock:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
  ];

  for (const marker of hardStops) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) text = text.slice(0, index);
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();
}

function buildPositivePrompt(body: ScenePassRequest, references: NormalizedReference[]) {
  const basePrompt = cleanPromptText(body.prompt || body.positivePrompt);
  const positiveLines = [`Next Scene: ${basePrompt || "continue the scene"}`];

  const detailLines = references
    .filter((ref) => {
      const type = ref.type.toLowerCase();
      return type !== "background" && type !== "base" && type !== "plate";
    })
    .map((ref) => cleanPromptText(ref.description))
    .filter(Boolean);

  if (detailLines.length) {
    positiveLines.push("");
    positiveLines.push("Character/object details:");
    for (const detail of detailLines) positiveLines.push(detail);
  }

  return positiveLines.join("\n");
}

function buildNegativePrompt(body: ScenePassRequest) {
  const negative = asString(body.negativePrompt);
  return negative || DEFAULT_NEGATIVE_PROMPT;
}

function normalizeWorkflowImage(value: unknown) {
  const raw = asString(value);
  if (!raw) return "";

  // Keep the source locator intact until the server has staged the exact image
  // into the selected ComfyUI backend. Reducing an OTG absolute path or an app
  // proxy URL to a basename loses the only information needed to find the file.
  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/api/")) return raw;

  try {
    return decodeURIComponent(raw).replace(/\\/g, "/").trim();
  } catch {
    return raw.replace(/\\/g, "/").trim();
  }
}

function normalizeReference(input: ScenePassReference, index: number): NormalizedReference {
  const type = asString(input.type || "character").toLowerCase() || "character";
  const workflowImage = normalizeWorkflowImage(
    input.workflowImage ||
      input.workflowImagePath ||
      input.workflowImageUrl ||
      input.fileName ||
      input.image ||
      input.imagePath ||
      input.imageUrl,
  );

  return {
    slot: asNumber(input.slot) ?? index + 1,
    type,
    name: asString(input.name) || `${type} ${index + 1}`,
    description: cleanPromptText(input.description),
    workflowImage,
    locked: Boolean(input.locked),
  };
}

function validateReferences(rawReferences: unknown): NormalizedReference[] {
  if (!Array.isArray(rawReferences)) throw new Error("SCENE_PASS_REFERENCES_REQUIRED: references must be an array.");

  const references = rawReferences.map((ref, index) => normalizeReference(isRecord(ref) ? (ref as ScenePassReference) : {}, index));

  if (!references.length) throw new Error("SCENE_PASS_REFERENCES_REQUIRED: provide at least one image reference.");

  if (references.length > 3) {
    throw new Error("SCENE_PASS_MAX_3_IMAGES: Qwen next-scene generation supports a maximum of 3 image references per pass.");
  }

  const seenImages = new Set<string>();
  for (const ref of references) {
    if (!ref.workflowImage) throw new Error(`SCENE_PASS_REFERENCE_IMAGE_REQUIRED: reference slot ${ref.slot} is missing workflowImage.`);

    const imageKey = ref.workflowImage.toLowerCase();
    if (seenImages.has(imageKey)) throw new Error(`SCENE_PASS_DUPLICATE_IMAGE: ${ref.workflowImage} is assigned more than once.`);
    seenImages.add(imageKey);

    const type = ref.type.toLowerCase();
    if (type !== "background" && type !== "base" && type !== "plate" && !ref.description) {
      throw new Error(`SCENE_PASS_DESCRIPTION_REQUIRED: ${ref.name} requires a description.`);
    }
  }

  return references;
}

// OTG_SCENE_PASS_REFERENCE_ORDER_V1_START
function orderScenePassReferencesV1(references: NormalizedReference[]) {
  const rank = (ref: NormalizedReference) => {
    const type = ref.type.toLowerCase();
    if (ref.locked || type === "base") return 0;
    if (type === "character") return 1;
    if (type === "background" || type === "plate") return 2;
    if (type === "object" || type === "prop") return 3;
    return 4;
  };

  return references
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => rank(a.ref) - rank(b.ref) || a.index - b.index)
    .map(({ ref }, index) => ({ ...ref, slot: index + 1 }))
    .slice(0, 3);
}
// OTG_SCENE_PASS_REFERENCE_ORDER_V1_END

async function parseRequest(request: NextRequest): Promise<ScenePassRequest> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const referencesRaw = asString(formData.get("references"));
    let references: unknown = [];
    if (referencesRaw) {
      try {
        references = JSON.parse(referencesRaw);
      } catch {
        throw new Error("SCENE_PASS_BAD_REFERENCES_JSON: references form field must be valid JSON.");
      }
    }

    return {
      sceneId: asString(formData.get("sceneId")),
      passIndex: asNumber(formData.get("passIndex")),
      prompt: asString(formData.get("prompt") || formData.get("positivePrompt") || formData.get("scenePrompt")),
      positivePrompt: asString(formData.get("positivePrompt")),
      negativePrompt: asString(formData.get("negativePrompt")),
      clientId: asString(formData.get("clientId") || formData.get("client_id")),
      waitForResult: asBoolean(formData.get("waitForResult"), true),
      waitMs: asNumber(formData.get("waitMs")),
      references: Array.isArray(references) ? (references as ScenePassReference[]) : [],
    };
  }

  const json = await request.json().catch(() => ({}));
  if (!isRecord(json)) return {};
  return json as ScenePassRequest;
}

function workflowNodeEntries(workflow: JsonRecord) {
  return Object.entries(workflow)
    .filter(([, value]) => isRecord(value))
    .map(([id, node]) => [id, node as JsonRecord] as const);
}

function nodeTitle(node: JsonRecord) {
  const meta = isRecord(node._meta) ? node._meta : {};
  return `${asString(node.title)} ${asString(node.name)} ${asString(meta.title)} ${asString(meta.name)}`.toLowerCase();
}

function nodeClass(node: JsonRecord) {
  return asString(node.class_type || node.type);
}

function nodeInputs(node: JsonRecord) {
  if (!isRecord(node.inputs)) node.inputs = {};
  return node.inputs as JsonRecord;
}

function setLoadImageNodes(workflow: JsonRecord, references: NormalizedReference[]) {
  const loadImageNodes = workflowNodeEntries(workflow)
    .filter(([, node]) => {
      const classType = nodeClass(node);
      const inputs = nodeInputs(node);
      return /loadimage/i.test(classType) && Object.prototype.hasOwnProperty.call(inputs, "image");
    })
    .sort(([aId, aNode], [bId, bNode]) => {
      const aTitle = nodeTitle(aNode);
      const bTitle = nodeTitle(bNode);
      const aRank = aTitle.includes("image 1") || aTitle.includes("image1") ? 1 : aTitle.includes("image 2") || aTitle.includes("image2") ? 2 : aTitle.includes("image 3") || aTitle.includes("image3") ? 3 : Number(aId);
      const bRank = bTitle.includes("image 1") || bTitle.includes("image1") ? 1 : bTitle.includes("image 2") || bTitle.includes("image2") ? 2 : bTitle.includes("image 3") || bTitle.includes("image3") ? 3 : Number(bId);
      return aRank - bRank;
    });

  if (loadImageNodes.length < references.length) {
    throw new Error(`SCENE_PASS_WORKFLOW_IMAGE_SLOTS: workflow has ${loadImageNodes.length} LoadImage slot(s), but ${references.length} reference(s) were provided.`);
  }

  for (let index = 0; index < loadImageNodes.length; index += 1) {
    const [, node] = loadImageNodes[index];
    const inputs = nodeInputs(node);
    inputs.image = index < references.length ? references[index].workflowImage : "";
  }
}

function setPromptNodes(workflow: JsonRecord, positivePrompt: string, negativePrompt: string) {
  let positiveSet = 0;
  let negativeSet = 0;

  for (const [, node] of workflowNodeEntries(workflow)) {
    const inputs = nodeInputs(node);
    const classType = nodeClass(node);
    const title = nodeTitle(node);
    const promptCapable = Object.prototype.hasOwnProperty.call(inputs, "prompt") || /textencode/i.test(classType) || title.includes("prompt");
    if (!promptCapable) continue;

    const isNegative = title.includes("negative");
    const isPositive = title.includes("positive") || !isNegative;

    if (isNegative) {
      inputs.prompt = negativePrompt;
      negativeSet += 1;
    } else if (isPositive && (/qwen/i.test(classType) || /textencode/i.test(classType) || title.includes("positive"))) {
      inputs.prompt = positivePrompt;
      positiveSet += 1;
    }
  }

  if (!positiveSet) throw new Error("SCENE_PASS_POSITIVE_PROMPT_NODE_NOT_FOUND: no positive prompt node was found.");
  if (!negativeSet) throw new Error("SCENE_PASS_NEGATIVE_PROMPT_NODE_NOT_FOUND: no negative prompt node was found.");
}

function recursivelyPatchSeedsAndSize(value: unknown, seen = new Set<object>()) {
  if (!isRecord(value) && !Array.isArray(value)) return;
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return;
    seen.add(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) recursivelyPatchSeedsAndSize(item, seen);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();

    if (["seed", "noise_seed", "random_seed"].includes(lowerKey) || /(^|_)seed$/.test(lowerKey)) {
      if (typeof child === "number" || typeof child === "string") {
        value[key] = positiveRandomSeed();
        continue;
      }
    }

    if (lowerKey === "width" && (typeof child === "number" || typeof child === "string")) {
      value[key] = OUTPUT_WIDTH;
      continue;
    }

    if (lowerKey === "height" && (typeof child === "number" || typeof child === "string")) {
      value[key] = OUTPUT_HEIGHT;
      continue;
    }

    recursivelyPatchSeedsAndSize(child, seen);
  }
}

function getComfyUrl() {
  const raw =
    process.env.OTG_PRODUCTION_SCENE_PASS_COMFY_URL ||
    process.env.OTG_IMAGE_COMFY_BASE_URL ||
    process.env.OTG_IMAGE_COMFY_URL ||
    process.env.COMFYUI_IMAGE_URL ||
    process.env.OTG_ANGLES_IMAGE_COMFY_URL ||
    process.env.COMFYUI_URL ||
    process.env.COMFY_URL ||
    process.env.COMFY_BASE_URL ||
    process.env.NEXT_PUBLIC_COMFYUI_URL ||
    process.env.NEXT_PUBLIC_COMFY_URL ||
    "http://127.0.0.1:8188";

  return raw.replace(/\/+$/, "");
}


// OTG_SCENE_PASS_COMFY_INPUT_UPLOAD_V36BPG1_START
function scenePassMimeTypeV36BPG1(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

function scenePassCandidateRepoRootsV36BPG1() {
  const cwd = path.resolve(process.cwd());
  const roots = [
    process.env.OTG_REPO_ROOT || "",
    process.env.OTG_TEST_REPO_ROOT || "",
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
    "C:\\AI\\OTG-Test2",
  ].filter(Boolean);

  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

function scenePassLooksLikeWindowsPathV36BPG1(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || /^\/[A-Za-z]:[\\/]/.test(value);
}

function scenePassLooksLikeLocalDataPathV36BPG1(value: string) {
  return (
    scenePassLooksLikeWindowsPathV36BPG1(value) ||
    value.startsWith("data/") ||
    value.startsWith("/data/") ||
    value.includes("\\data\\") ||
    value.includes("/data/")
  );
}

function scenePassNormalizeWindowsPathV36BPG1(value: string) {
  return value.replace(/^\/([A-Za-z]:[\\/])/, "$1");
}

async function scenePassFileExistsV36BPG1(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile());
}

async function scenePassFindLocalImageByBasenameV36BPG1(fileName: string) {
  const wanted = path.basename(fileName).toLowerCase();
  if (!wanted || wanted === "." || wanted === path.sep) return "";

  const configuredDataRoots = [
    process.env.OTG_DATA_ROOT || "",
    process.env.OTG_DATA_DIR || "",
  ]
    .filter(Boolean)
    .map((root) => path.resolve(root));

  const roots = Array.from(new Set([
    ...configuredDataRoots,
    ...scenePassCandidateRepoRootsV36BPG1().flatMap((root) => [
      path.join(root, "data"),
      path.join(root, "app", "data"),
      path.join(root, "public"),
      path.join(root, "app", "public"),
    ]),
  ]));

  for (const root of roots) {
    const rootStat = await fs.stat(root).catch(() => null);
    if (!rootStat?.isDirectory()) continue;

    const stack = [root];
    let scanned = 0;

    while (stack.length && scanned < 8000) {
      const current = stack.pop() || "";
      scanned += 1;

      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }

        if (entry.isFile() && entry.name.toLowerCase() === wanted) {
          return entryPath;
        }
      }
    }
  }

  return "";
}

async function scenePassResolveLocalImagePathV36BPG1(rawValue: string) {
  const raw = scenePassNormalizeWindowsPathV36BPG1(rawValue.trim());
  if (!raw) return "";

  if (path.isAbsolute(raw) && await scenePassFileExistsV36BPG1(raw)) {
    return path.resolve(raw);
  }

  if (scenePassLooksLikeWindowsPathV36BPG1(raw) && await scenePassFileExistsV36BPG1(raw)) {
    return path.resolve(raw);
  }

  for (const root of scenePassCandidateRepoRootsV36BPG1()) {
    const candidates = [
      path.resolve(root, raw.replace(/^[/\\]+/, "")),
      path.resolve(root, "data", raw.replace(/^[/\\]*(data[/\\])?/, "")),
      path.resolve(root, "app", raw.replace(/^[/\\]+/, "")),
    ];

    for (const candidate of candidates) {
      if (await scenePassFileExistsV36BPG1(candidate)) return candidate;
    }
  }

  return scenePassFindLocalImageByBasenameV36BPG1(path.basename(raw));
}

function scenePassSplitComfyImagePathV36BPG2(rawValue: string) {
  const normalized = rawValue.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const fileName = path.posix.basename(normalized);
  const subfolder = path.posix.dirname(normalized);
  return {
    filename: fileName,
    subfolder: subfolder && subfolder !== "." ? subfolder : "",
  };
}

async function scenePassFetchComfyViewBlobV36BPG2(rawValue: string, imageType: string) {
  const parts = scenePassSplitComfyImagePathV36BPG2(rawValue);
  if (!parts.filename) return null;

  const viewUrl = new URL(`${getComfyUrl()}/view`);
  viewUrl.searchParams.set("filename", parts.filename);
  viewUrl.searchParams.set("type", imageType);
  if (parts.subfolder) viewUrl.searchParams.set("subfolder", parts.subfolder);

  const response = await fetch(viewUrl.toString(), { cache: "no-store" });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || scenePassMimeTypeV36BPG1(parts.filename);
  const arrayBuffer = await response.arrayBuffer();
  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    filename: parts.filename,
    subfolder: parts.subfolder,
    sourceType: imageType,
  };
}

async function scenePassComfyInputExistsV36BPG2(rawValue: string) {
  return Boolean(await scenePassFetchComfyViewBlobV36BPG2(rawValue, "input"));
}

async function scenePassUploadBlobToComfyInputV36BPG1(blob: Blob, fileName: string) {
  const form = new FormData();
  form.append("image", blob, fileName);
  form.append("type", "input");
  form.append("overwrite", "true");

  const response = await fetch(`${getComfyUrl()}/upload/image`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  const text = await response.text();
  let json: JsonRecord = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) json = parsed;
  } catch {
    // Keep raw text for error details.
  }

  if (!response.ok) {
    throw new Error(`SCENE_PASS_COMFY_IMAGE_UPLOAD_FAILED: ${fileName}: ${response.status}: ${text.slice(0, 500)}`);
  }

  const name = asString(json.name) || asString(json.filename) || fileName;
  const subfolder = asString(json.subfolder);
  return subfolder ? `${subfolder}/${name}` : name;
}

async function scenePassUploadComfyViewImageToInputV36BPG2(rawValue: string) {
  const source =
    (await scenePassFetchComfyViewBlobV36BPG2(rawValue, "output")) ||
    (await scenePassFetchComfyViewBlobV36BPG2(rawValue, "temp"));

  if (!source) return "";

  return scenePassUploadBlobToComfyInputV36BPG1(source.blob, source.filename);
}

async function scenePassUploadLocalImageToComfyInputV36BPG1(filePath: string) {
  const bytes = await fs.readFile(filePath);
  const blob = new Blob([new Uint8Array(bytes)], { type: scenePassMimeTypeV36BPG1(filePath) });
  return scenePassUploadBlobToComfyInputV36BPG1(blob, path.basename(filePath));
}

async function scenePassUploadUrlToComfyInputV36BPG1(url: string, fallbackName: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`SCENE_PASS_REFERENCE_FETCH_FAILED: ${url}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || scenePassMimeTypeV36BPG1(fallbackName);
  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: contentType });
  return scenePassUploadBlobToComfyInputV36BPG1(blob, fallbackName || "scene-pass-reference.png");
}

async function scenePassResolveUrlReferenceForComfyV36BPG1(raw: string, requestOrigin: string) {
  const url = new URL(raw, requestOrigin);

  if (url.pathname === "/api/otg/local-image") {
    const pathParam = url.searchParams.get("path") || "";
    const localPath = await scenePassResolveLocalImagePathV36BPG1(pathParam);
    if (localPath) return scenePassUploadLocalImageToComfyInputV36BPG1(localPath);
  }

  if (url.pathname.includes("/view") || url.pathname.includes("/api/comfy/view") || url.pathname.includes("/api/comfy/history-image")) {
    const filename = url.searchParams.get("filename") || path.basename(url.pathname) || "scene-pass-reference.png";
    return scenePassUploadUrlToComfyInputV36BPG1(url.toString(), filename);
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return scenePassUploadUrlToComfyInputV36BPG1(url.toString(), path.basename(url.pathname) || "scene-pass-reference.png");
  }

  return "";
}

async function scenePassEnsureReferenceImageInComfyInputV36BPG1(rawValue: string, requestOrigin: string) {
  const raw = rawValue.trim();
  if (!raw) return raw;

  if (/^(data:image\/)/i.test(raw)) {
    const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) throw new Error("SCENE_PASS_BAD_DATA_URL_REFERENCE: invalid data URL image reference.");
    const mime = match[1] || "image/png";
    const bytes = Buffer.from(match[2] || "", "base64");
    const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
    return scenePassUploadBlobToComfyInputV36BPG1(new Blob([new Uint8Array(bytes)], { type: mime }), `scene-pass-reference-${Date.now()}.${ext}`);
  }

  if (/^https?:\/\//i.test(raw) || raw.startsWith("/api/")) {
    return scenePassResolveUrlReferenceForComfyV36BPG1(raw, requestOrigin);
  }

  if (scenePassLooksLikeLocalDataPathV36BPG1(raw)) {
    const localPath = await scenePassResolveLocalImagePathV36BPG1(raw);
    if (!localPath) {
      const comfyViewUploaded = await scenePassUploadComfyViewImageToInputV36BPG2(raw);
      if (comfyViewUploaded) return comfyViewUploaded;
      throw new Error(`SCENE_PASS_REFERENCE_FILE_NOT_FOUND: ${raw}`);
    }
    return scenePassUploadLocalImageToComfyInputV36BPG1(localPath);
  }

  const byBasename = await scenePassFindLocalImageByBasenameV36BPG1(raw);
  if (byBasename) return scenePassUploadLocalImageToComfyInputV36BPG1(byBasename);

  const outputUploaded = await scenePassUploadComfyViewImageToInputV36BPG2(raw);
  if (outputUploaded) return outputUploaded;

  if (await scenePassComfyInputExistsV36BPG2(raw)) return raw;

  throw new Error(`SCENE_PASS_REFERENCE_IMAGE_NOT_AVAILABLE_TO_COMFY: ${raw}`);
}

async function prepareScenePassReferencesForComfyV36BPG1(references: NormalizedReference[], requestOrigin: string): Promise<NormalizedReference[]> {
  const prepared: NormalizedReference[] = [];
  const comfyUrl = getComfyUrl();

  for (const ref of references) {
    const sourceImage = ref.workflowImage;
    const workflowImage = await scenePassEnsureReferenceImageInComfyInputV36BPG1(sourceImage, requestOrigin);
    if (!workflowImage) throw new Error(`SCENE_PASS_REFERENCE_IMAGE_PREP_FAILED: ${ref.name} did not resolve to a ComfyUI input image.`);

    console.info("[scene-pass-reference-staging]", {
      comfyUrl,
      slot: ref.slot,
      type: ref.type,
      name: ref.name,
      sourceImage,
      stagedInput: workflowImage,
    });

    prepared.push({
      ...ref,
      workflowImage,
    });
  }

  return prepared;
}
// OTG_SCENE_PASS_REFERENCE_STAGING_V36BPG3
// OTG_SCENE_PASS_COMFY_INPUT_UPLOAD_V36BPG1_END







function workflowCandidatePathsV36BPE1() {
  const cwd = path.resolve(process.cwd());
  const fileName = path.basename(WORKFLOW_RELATIVE_PATH);
  const repoRoot = process.env.OTG_REPO_ROOT || process.env.OTG_TEST_REPO_ROOT || "C:\\AI\\OTG-Test2";

  const candidates = [
    path.resolve(cwd, WORKFLOW_RELATIVE_PATH),
    path.resolve(cwd, "comfy-workflows", fileName),
    path.resolve(cwd, "app", "comfy-workflows", fileName),
    path.resolve(cwd, "..", "app", "comfy-workflows", fileName),
    path.resolve(repoRoot, WORKFLOW_RELATIVE_PATH),
    path.resolve(repoRoot, "app", "comfy-workflows", fileName),
  ];

  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function unwrapWorkflowJsonV36BPE1(value: unknown, filePath: string): JsonRecord {
  let current: unknown = value;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "string") {
      current = JSON.parse(current);
      continue;
    }

    if (isRecord(current)) {
      if (isRecord(current.prompt)) return current.prompt;
      if (isRecord(current.workflow)) return current.workflow;
      if (isRecord(current.graph)) return current.graph;
      return current;
    }

    break;
  }

  throw new Error(`SCENE_PASS_BAD_WORKFLOW_JSON: workflow JSON root must be an object. File: ${filePath}`);
}

function parseWorkflowJsonTextV36BPE1(raw: string, filePath: string): JsonRecord {
  const cleaned = raw.replace(/^\uFEFF/, "").trim();
  const attempts: string[] = [];

  const candidates = [
    cleaned,
    cleaned.startsWith('"') && cleaned.endsWith('"') ? cleaned : "",
    cleaned.includes('\\"') ? cleaned.replace(/\\"/g, '"').replace(/^"|"$/g, "") : "",
  ].filter(Boolean);

  for (const candidate of Array.from(new Set(candidates))) {
    try {
      return unwrapWorkflowJsonV36BPE1(JSON.parse(candidate), filePath);
    } catch (error: any) {
      attempts.push(String(error?.message || error));
    }
  }

  const preview = cleaned.slice(0, 240).replace(/\s+/g, " ");
  throw new Error(
    `SCENE_PASS_BAD_WORKFLOW_JSON: could not parse workflow JSON file. File: ${filePath}. Preview: ${preview}. Attempts: ${attempts.slice(0, 3).join(" | ")}`,
  );
}


// OTG_SCENE_PASS_QWEN_BASE_WORKFLOW_BUILDER_V36BPF1_START
const OTG_SCENE_PASS_QWEN_BASE_WORKFLOW_V36BPF1_BASE64 = "ewogICIxIjogewogICAgImlucHV0cyI6IHsKICAgICAgInByb21wdCI6ICJOZXh0IFNjZW5lOnRoZSB0d28gY2hhcmFjdGVyIGh1ZyBvdXRzaWRlIGluIGZyb250IG9mIHRoZSBkb29yIiwKICAgICAgImNsaXAiOiBbCiAgICAgICAgIjMzIiwKICAgICAgICAwCiAgICAgIF0sCiAgICAgICJ2YWUiOiBbCiAgICAgICAgIjEwIiwKICAgICAgICAwCiAgICAgIF0sCiAgICAgICJpbWFnZTEiOiBbCiAgICAgICAgIjExIiwKICAgICAgICAwCiAgICAgIF0sCiAgICAgICJpbWFnZTIiOiBbCiAgICAgICAgIjE2NyIsCiAgICAgICAgMAogICAgICBdLAogICAgICAiaW1hZ2UzIjogWwogICAgICAgICIxNjgiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIlRleHRFbmNvZGVRd2VuSW1hZ2VFZGl0UGx1cyIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJUZXh0RW5jb2RlUXdlbkltYWdlRWRpdFBsdXMgKFBvc2l0aXZlIFByb21wdCkiCiAgICB9CiAgfSwKICAiMTAiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAidmFlX25hbWUiOiAicXdlbl9pbWFnZV92YWUuc2FmZXRlbnNvcnMiCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiVkFFTG9hZGVyIiwKICAgICJfbWV0YSI6IHsKICAgICAgInRpdGxlIjogIkxvYWQgVkFFIgogICAgfQogIH0sCiAgIjExIjogewogICAgImlucHV0cyI6IHsKICAgICAgImltYWdlIjogIkNoYXJhY3RlciBDYXJkXzAwMDA4Xy53ZWJwIgogICAgfSwKICAgICJjbGFzc190eXBlIjogIkxvYWRJbWFnZSIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJMb2FkIEltYWdlIDEiCiAgICB9CiAgfSwKICAiMTMiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAic2FtcGxlcyI6IFsKICAgICAgICAiOTkiLAogICAgICAgIDAKICAgICAgXSwKICAgICAgInZhZSI6IFsKICAgICAgICAiMTAiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIlZBRURlY29kZSIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJWQUUgRGVjb2RlIgogICAgfQogIH0sCiAgIjE0IjogewogICAgImlucHV0cyI6IHsKICAgICAgImZpbGVuYW1lX3ByZWZpeCI6ICJDb21meVVJIiwKICAgICAgImltYWdlcyI6IFsKICAgICAgICAiMTMiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIlNhdmVJbWFnZSIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJTYXZlIEltYWdlIgogICAgfQogIH0sCiAgIjMwIjogewogICAgImlucHV0cyI6IHsKICAgICAgInNoaWZ0IjogMywKICAgICAgIm1vZGVsIjogWwogICAgICAgICIxNjAiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIk1vZGVsU2FtcGxpbmdBdXJhRmxvdyIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJNb2RlbFNhbXBsaW5nQXVyYUZsb3ciCiAgICB9CiAgfSwKICAiMzIiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAidW5ldF9uYW1lIjogInF3ZW5faW1hZ2VfZWRpdF8yNTA5X2ZwOF9lNG0zZm4uc2FmZXRlbnNvcnMiLAogICAgICAid2VpZ2h0X2R0eXBlIjogImRlZmF1bHQiCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiVU5FVExvYWRlciIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJMb2FkIERpZmZ1c2lvbiBNb2RlbCIKICAgIH0KICB9LAogICIzMyI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJjbGlwX25hbWUiOiAicXdlbl8yLjVfdmxfN2JfZnA4X3NjYWxlZC5zYWZldGVuc29ycyIsCiAgICAgICJ0eXBlIjogInF3ZW5faW1hZ2UiLAogICAgICAiZGV2aWNlIjogImRlZmF1bHQiCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiQ0xJUExvYWRlciIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJMb2FkIENMSVAiCiAgICB9CiAgfSwKICAiMzkiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAicHJvbXB0IjogIiIsCiAgICAgICJjbGlwIjogWwogICAgICAgICIzMyIsCiAgICAgICAgMAogICAgICBdLAogICAgICAidmFlIjogWwogICAgICAgICIxMCIsCiAgICAgICAgMAogICAgICBdLAogICAgICAiaW1hZ2UxIjogWwogICAgICAgICIxMSIsCiAgICAgICAgMAogICAgICBdCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiVGV4dEVuY29kZVF3ZW5JbWFnZUVkaXRQbHVzIiwKICAgICJfbWV0YSI6IHsKICAgICAgInRpdGxlIjogIlRleHRFbmNvZGVRd2VuSW1hZ2VFZGl0UGx1cyAoTmVnYXRpdmUgUHJvbXB0KSIKICAgIH0KICB9LAogICI5OSI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJzZWVkIjogMTk4MzY1NTIwOTE5MTQxLAogICAgICAic3RlcHMiOiA0LAogICAgICAiY2ZnIjogMSwKICAgICAgInNhbXBsZXJfbmFtZSI6ICJldWxlcl9hbmNlc3RyYWwiLAogICAgICAic2NoZWR1bGVyIjogInNpbXBsZSIsCiAgICAgICJkZW5vaXNlIjogMSwKICAgICAgIm1vZGVsIjogWwogICAgICAgICIzMCIsCiAgICAgICAgMAogICAgICBdLAogICAgICAicG9zaXRpdmUiOiBbCiAgICAgICAgIjEiLAogICAgICAgIDAKICAgICAgXSwKICAgICAgIm5lZ2F0aXZlIjogWwogICAgICAgICIzOSIsCiAgICAgICAgMAogICAgICBdLAogICAgICAibGF0ZW50X2ltYWdlIjogWwogICAgICAgICIxMzIiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIktTYW1wbGVyIiwKICAgICJfbWV0YSI6IHsKICAgICAgInRpdGxlIjogIktTYW1wbGVyIgogICAgfQogIH0sCiAgIjEzMiI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJ3aWR0aCI6IDEyODAsCiAgICAgICJoZWlnaHQiOiA3MjAsCiAgICAgICJiYXRjaF9zaXplIjogMQogICAgfSwKICAgICJjbGFzc190eXBlIjogIkVtcHR5U0QzTGF0ZW50SW1hZ2UiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiRW1wdHlTRDNMYXRlbnRJbWFnZSIKICAgIH0KICB9LAogICIxNjAiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAiUG93ZXJMb3JhTG9hZGVySGVhZGVyV2lkZ2V0IjogewogICAgICAgICJ0eXBlIjogIlBvd2VyTG9yYUxvYWRlckhlYWRlcldpZGdldCIKICAgICAgfSwKICAgICAgImxvcmFfMSI6IHsKICAgICAgICAib24iOiB0cnVlLAogICAgICAgICJsb3JhIjogIlF3ZW4tSW1hZ2UtRWRpdC0yNTA5LUxpZ2h0bmluZy00c3RlcHMtVjEuMC1iZjE2LnNhZmV0ZW5zb3JzIiwKICAgICAgICAic3RyZW5ndGgiOiAxCiAgICAgIH0sCiAgICAgICJsb3JhXzIiOiB7CiAgICAgICAgIm9uIjogdHJ1ZSwKICAgICAgICAibG9yYSI6ICJRd2VuLUVkaXQtMjUwOS1NdWx0aXBsZS1hbmdsZXMuc2FmZXRlbnNvcnMiLAogICAgICAgICJzdHJlbmd0aCI6IDEKICAgICAgfSwKICAgICAgImxvcmFfMyI6IHsKICAgICAgICAib24iOiB0cnVlLAogICAgICAgICJsb3JhIjogIm5leHQtc2NlbmVfbG9yYS12Mi0zMDAwLnNhZmV0ZW5zb3JzIiwKICAgICAgICAic3RyZW5ndGgiOiAwLjcKICAgICAgfSwKICAgICAgIuKelSBBZGQgTG9yYSI6ICIiLAogICAgICAibW9kZWwiOiBbCiAgICAgICAgIjMyIiwKICAgICAgICAwCiAgICAgIF0KICAgIH0sCiAgICAiY2xhc3NfdHlwZSI6ICJQb3dlciBMb3JhIExvYWRlciAocmd0aHJlZSkiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiUG93ZXIgTG9yYSBMb2FkZXIgKHJndGhyZWUpIgogICAgfQogIH0sCiAgIjE2NyI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJpbWFnZSI6ICJmdXR1cmUtY29tcGxldGUtYmFja2dyb3VuZC1wbGF0ZS1tcTgxYXI4Ny05bDA0emZfMDAwMDFfLnBuZyIKICAgIH0sCiAgICAiY2xhc3NfdHlwZSI6ICJMb2FkSW1hZ2UiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiTG9hZCBJbWFnZSIKICAgIH0KICB9LAogICIxNjgiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAiaW1hZ2UiOiAiMDA5LnBuZyIKICAgIH0sCiAgICAiY2xhc3NfdHlwZSI6ICJMb2FkSW1hZ2UiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiTG9hZCBJbWFnZSIKICAgIH0KICB9Cn0=";

function cloneScenePassQwenBaseWorkflowV36BPF1(): JsonRecord {
  const decoded = Buffer.from(OTG_SCENE_PASS_QWEN_BASE_WORKFLOW_V36BPF1_BASE64, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as unknown;
  if (!isRecord(parsed)) throw new Error("SCENE_PASS_QWEN_BASE_WORKFLOW_BAD_JSON: embedded Qwen base workflow is not an object.");
  return parsed;
}

function getScenePassNodeInputsV36BPF1(workflow: JsonRecord, nodeId: string) {
  const node = workflow[nodeId];
  if (!isRecord(node)) throw new Error(`SCENE_PASS_QWEN_BASE_WORKFLOW_NODE_MISSING: node ${nodeId} is missing.`);
  if (!isRecord(node.inputs)) node.inputs = {};
  return node.inputs as JsonRecord;
}

function removeScenePassNodeInputV36BPF1(workflow: JsonRecord, nodeId: string, inputName: string) {
  const node = workflow[nodeId];
  if (isRecord(node) && isRecord(node.inputs)) delete (node.inputs as JsonRecord)[inputName];
}

// OTG_SCENE_PASS_QWEN_IMAGE_BINDING_V36BPJ1_START
function assertScenePassQwenImageBindingsV36BPJ1(workflow: JsonRecord, references: NormalizedReference[]) {
  const positiveInputs = getScenePassNodeInputsV36BPF1(workflow, "1");
  const negativeInputs = getScenePassNodeInputsV36BPF1(workflow, "39");
  const loadImageNodeIds = ["11", "167", "168"];
  const inputNames = ["image1", "image2", "image3"];
  const selectedReferences = references.slice(0, 3);

  const hasBinding = (value: unknown, nodeId: string) =>
    Array.isArray(value) && String(value[0] ?? "") === nodeId && Number(value[1]) === 0;

  const bindings = selectedReferences.map((reference, index) => {
    const nodeId = loadImageNodeIds[index];
    const inputName = inputNames[index];
    const expectedImage = asString(reference.workflowImage);
    const loadImageInputs = getScenePassNodeInputsV36BPF1(workflow, nodeId);
    const actualImage = asString(loadImageInputs.image);

    if (!expectedImage || actualImage !== expectedImage) {
      throw new Error(
        `SCENE_PASS_QWEN_LOAD_IMAGE_BINDING_FAILED: ${inputName} expected ${expectedImage || "(empty)"} in node ${nodeId}, received ${actualImage || "(empty)"}.`,
      );
    }

    if (!hasBinding(positiveInputs[inputName], nodeId) || !hasBinding(negativeInputs[inputName], nodeId)) {
      throw new Error(
        `SCENE_PASS_QWEN_ENCODER_IMAGE_BINDING_FAILED: ${inputName} must connect LoadImage node ${nodeId} to both positive and negative Qwen encoders.`,
      );
    }

    return {
      slot: reference.slot,
      type: reference.type,
      name: reference.name,
      inputName,
      loadImageNodeId: nodeId,
      workflowImage: expectedImage,
      positiveEncoderNodeId: "1",
      negativeEncoderNodeId: "39",
    };
  });

  for (let index = selectedReferences.length; index < loadImageNodeIds.length; index += 1) {
    const nodeId = loadImageNodeIds[index];
    const inputName = inputNames[index];
    const hasUnusedLoadImageNode = isRecord(workflow[nodeId]);
    const hasUnusedPositiveBinding = Object.prototype.hasOwnProperty.call(positiveInputs, inputName);
    const hasUnusedNegativeBinding = Object.prototype.hasOwnProperty.call(negativeInputs, inputName);

    if (hasUnusedLoadImageNode || hasUnusedPositiveBinding || hasUnusedNegativeBinding) {
      throw new Error(
        `SCENE_PASS_QWEN_UNUSED_IMAGE_BINDING_FAILED: unused ${inputName} / LoadImage node ${nodeId} was not removed.`,
      );
    }
  }

  return bindings;
}
// OTG_SCENE_PASS_QWEN_IMAGE_BINDING_V36BPJ1_END

function buildScenePassQwenWorkflowV36BPF1(references: NormalizedReference[], positivePrompt: string, negativePrompt: string): JsonRecord {
  const imageNames = references
    .map((ref) => asString(ref.workflowImage))
    .filter(Boolean)
    .slice(0, 3);

  if (imageNames.length < 1) {
    throw new Error("SCENE_PASS_REFERENCE_IMAGE_REQUIRED: at least one workflow image is required.");
  }

  const workflow = cloneScenePassQwenBaseWorkflowV36BPF1();

  const positiveInputs = getScenePassNodeInputsV36BPF1(workflow, "1");
  const negativeInputs = getScenePassNodeInputsV36BPF1(workflow, "39");

  positiveInputs.prompt = positivePrompt;
  negativeInputs.prompt = negativePrompt || DEFAULT_NEGATIVE_PROMPT;

  getScenePassNodeInputsV36BPF1(workflow, "11").image = imageNames[0];
  positiveInputs.image1 = ["11", 0];
  negativeInputs.image1 = ["11", 0];

  if (imageNames.length >= 2) {
    getScenePassNodeInputsV36BPF1(workflow, "167").image = imageNames[1];
    positiveInputs.image2 = ["167", 0];
    negativeInputs.image2 = ["167", 0];
  } else {
    removeScenePassNodeInputV36BPF1(workflow, "1", "image2");
    removeScenePassNodeInputV36BPF1(workflow, "39", "image2");
    delete workflow["167"];
  }

  if (imageNames.length >= 3) {
    getScenePassNodeInputsV36BPF1(workflow, "168").image = imageNames[2];
    positiveInputs.image3 = ["168", 0];
    negativeInputs.image3 = ["168", 0];
  } else {
    removeScenePassNodeInputV36BPF1(workflow, "1", "image3");
    removeScenePassNodeInputV36BPF1(workflow, "39", "image3");
    delete workflow["168"];
  }

  const sizeInputs = getScenePassNodeInputsV36BPF1(workflow, "132");
  sizeInputs.width = OUTPUT_WIDTH;
  sizeInputs.height = OUTPUT_HEIGHT;

  assertScenePassQwenImageBindingsV36BPJ1(workflow, references);
  recursivelyPatchSeedsAndSize(workflow);
  return workflow;
}
// OTG_SCENE_PASS_QWEN_BASE_WORKFLOW_BUILDER_V36BPF1_END

async function loadWorkflow() {
  const attempts: string[] = [];

  for (const workflowPath of workflowCandidatePathsV36BPE1()) {
    const stat = await fs.stat(workflowPath).catch(() => null);
    if (!stat?.isFile()) {
      attempts.push(`${workflowPath}: not found`);
      continue;
    }

    try {
      const raw = await fs.readFile(workflowPath, "utf8");
      return parseWorkflowJsonTextV36BPE1(raw, workflowPath);
    } catch (error: any) {
      attempts.push(`${workflowPath}: ${String(error?.message || error)}`);
    }
  }

  throw new Error(`SCENE_PASS_WORKFLOW_NOT_LOADABLE: ${attempts.join(" || ")}`);
}


function findFirstComfyImage(value: unknown, seen = new Set<object>()): ComfyImage | null {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstComfyImage(item, seen);
      if (found) return found;
    }
    return null;
  }

  const record = value as JsonRecord;
  const filename = asString(record.filename);
  if (filename) {
    return {
      filename,
      subfolder: asString(record.subfolder),
      type: asString(record.type) || "output",
    };
  }

  for (const child of Object.values(record)) {
    const found = findFirstComfyImage(child, seen);
    if (found) return found;
  }

  return null;
}

function buildComfyViewUrl(comfyUrl: string, image: ComfyImage) {
  const search = new URLSearchParams();
  search.set("filename", image.filename);
  search.set("type", image.type || "output");
  if (image.subfolder) search.set("subfolder", image.subfolder);
  return `${comfyUrl}/view?${search.toString()}`;
}

async function waitForComfyOutput(comfyUrl: string, promptId: string, waitMs: number) {
  const deadline = Date.now() + Math.max(0, waitMs);
  let lastHistory: unknown = null;

  while (Date.now() <= deadline) {
    const response = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
    if (response.ok) {
      const history = (await response.json().catch(() => null)) as unknown;
      lastHistory = history;
      const image = findFirstComfyImage(history);
      if (image) {
        return {
          image,
          imageUrl: buildComfyViewUrl(comfyUrl, image),
          history,
        };
      }
    }

    await sleep(1000);
  }

  return {
    image: null,
    imageUrl: "",
    history: lastHistory,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequest(request);
    const receivedReferences = validateReferences(body.references);
    const references = orderScenePassReferencesV1(receivedReferences);

    console.info("[scene-pass-reference-order]", {
      received: receivedReferences.map((ref) => ({ slot: ref.slot, type: ref.type, name: ref.name })),
      workflow: references.map((ref) => ({ slot: ref.slot, type: ref.type, name: ref.name })),
      includesCharacter: references.some((ref) => ref.type === "character"),
      includesBackground: references.some((ref) => ref.type === "background" || ref.type === "plate"),
    });

    const positivePrompt = buildPositivePrompt(body, references);
    const negativePrompt = buildNegativePrompt(body);

    const comfyReferences = await prepareScenePassReferencesForComfyV36BPG1(references, request.nextUrl.origin);
    const workflow = buildScenePassQwenWorkflowV36BPF1(comfyReferences, positivePrompt, negativePrompt);
    const workflowImageBindings = assertScenePassQwenImageBindingsV36BPJ1(workflow, comfyReferences);

    console.info("[scene-pass-qwen-image-bindings]", {
      bindings: workflowImageBindings,
      includesCharacter: comfyReferences.some((ref) => ref.type === "character"),
      includesBackground: comfyReferences.some((ref) => ref.type === "background" || ref.type === "plate"),
    });

    const clientId = asString(body.clientId) || `otg-scene-pass-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const comfyUrl = getComfyUrl();
    const response = await submitComfyPromptWith5060Lease({
      baseUrl: comfyUrl,
      workerId: "api-production-picture-scene-pass",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      return jsonResponse(502, {
        ok: false,
        error: "SCENE_PASS_COMFY_SUBMIT_FAILED",
        status: response.status,
        details: responseText.slice(0, 4000),
      });
    }

    let comfyResult: unknown = responseText;
    try {
      comfyResult = JSON.parse(responseText);
    } catch {
      // Keep text response.
    }

    const promptId = isRecord(comfyResult) ? asString(comfyResult.prompt_id) : "";
    const shouldWait = asBoolean(body.waitForResult, true);
    const waitMs = Math.min(Math.max(asNumber(body.waitMs) ?? 120000, 0), 300000);
    const output = shouldWait && promptId ? await waitForComfyOutput(comfyUrl, promptId, waitMs) : null;

    return jsonResponse(200, {
      ok: true,
      route: "production-picture-scene-pass-v36bo5b",
      sceneId: asString(body.sceneId),
      passIndex: asNumber(body.passIndex) ?? 1,
      clientId,
      promptId,
      comfyUrl,
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      positivePrompt,
      negativePrompt,
      references: references.map((ref) => ({
        slot: ref.slot,
        type: ref.type,
        name: ref.name,
        workflowImage: ref.workflowImage,
        locked: ref.locked,
      })),
      stagedReferences: comfyReferences.map((ref) => ({
        slot: ref.slot,
        type: ref.type,
        name: ref.name,
        workflowImage: ref.workflowImage,
      })),
      workflowImageBindings,
      includesCharacter: references.some((ref) => ref.type === "character"),
      includesBackground: references.some((ref) => ref.type === "background" || ref.type === "plate"),
      outputImage: output?.image || null,
      outputImageUrl: output?.imageUrl || "",
      outputWorkflowImage: output?.image?.filename || "",
      comfyResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(400, {
      ok: false,
      route: "production-picture-scene-pass-v36bo5b",
      error: message,
    });
  }
}
