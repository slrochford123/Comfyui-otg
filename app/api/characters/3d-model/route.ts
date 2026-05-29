import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_ROOT = process.cwd();
const DATA_ROOT = path.join(PROJECT_ROOT, "data");
const DEVICE_ID = "web_characters_builder";

const HY3D_PYTHON = process.env.HY3D_PYTHON || "C:\\AI\\Hunyuan3D\\python_standalone\\python.exe";
const HY3D_SCRIPT = path.join(PROJECT_ROOT, "scripts", "hy3d_character_shape.py");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function safeId(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  const safe = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  return safe || "character";
}

function normalizeAbsolute(inputPath: string): string {
  return path.resolve(inputPath);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function requireInsideDataRoot(filePath: string): string {
  const absolute = normalizeAbsolute(filePath);
  if (!isInside(DATA_ROOT, absolute)) {
    throw new Error(`Path is outside data root: ${filePath}`);
  }
  return absolute;
}

function toDataRelative(filePath: string): string {
  const absolute = requireInsideDataRoot(filePath);
  return path.relative(DATA_ROOT, absolute).replace(/\\/g, "/");
}

function updateSavedCharacter3dModel(characterId: string, modelRecord: Record<string, unknown>) {
  const characterPath = path.join(DATA_ROOT, "characters", DEVICE_ID, `${characterId}.json`);

  if (!existsSync(characterPath)) {
    return {
      updated: false,
      characterPath,
      reason: "Saved character JSON not found. Model generated but record was not updated.",
    };
  }

  const current = JSON.parse(readFileSync(characterPath, "utf8"));
  const next = {
    ...current,
    character3dModel: modelRecord,
    character3dModelPath: modelRecord.modelPath || "",
    character3dModelUrl: modelRecord.modelUrl || "",
    character3dModelOutputPath: modelRecord.outputPath || "",
    character3dModelEngine: modelRecord.engine || "",
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(characterPath, JSON.stringify(next, null, 2), "utf8");

  return {
    updated: true,
    characterPath,
  };
}

function dataPathFromRequest(value: string): string {
  const decoded = decodeURIComponent(value || "").replace(/\0/g, "");
  const absolute = path.isAbsolute(decoded)
    ? decoded
    : path.join(DATA_ROOT, decoded.replace(/^\/+/, ""));
  return requireInsideDataRoot(absolute);
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".gltf") return "model/gltf+json";
  if (ext === ".obj") return "text/plain; charset=utf-8";
  if (ext === ".ply") return "application/octet-stream";
  return "application/octet-stream";
}

function runHy3D(args: string[], timeoutMs = 45 * 60 * 1000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!existsSync(HY3D_PYTHON)) {
      reject(new Error(`Missing HY3D Python: ${HY3D_PYTHON}`));
      return;
    }

    if (!existsSync(HY3D_SCRIPT)) {
      reject(new Error(`Missing HY3D wrapper script: ${HY3D_SCRIPT}`));
      return;
    }

    const child = spawn(HY3D_PYTHON, [HY3D_SCRIPT, ...args], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    const limit = 512_000;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > limit) stdout = stdout.slice(-limit);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > limit) stderr = stderr.slice(-limit);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`HY3D generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`HY3D exited with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

type Hy3dGlbQuality = {
  bytes: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  accessorCount: number;
  dimensions: {
    x: number;
    y: number;
    z: number;
    smallest: number;
    middle: number;
    largest: number;
  };
  thicknessRatio: number;
  midRatio: number;
  score: number;
  warning: string;
};

