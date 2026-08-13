import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";

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

function cleanComfyFilename(value: string) {
  let text = decodeSafe(String(value || "").trim());

  try {
    const parsed = new URL(text);
    text = parsed.searchParams.get("filename") || parsed.searchParams.get("path") || text;
  } catch {
    // Not a URL.
  }

  text = decodeSafe(text)
    .replace(/\?.*$/, "")
    .replace(/\s\[(output|input|temp)\]$/i, "")
    .trim();

  text = normalizeSlash(text);

  const filename = text.split("/").filter(Boolean).pop() || "";
  const extension = path.extname(filename).toLowerCase();

  if (!filename || !IMAGE_EXTENSIONS.has(extension)) return "";

  return filename;
}

function cleanAbsolutePath(value: string) {
  let text = decodeSafe(String(value || "").trim());

  try {
    const parsed = new URL(text);
    text = parsed.searchParams.get("path") || parsed.searchParams.get("filename") || text;
  } catch {
    // Not a URL.
  }

  text = decodeSafe(text)
    .replace(/\?.*$/, "")
    .replace(/\s\[(output|input|temp)\]$/i, "")
    .trim();

  return path.normalize(text);
}

function cleanSubfolder(value: string) {
  const text = normalizeSlash(decodeSafe(String(value || "").trim()))
    .replace(/\?.*$/, "")
    .replace(/^\/+|\/+$/g, "");

  if (!text || text === "." || text === "..") return "";

  return text
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== "." && part !== "..")
    .join(path.sep);
}

function contentTypeFor(filename: string) {
  const extension = path.extname(filename).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";

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
  return String(
    process.env.COMFYUI_BASE_URL ||
      process.env.COMFY_BASE_URL ||
      process.env.COMFYUI_URL ||
      process.env.NEXT_PUBLIC_COMFYUI_URL ||
      "http://127.0.0.1:8188",
  ).replace(/\/+$/, "");
}

function candidateOutputRoots() {
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
    path.join(process.cwd(), "output"),
  ]);
}

function candidateInputRoots() {
  const comfyRoot =
    process.env.COMFYUI_ROOT_DIR ||
    process.env.COMFY_ROOT_DIR ||
    process.env.OTG_COMFY_ROOT_DIR ||
    "";

  return uniqueList([
    process.env.COMFYUI_INPUT_DIR,
    process.env.COMFY_INPUT_DIR,
    process.env.OTG_COMFY_INPUT_DIR,

    comfyRoot ? path.join(comfyRoot, "input") : "",

    "E:\\Renders\\ComfyUI\\input",
    "C:\\AI\\ComfyUI\\input",
    "C:\\AI\\ComfyUI_windows_portable\\ComfyUI\\input",
    "C:\\AI\\ComfyUI_windows_portable\\input",
    "C:\\ComfyUI\\input",
    "D:\\ComfyUI\\input",
    path.join(process.cwd(), "input"),
  ]);
}

function candidateTempRoots() {
  const comfyRoot =
    process.env.COMFYUI_ROOT_DIR ||
    process.env.COMFY_ROOT_DIR ||
    process.env.OTG_COMFY_ROOT_DIR ||
    "";

  return uniqueList([
    process.env.COMFYUI_TEMP_DIR,
    process.env.COMFY_TEMP_DIR,
    process.env.OTG_COMFY_TEMP_DIR,

    comfyRoot ? path.join(comfyRoot, "temp") : "",

    "E:\\Renders\\ComfyUI\\temp",
    "C:\\AI\\ComfyUI\\temp",
    "C:\\AI\\ComfyUI_windows_portable\\ComfyUI\\temp",
    "C:\\AI\\ComfyUI_windows_portable\\temp",
    "C:\\ComfyUI\\temp",
    "D:\\ComfyUI\\temp",
    path.join(process.cwd(), "temp"),
  ]);
}

