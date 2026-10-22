import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { normalizeRelativePath } from "@/lib/security/pathValidation";

export type ProtectedMediaKind = "image" | "video";

export type RemoteComfyFile = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export type PublishedProtectedMedia = {
  filePath: string;
  bytes: number;
  sha256: string;
  contentType: string;
  reused: boolean;
};

const ALLOWED_COMFY_TYPES = new Set(["input", "output", "temp"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

function normalizeBaseUrl(value: unknown) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  const parsed = new URL(text);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("ComfyUI backend must use HTTP or HTTPS.");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function assertTrustedBaseUrl(baseUrl: string, trustedBaseUrls: string[]) {
  const normalized = normalizeBaseUrl(baseUrl);
  const trusted = new Set(trustedBaseUrls.map(normalizeBaseUrl).filter(Boolean));
  if (!normalized || !trusted.has(normalized)) {
    throw new Error("ComfyUI output backend is not in the configured trusted backend registry.");
  }
  return normalized;
}

function assertDestination(root: string, destinationPath: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(destinationPath);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Protected media destination escaped its authorized storage root.");
  }
  return resolved;
}

function cleanRemoteFile(file: RemoteComfyFile, kind: ProtectedMediaKind) {
  const filename = String(file.filename || "").trim();
  if (!filename || path.basename(filename) !== filename || filename.includes("\0")) {
    throw new Error("ComfyUI output filename is invalid.");
  }
  const extension = path.extname(filename).toLowerCase();
  const extensions = kind === "image" ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  if (!extensions.has(extension)) {
    throw new Error(`ComfyUI output type is not an allowed ${kind} format.`);
  }
  const type = String(file.type || "output").trim().toLowerCase();
  if (!ALLOWED_COMFY_TYPES.has(type)) throw new Error("ComfyUI output bucket is invalid.");
  const rawSubfolder = String(file.subfolder || "").trim();
  const subfolder = rawSubfolder ? normalizeRelativePath(rawSubfolder) : "";
  return { filename, extension, type, subfolder };
}

function detectedContentType(kind: ProtectedMediaKind, bytes: Buffer) {
  if (kind === "image") {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  } else {
    if (bytes.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
    if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  }
  throw new Error(`Downloaded ComfyUI output is not a valid supported ${kind} file.`);
}

async function inspectFile(filePath: string, kind: ProtectedMediaKind, expectedSha256?: string) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Protected media file is missing or empty.");
  const handle = await fsp.open(filePath, "r");
  const header = Buffer.alloc(32);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const contentType = detectedContentType(kind, header);
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(filePath), new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  }), new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
  const sha256 = hash.digest("hex");
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    throw new Error("Protected media SHA-256 does not match the recorded source hash.");
  }
  return { bytes: stat.size, sha256, contentType };
}

async function publishTemp(tempPath: string, targetPath: string, kind: ProtectedMediaKind, expectedSha256?: string) {
  try {
    await fsp.link(tempPath, targetPath);
    await fsp.unlink(tempPath);
    const inspected = await inspectFile(targetPath, kind, expectedSha256);
    return { filePath: targetPath, ...inspected, reused: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await fsp.rm(tempPath, { force: true });
    const inspected = await inspectFile(targetPath, kind, expectedSha256);
    return { filePath: targetPath, ...inspected, reused: true };
  }
}

export async function publishLocalProtectedMedia(args: {
  sourcePath: string;
  storageRoot: string;
  destinationPath: string;
  kind: ProtectedMediaKind;
  expectedSha256?: string;
}): Promise<PublishedProtectedMedia> {
  const sourcePath = path.resolve(args.sourcePath);
  const destinationPath = assertDestination(args.storageRoot, args.destinationPath);
  const source = await inspectFile(sourcePath, args.kind, args.expectedSha256);
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  await fsp.chmod(path.dirname(destinationPath), 0o700);
  if (sourcePath === destinationPath) return { filePath: destinationPath, ...source, reused: true };
  const tempPath = `${destinationPath}.${randomUUID()}.tmp`;
  await fsp.copyFile(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(tempPath, 0o600);
  return publishTemp(tempPath, destinationPath, args.kind, args.expectedSha256 || source.sha256);
}

export async function retrieveRemoteComfyMedia(args: {
  baseUrl: string;
  trustedBaseUrls: string[];
  file: RemoteComfyFile;
  storageRoot: string;
  destinationPath: string;
  kind: ProtectedMediaKind;
  maxBytes?: number;
  fetcher?: typeof fetch;
}): Promise<PublishedProtectedMedia> {
  const baseUrl = assertTrustedBaseUrl(args.baseUrl, args.trustedBaseUrls);
  const file = cleanRemoteFile(args.file, args.kind);
  const destinationPath = assertDestination(args.storageRoot, args.destinationPath);
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  await fsp.chmod(path.dirname(destinationPath), 0o700);

  try {
    const existing = await inspectFile(destinationPath, args.kind);
    return { filePath: destinationPath, ...existing, reused: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const url = new URL(`${baseUrl}/view`);
  url.searchParams.set("filename", file.filename);
  url.searchParams.set("type", file.type);
  if (file.subfolder) url.searchParams.set("subfolder", file.subfolder);
  const response = await (args.fetcher || fetch)(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`ComfyUI output retrieval failed with HTTP ${response.status}.`);
  if (!response.body) throw new Error("ComfyUI output response had no body.");
  const maxBytes = args.maxBytes || (args.kind === "image" ? 100 * 1024 * 1024 : 4 * 1024 * 1024 * 1024);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error(`ComfyUI ${args.kind} output exceeds the protected-media size limit.`);

  const tempPath = `${destinationPath}.${randomUUID()}.tmp`;
  let total = 0;
  const headerChunks: Buffer[] = [];
  let headerBytes = 0;
  const hash = createHash("sha256");
  const validator = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) return callback(new Error(`ComfyUI ${args.kind} output exceeds the protected-media size limit.`));
      hash.update(chunk);
      if (headerBytes < 32) {
        const slice = chunk.subarray(0, Math.min(chunk.length, 32 - headerBytes));
        headerChunks.push(slice);
        headerBytes += slice.length;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      validator,
      fs.createWriteStream(tempPath, { flags: "wx", mode: 0o600 }),
    );
    if (total <= 0) throw new Error("ComfyUI output was empty.");
    const contentType = detectedContentType(args.kind, Buffer.concat(headerChunks));
    const sha256 = hash.digest("hex");
    const published = await publishTemp(tempPath, destinationPath, args.kind, sha256);
    return { ...published, bytes: total, sha256, contentType };
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