function tailText(value: string, maxLength = 6000): string {
  if (!value) return "";
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

function readGlbQuality(filePath: string): Hy3dGlbQuality {
  const buffer = readFileSync(filePath);

  if (buffer.length < 20) {
    throw new Error(`GLB is too small to inspect: ${filePath}`);
  }

  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== "glTF") {
    throw new Error(`Not a GLB file: ${filePath}`);
  }

  const jsonLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.toString("ascii", 16, 20);

  if (jsonChunkType !== "JSON") {
    throw new Error(`First GLB chunk is not JSON: ${filePath}`);
  }

  const jsonText = buffer.toString("utf8", 20, 20 + jsonLength).trim();
  const gltf = JSON.parse(jsonText) as any;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let foundPositionAccessor = false;

  for (const mesh of gltf?.meshes || []) {
    for (const primitive of mesh?.primitives || []) {
      const accessorIndex = primitive?.attributes?.POSITION;

      if (typeof accessorIndex !== "number") {
        continue;
      }

      const accessor = gltf?.accessors?.[accessorIndex];

      if (!Array.isArray(accessor?.min) || !Array.isArray(accessor?.max)) {
        continue;
      }

      const min = accessor.min.map((value: unknown) => Number(value));
      const max = accessor.max.map((value: unknown) => Number(value));

      if (min.length < 3 || max.length < 3 || min.some(Number.isNaN) || max.some(Number.isNaN)) {
        continue;
      }

      foundPositionAccessor = true;
      minX = Math.min(minX, min[0]);
      minY = Math.min(minY, min[1]);
      minZ = Math.min(minZ, min[2]);
      maxX = Math.max(maxX, max[0]);
      maxY = Math.max(maxY, max[1]);
      maxZ = Math.max(maxZ, max[2]);
    }
  }

  if (!foundPositionAccessor) {
    return {
      bytes: buffer.length,
      meshCount: Array.isArray(gltf?.meshes) ? gltf.meshes.length : 0,
      materialCount: Array.isArray(gltf?.materials) ? gltf.materials.length : 0,
      textureCount: Array.isArray(gltf?.textures) ? gltf.textures.length : 0,
      imageCount: Array.isArray(gltf?.images) ? gltf.images.length : 0,
      accessorCount: Array.isArray(gltf?.accessors) ? gltf.accessors.length : 0,
      dimensions: { x: 0, y: 0, z: 0, smallest: 0, middle: 0, largest: 0 },
      thicknessRatio: 0,
      midRatio: 0,
      score: -1000,
      warning: "No POSITION accessor bounds found.",
    };
  }

  const x = Math.abs(maxX - minX);
  const y = Math.abs(maxY - minY);
  const z = Math.abs(maxZ - minZ);
  const sorted = [x, y, z].sort((a, b) => a - b);
  const smallest = sorted[0] || 0;
  const middle = sorted[1] || 0;
  const largest = sorted[2] || 0;
  const thicknessRatio = largest > 0 ? smallest / largest : 0;
  const midRatio = largest > 0 ? middle / largest : 0;

  const flatPenalty = thicknessRatio < 0.09 ? -30 : 0;
  const tinyPenalty = buffer.length < 3_000_000 ? -10 : 0;
  const score =
    thicknessRatio * 100 +
    midRatio * 15 +
    Math.log10(Math.max(buffer.length, 10)) * 0.8 +
    flatPenalty +
    tinyPenalty;

  const warning =
    thicknessRatio < 0.09
      ? "Very thin generated mesh."
      : thicknessRatio < 0.16
        ? "Thin generated mesh."
        : "";

  return {
    bytes: buffer.length,
    meshCount: Array.isArray(gltf?.meshes) ? gltf.meshes.length : 0,
    materialCount: Array.isArray(gltf?.materials) ? gltf.materials.length : 0,
    textureCount: Array.isArray(gltf?.textures) ? gltf.textures.length : 0,
    imageCount: Array.isArray(gltf?.images) ? gltf.images.length : 0,
    accessorCount: Array.isArray(gltf?.accessors) ? gltf.accessors.length : 0,
    dimensions: {
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
      z: Number(z.toFixed(6)),
      smallest: Number(smallest.toFixed(6)),
      middle: Number(middle.toFixed(6)),
      largest: Number(largest.toFixed(6)),
    },
    thicknessRatio: Number(thicknessRatio.toFixed(6)),
    midRatio: Number(midRatio.toFixed(6)),
    score: Number(score.toFixed(6)),
    warning,
  };
}
type Hy3dGenerationResult = {
  modelRecord: Record<string, unknown>;
  outputPath: string;
};

type GradioFileData = {
  path?: string;
  url?: string;
  size?: number;
  orig_name?: string;
  mime_type?: string | null;
  is_stream?: boolean;
  meta?: Record<string, unknown>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/g, "");
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 1200)}`);
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function postJsonWithTimeout(url: string, payload: unknown, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 1200)}`);
    }

    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