function rootsForType(type: string) {
  const cleanType = String(type || "output").toLowerCase();

  if (cleanType === "input") return candidateInputRoots();
  if (cleanType === "temp" || cleanType === "temporary") return candidateTempRoots();

  return candidateOutputRoots();
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

async function findLocalComfyImage(args: {
  filename: string;
  type: string;
  subfolder: string;
  rawPath: string;
  rawFilename: string;
}) {
  const roots = rootsForType(args.type);

  for (const root of roots) {
    const direct = args.subfolder
      ? path.join(root, args.subfolder, args.filename)
      : path.join(root, args.filename);

    if (isInsideRoot(root, direct) && await existsFile(direct)) {
      return direct;
    }
  }

  const absoluteCandidates = uniqueList([
    cleanAbsolutePath(args.rawPath),
    cleanAbsolutePath(args.rawFilename),
  ]);

  for (const absoluteCandidate of absoluteCandidates) {
    if (!absoluteCandidate || !path.isAbsolute(absoluteCandidate)) continue;

    for (const root of roots) {
      if (isInsideRoot(root, absoluteCandidate) && await existsFile(absoluteCandidate)) {
        return absoluteCandidate;
      }
    }
  }

  return "";
}

async function streamLocalImage(filePath: string, filename: string) {
  const stats = await stat(filePath);
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(filename),
      "Content-Length": String(stats.size),
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store, max-age=0",
      "X-OTG-Comfy-Image-Source": "local-fullres-file-v36aa",
      "X-OTG-Comfy-Image-Path": filePath,
      "X-OTG-Comfy-Image-Size": String(stats.size),
    },
  });
}

async function proxyComfyView(args: {
  filename: string;
  type: string;
  subfolder: string;
}) {
  const base = comfyBaseUrl();
  const url = new URL("/view", base);

  url.searchParams.set("filename", args.filename);
  url.searchParams.set("type", args.type || "output");
  url.searchParams.set("subfolder", args.subfolder || "");

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "image/*,*/*",
    },
  });

  if (!response.ok) return null;

  const body = await response.arrayBuffer();

  if (!body.byteLength) return null;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") || contentTypeFor(args.filename),
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${args.filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store, max-age=0",
      "X-OTG-Comfy-Image-Source": "comfy-view-fullres-proxy-v36aa",
      "X-OTG-Comfy-View-Url": url.toString(),
    },
  });
}

// OTG_COMFY_IMAGE_LIVE_ROUTE_V36AA
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const type = String(params.get("type") || "output").trim() || "output";
  const subfolder = cleanSubfolder(params.get("subfolder") || "");
  const rawPath = params.get("path") || "";
  const rawFilename =
    params.get("filename") ||
    params.get("name") ||
    params.get("file") ||
    rawPath;

  const filename = cleanComfyFilename(rawFilename);

  if (!filename) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing or invalid image filename.",
        expected: "Call /api/comfy-image?filename=<image.png>&type=output",
        marker: "OTG_COMFY_IMAGE_LIVE_ROUTE_V36AA",
      },
      { status: 400 },
    );
  }

  const localFile = await findLocalComfyImage({
    filename,
    type,
    subfolder,
    rawPath,
    rawFilename,
  });

  if (params.get("debug") === "1") {
    return NextResponse.json({
      ok: Boolean(localFile),
      marker: "OTG_COMFY_IMAGE_LIVE_ROUTE_V36AA",
      filename,
      type,
      subfolder,
      resolvedPath: localFile || null,
      exists: Boolean(localFile),
      roots: rootsForType(type),
      comfyBaseUrl: comfyBaseUrl(),
    });
  }

  if (localFile) {
    return streamLocalImage(localFile, filename);
  }

  const proxied = await proxyComfyView({
    filename,
    type,
    subfolder,
  });

  if (proxied) return proxied;

  return NextResponse.json(
    {
      ok: false,
      marker: "OTG_COMFY_IMAGE_LIVE_ROUTE_V36AA",
      error: "Could not find full-resolution ComfyUI image.",
      filename,
      type,
      subfolder,
      searchedRoots: rootsForType(type),
      comfyBaseUrl: comfyBaseUrl(),
      envHint: "Set COMFYUI_OUTPUT_DIR=E:\\Renders\\ComfyUI if your output path changes.",
    },
    { status: 404 },
  );
}