function gradioFileForLocalPath(filePath: string): GradioFileData {
  const stats = statSync(filePath);

  return {
    path: filePath,
    orig_name: path.basename(filePath),
    mime_type: "image/png",
    size: stats.size,
    is_stream: false,
    meta: {
      _type: "gradio.FileData",
    },
  };
}

function extractCompleteDataFromSse(eventStream: string): any[] {
  const lines = eventStream.split(/\r?\n/);
  let currentEvent = "";
  let dataLines: string[] = [];
  let completeData = "";

  function flushEvent() {
    if (currentEvent === "complete") {
      completeData = dataLines.join("\n");
    }

    if (currentEvent === "error") {
      throw new Error(`Gradio event stream returned error: ${dataLines.join("\n")}`);
    }

    currentEvent = "";
    dataLines = [];
  }

  for (const line of lines) {
    if (line.trim() === "") {
      flushEvent();
      continue;
    }

    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
      continue;
    }
  }

  flushEvent();

  if (!completeData) {
    throw new Error("Gradio event stream did not contain event: complete.");
  }

  const parsed = JSON.parse(completeData);

  if (!Array.isArray(parsed)) {
    throw new Error("Gradio complete payload was not an array.");
  }

  return parsed;
}

function extractGradioFilesFromOutputs(outputs: any[]): GradioFileData[] {
  const files: GradioFileData[] = [];

  for (const item of outputs) {
    const value = item?.value;

    if (value && typeof value === "object" && (typeof value.path === "string" || typeof value.url === "string")) {
      files.push(value as GradioFileData);
    } else if (item && typeof item === "object" && (typeof item.path === "string" || typeof item.url === "string")) {
      files.push(item as GradioFileData);
    }
  }

  return files;
}

async function copyGradioFileToPath(file: GradioFileData, outputPath: string): Promise<void> {
  mkdirSync(path.dirname(outputPath), { recursive: true });

  if (file.path && existsSync(file.path)) {
    copyFileSync(file.path, outputPath);
    return;
  }

  if (file.url) {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Failed to download Gradio output ${file.url}: HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(outputPath, bytes);
    return;
  }

  throw new Error(`Gradio file has no usable path or url: ${JSON.stringify(file)}`);
}

async function generateWithGradioBackend(characterId: string, imagePath: string, modelDir: string, outputPath: string): Promise<Hy3dGenerationResult> {
  const baseUrl = normalizeBaseUrl(process.env.HY3D_GRADIO_URL || "http://127.0.0.1:8080");
  const callUrl = `${baseUrl}/gradio_api/call/generation_all`;

  const payload = {
    data: [
      "",
      gradioFileForLocalPath(imagePath),
      null,
      null,
      null,
      null,
      Number(process.env.HY3D_GRADIO_STEPS || "5"),
      Number(process.env.HY3D_GRADIO_GUIDANCE || "5"),
      Number(process.env.HY3D_GRADIO_SEED || "1234"),
      Number(process.env.HY3D_GRADIO_OCTREE || "256"),
      process.env.HY3D_GRADIO_REMBG === "0" ? false : true,
      Number(process.env.HY3D_GRADIO_CHUNKS || "8000"),
      process.env.HY3D_GRADIO_RANDOMIZE_SEED === "0" ? false : true,
    ],
  };

  const callResponse = await postJsonWithTimeout(callUrl, payload, 60 * 1000);
  const eventId = String(callResponse?.event_id || "");

  if (!eventId) {
    throw new Error(`Gradio generation_all returned no event_id: ${JSON.stringify(callResponse)}`);
  }

  const resultUrl = `${callUrl}/${encodeURIComponent(eventId)}`;
  const eventStream = await fetchTextWithTimeout(resultUrl, 90 * 60 * 1000);
  const outputs = extractCompleteDataFromSse(eventStream);
  const files = extractGradioFilesFromOutputs(outputs);

  const texturedFile =
    files.find((file) => String(file.orig_name || file.path || "").toLowerCase().includes("textured") && String(file.path || file.url || "").toLowerCase().endsWith(".glb")) ||
    files.find((file) => String(file.path || file.url || "").toLowerCase().includes("textured") && String(file.path || file.url || "").toLowerCase().includes(".glb"));

  const whiteFile =
    files.find((file) => String(file.orig_name || file.path || "").toLowerCase().includes("white") && String(file.path || file.url || "").toLowerCase().endsWith(".glb")) ||
    files.find((file) => String(file.path || file.url || "").toLowerCase().includes(".glb"));

  const selectedFile = texturedFile || whiteFile;

  if (!selectedFile) {
    throw new Error(`Gradio generation_all completed but returned no GLB file. Files: ${JSON.stringify(files)}`);
  }

  await copyGradioFileToPath(selectedFile, outputPath);

  const stats = statSync(outputPath);

  if (stats.size < 1024) {
    throw new Error(`Copied Gradio GLB is too small: ${stats.size} bytes.`);
  }

  const quality = readGlbQuality(outputPath);
  const modelPath = toDataRelative(outputPath);
  const modelUrl = `/api/characters/3d-model?path=${encodeURIComponent(modelPath)}`;
  const meshStats = outputs.find((item) => item && typeof item === "object" && item.number_of_faces);
  const seed = typeof outputs[4] === "number" ? outputs[4] : null;

  return {
    outputPath,
    modelRecord: {
      engine: "Hunyuan3D-Gradio-API",
      backend: "gradio-api",
      backendUrl: baseUrl,
      endpoint: "generation_all",
      eventId,
      characterId,
      inputPath: imagePath,
      outputPath,
      modelPath,
      modelUrl,
      bytes: stats.size,
      quality,
      gradio: {
        selectedOutput: selectedFile,
        returnedFiles: files,
        meshStats: meshStats || null,
        seed,
        eventStreamTail: tailText(eventStream, 12000),
      },
      texture: {
        enabled: true,
        status: texturedFile ? "ok" : "not-textured-output",
        selectedTexturedOutput: texturedFile || null,
      },
      createdAt: new Date().toISOString(),
    },
  };
}

async function generateWithLocalWrapperBackend(characterId: string, imagePath: string, modelDir: string, outputPath: string): Promise<Hy3dGenerationResult> {
  const texturedOutputPath = path.join(modelDir, "hy3d_preview_textured.glb");

  const variants = [
    {
      id: "raw",
      label: "Raw source image",
      preprocess: false,
      segmentationMethod: "",
    },
    {
      id: "center",
      label: "Centered full-body crop",
      preprocess: true,
      segmentationMethod: "center",
    },
    {
      id: "grabcut",
      label: "GrabCut subject mask",
      preprocess: true,
      segmentationMethod: "grabcut",
    },
  ];

  const variantResults: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const variantOutputPath = path.join(modelDir, `hy3d_preview_${variant.id}.glb`);
    const variantPreprocessedInputPath = path.join(modelDir, `hy3d_input_${variant.id}.png`);

    const args = [
      "--input",
      imagePath,
      "--character-id",
      characterId,
      "--output",
      variantOutputPath,
    ];

    if (variant.preprocess) {
      args.push(
        "--preprocess-input",
        "--preprocess-output",
        variantPreprocessedInputPath,
        "--segmentation-method",
        variant.segmentationMethod,
        "--image-size",
        "1024",
      );
    }

    try {
      const { stdout, stderr } = await runHy3D(args);

      if (!existsSync(variantOutputPath)) {
        variantResults.push({
          id: variant.id,
          label: variant.label,
          ok: false,
          error: "HY3D finished but output GLB was not created.",
          outputPath: variantOutputPath,
          preprocessedInputPath: variant.preprocess ? variantPreprocessedInputPath : "",
          stdout: tailText(stdout),
          stderr: tailText(stderr),
        });
        continue;
      }

      const stats = statSync(variantOutputPath);

      if (stats.size < 1024) {
        variantResults.push({
          id: variant.id,
          label: variant.label,
          ok: false,
          error: `HY3D output is too small: ${stats.size} bytes.`,
          outputPath: variantOutputPath,
          preprocessedInputPath: variant.preprocess ? variantPreprocessedInputPath : "",
          stdout: tailText(stdout),
          stderr: tailText(stderr),
        });
        continue;
      }

      const quality = readGlbQuality(variantOutputPath);

      variantResults.push({
        id: variant.id,
        label: variant.label,
        ok: true,
        outputPath: variantOutputPath,
        modelPath: toDataRelative(variantOutputPath),
        preprocessedInputPath:
          variant.preprocess && existsSync(variantPreprocessedInputPath)
            ? variantPreprocessedInputPath
            : "",
        segmentationMethod: variant.segmentationMethod,
        bytes: stats.size,
        quality,
        stdout: tailText(stdout),
        stderr: tailText(stderr),
      });
    } catch (error: any) {
      variantResults.push({
        id: variant.id,
        label: variant.label,
        ok: false,
        error: error?.message || "HY3D variant generation failed.",
        outputPath: variantOutputPath,
        preprocessedInputPath: variant.preprocess ? variantPreprocessedInputPath : "",
      });
    }
  }

  const successfulVariants = variantResults
    .filter((variant) => variant.ok === true && typeof (variant.quality as any)?.score === "number")
    .sort((a, b) => Number((b.quality as any).score) - Number((a.quality as any).score));

  if (successfulVariants.length === 0) {
    throw new Error(`All local HY3D variants failed: ${JSON.stringify(variantResults)}`);
  }

  const selectedVariant = successfulVariants[0];
  const selectedOutputPath = String(selectedVariant.outputPath || "");
  const selectedPreprocessedInputPath = String(selectedVariant.preprocessedInputPath || "");

  if (!existsSync(selectedOutputPath)) {
    throw new Error(`Selected local HY3D variant output does not exist: ${selectedOutputPath}`);
  }

  let finalSourcePath = selectedOutputPath;
  let textureRecord: Record<string, unknown> = {
    enabled: true,
    status: "not-run",
    outputPath: texturedOutputPath,
    sourceMeshPath: selectedOutputPath,
    imagePath,
  };

  try {
    const textureArgs = [
      "--input",
      imagePath,
      "--character-id",
      characterId,
      "--output",
      selectedOutputPath,
      "--texture-only",
      "--texture-input-mesh",
      selectedOutputPath,
      "--texture-image",
      imagePath,
      "--texture-output",
      texturedOutputPath,
      "--paint-max-views",
      "6",
      "--paint-resolution",
      "512",
      "--no-paint-remesh",
    ];

    const { stdout, stderr } = await runHy3D(textureArgs, 90 * 60 * 1000);

    if (existsSync(texturedOutputPath) && statSync(texturedOutputPath).size >= 1024) {
      finalSourcePath = texturedOutputPath;
      textureRecord = {
        ...textureRecord,
        status: "ok",
        outputPath: texturedOutputPath,
        bytes: statSync(texturedOutputPath).size,
        quality: readGlbQuality(texturedOutputPath),
        stdout: tailText(stdout),
        stderr: tailText(stderr),
      };
    } else {
      textureRecord = {
        ...textureRecord,
        status: "failed",
        error: "Texture generation finished but textured GLB was not created or was too small.",
        stdout: tailText(stdout),
        stderr: tailText(stderr),
      };
    }
  } catch (error: any) {
    textureRecord = {
      ...textureRecord,
      status: "failed",
      error: error?.message || "Texture generation failed.",
    };
  }

  copyFileSync(finalSourcePath, outputPath);

  const stats = statSync(outputPath);
  const finalQuality = readGlbQuality(outputPath);
  const modelPath = toDataRelative(outputPath);
  const modelUrl = `/api/characters/3d-model?path=${encodeURIComponent(modelPath)}`;

  return {
    outputPath,
    modelRecord: {
      engine: "Hunyuan3D-2.1",
      backend: "local-wrapper",
      characterId,
      inputPath: imagePath,
      preprocessedInputPath: selectedPreprocessedInputPath,
      preprocessing: {
        enabled: Boolean(selectedPreprocessedInputPath),
        outputPath: selectedPreprocessedInputPath,
        exists: selectedPreprocessedInputPath ? existsSync(selectedPreprocessedInputPath) : false,
        selectedVariantId: selectedVariant.id || "",
        selectedSegmentationMethod: selectedVariant.segmentationMethod || "",
      },
      texture: textureRecord,
      outputPath,
      modelPath,
      modelUrl,
      bytes: stats.size,
      quality: finalQuality,
      selectedQualityVariant: {
        id: selectedVariant.id,
        label: selectedVariant.label,
        outputPath: selectedVariant.outputPath,
        preprocessedInputPath: selectedVariant.preprocessedInputPath,
        segmentationMethod: selectedVariant.segmentationMethod,
        quality: selectedVariant.quality,
      },
      qualityVariants: variantResults.map((variant) => ({
        id: variant.id,
        label: variant.label,
        ok: variant.ok,
        error: variant.error || "",
        outputPath: variant.outputPath || "",
        preprocessedInputPath: variant.preprocessedInputPath || "",
        segmentationMethod: variant.segmentationMethod || "",
        bytes: variant.bytes || 0,
        quality: variant.quality || null,
      })),
      createdAt: new Date().toISOString(),
    },
  };
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return json(400, { ok: false, error: "Invalid JSON body." });
    }

    const characterId = safeId((body as any).characterId || (body as any).name || "character");
    const rawImagePath = String((body as any).imagePath || (body as any).inputPath || "").trim();

    if (!rawImagePath) {
      return json(400, { ok: false, error: "Missing imagePath." });
    }

    const imagePath = requireInsideDataRoot(rawImagePath);

    if (!existsSync(imagePath)) {
      return json(404, { ok: false, error: `Input image not found: ${imagePath}` });
    }

    const modelDir = path.join(DATA_ROOT, "characters", DEVICE_ID, characterId, "models");
    const outputPath = path.join(modelDir, "hy3d_preview.glb");

    mkdirSync(modelDir, { recursive: true });

    const backendPreference = String((body as any).backend || process.env.HY3D_BACKEND || "gradio").toLowerCase();
    const shouldUseGradio = backendPreference !== "local" && backendPreference !== "local-wrapper";
    const requireGradio = backendPreference === "gradio-required" || process.env.HY3D_GRADIO_REQUIRED === "1";

    let result: Hy3dGenerationResult;
    let gradioError = "";

    if (shouldUseGradio) {
      try {
        result = await generateWithGradioBackend(characterId, imagePath, modelDir, outputPath);
      } catch (error: any) {
        gradioError = error?.message || "Gradio backend failed.";

        if (requireGradio) {
          return json(502, {
            ok: false,
            error: gradioError,
            backend: "gradio-api",
            fallbackAttempted: false,
          });
        }

        result = await generateWithLocalWrapperBackend(characterId, imagePath, modelDir, outputPath);
        result.modelRecord = {
          ...result.modelRecord,
          gradioFallback: {
            attempted: true,
            failed: true,
            error: gradioError,
          },
        };
      }
    } else {
      result = await generateWithLocalWrapperBackend(characterId, imagePath, modelDir, outputPath);
    }

    const characterRecordUpdate = updateSavedCharacter3dModel(characterId, result.modelRecord);

    return json(200, {
      ok: true,
      ...result.modelRecord,
      characterRecordUpdate,
    });
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: error?.message || "HY3D generation failed.",
    });
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const requestedPath = url.searchParams.get("path") || "";

    if (!requestedPath) {
      return json(400, { ok: false, error: "Missing path query parameter." });
    }

    const filePath = dataPathFromRequest(requestedPath);
    const ext = path.extname(filePath).toLowerCase();

    if (![".glb", ".gltf", ".obj", ".ply"].includes(ext)) {
      return json(400, { ok: false, error: `Unsupported 3D model extension: ${ext}` });
    }

    if (!existsSync(filePath)) {
      return json(404, { ok: false, error: `File not found: ${filePath}` });
    }

    const stats = statSync(filePath);
    const range = request.headers.get("range");
    const contentType = contentTypeFor(filePath);

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        return json(416, { ok: false, error: "Invalid Range header." });
      }

      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : stats.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
        return json(416, { ok: false, error: "Requested range not satisfiable." });
      }

      const safeEnd = Math.min(end, stats.size - 1);
      const chunkSize = safeEnd - start + 1;
      const stream = createReadStream(filePath, { start, end: safeEnd });

      return new NextResponse(stream as any, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${safeEnd}/${stats.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }

    const stream = createReadStream(filePath);

    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stats.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: error?.message || "Failed to read 3D model file.",
    });
  }
}
