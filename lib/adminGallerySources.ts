import fs from "node:fs/promises";
import path from "node:path";

export type AdminGallerySourceId = "comfy-3090" | "comfy-5060";
export type AdminGalleryMediaKind = "image" | "video";

export type AdminGallerySourceDefinition = {
  id: AdminGallerySourceId;
  label: string;
  description: string;
  kind: "local" | "remote-agent";
};

export type AdminGalleryItem = {
  id: string;
  source: AdminGallerySourceId;
  sourceLabel: string;
  name: string;
  rel: string;
  kind: AdminGalleryMediaKind;
  mimeType: string;
  bytes: number;
  mtimeMs: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  url: string;
};

export type AdminGallerySourceStatus = {
  id: AdminGallerySourceId;
  label: string;
  ok: boolean;
  count: number;
  error?: string;
};

export type AdminGalleryPage = {
  ok: boolean;
  items: AdminGalleryItem[];
  sources: AdminGallerySourceDefinition[];
  statuses: AdminGallerySourceStatus[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

const LOCAL_3090_OUTPUT_ROOT = "/home/shawn-rochford/AI/ComfyUI/ComfyUI/output";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

export const ADMIN_GALLERY_SOURCES: AdminGallerySourceDefinition[] = [
  {
    id: "comfy-3090",
    label: "RTX 3090 ComfyUI",
    description: "Filesystem output from the TEST RTX 3090 ComfyUI service on shawn.",
    kind: "local",
  },
  {
    id: "comfy-5060",
    label: "RTX 5060 Ti ComfyUI",
    description: "Filesystem output from the TEST RTX 5060 Ti ComfyUI service on slr.",
    kind: "remote-agent",
  },
];

export function isAdminGallerySourceId(value: string): value is AdminGallerySourceId {
  return ADMIN_GALLERY_SOURCES.some((source) => source.id === value);
}

export function adminGallerySourceById(value: string): AdminGallerySourceDefinition {
  const source = ADMIN_GALLERY_SOURCES.find((candidate) => candidate.id === value);
  if (!source) throw new Error("Unknown admin gallery source.");
  return source;
}

export function contentTypeForAdminGalleryPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  return "application/octet-stream";
}

export function mediaKindForName(name: string): AdminGalleryMediaKind | null {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

export function normalizeAdminGalleryRelPath(value: string) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
  const normalized = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (!normalized || normalized.includes("\0")) return "";
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  if (/^[a-zA-Z]:/.test(normalized) || path.isAbsolute(normalized)) return "";
  return parts.join("/");
}

export async function listAdminGallery(args: {
  source?: AdminGallerySourceId | "all";
  offset?: number;
  limit?: number;
}): Promise<AdminGalleryPage> {
  const offset = clampOffset(args.offset);
  const limit = clampLimit(args.limit);
  const selected = args.source && args.source !== "all"
    ? [adminGallerySourceById(args.source)]
    : ADMIN_GALLERY_SOURCES;
  const fetchLimit = Math.min(offset + limit + 1, 1000);
  const results = await Promise.all(selected.map((source) => listOneSource(source, fetchLimit)));
  const items = results
    .flatMap((result) => result.items)
    .sort(compareAdminGalleryItems);
  const pageItems = items.slice(offset, offset + limit);
  return {
    ok: results.some((result) => result.ok),
    items: pageItems,
    sources: ADMIN_GALLERY_SOURCES,
    statuses: results.map(({ source, ok, error, count }) => ({
      id: source.id,
      label: source.label,
      ok,
      count,
      ...(error ? { error } : {}),
    })),
    offset,
    limit,
    hasMore: items.length > offset + limit || results.some((result) => result.hasMore),
  };
}

export async function resolveLocalAdminGalleryFile(sourceId: AdminGallerySourceId, relValue: string) {
  const source = adminGallerySourceById(sourceId);
  if (source.kind !== "local") throw new Error("Source is not local.");
  const rel = normalizeAdminGalleryRelPath(relValue);
  if (!rel || !MEDIA_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
    throw new Error("Invalid or unsupported gallery file path.");
  }
  const root = await local3090Root();
  const candidate = path.resolve(root, rel);
  assertWithinRoot(root, candidate);
  const realCandidate = await fs.realpath(candidate);
  assertWithinRoot(root, realCandidate);
  const stat = await fs.stat(realCandidate);
  if (!stat.isFile()) throw new Error("Gallery path is not a file.");
  return { path: realCandidate, rel, stat, source };
}

export async function deleteAdminGalleryFile(sourceId: AdminGallerySourceId, relValue: string) {
  const source = adminGallerySourceById(sourceId);
  if (source.kind === "remote-agent") {
    const rel = requireRel(relValue);
    const url = remoteAgentUrl("/gallery/file", { rel });
    const response = await fetch(url, {
      method: "DELETE",
      cache: "no-store",
      headers: remoteAgentHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(await remoteError(response, "Remote delete failed"));
    return;
  }
  const resolved = await resolveLocalAdminGalleryFile(sourceId, relValue);
  await fs.unlink(resolved.path);
}

export async function fetchRemoteAdminGalleryFile(relValue: string, init?: { method?: "GET" | "HEAD"; range?: string | null }) {
  const rel = requireRel(relValue);
  const headers = remoteAgentHeaders();
  if (init?.range) headers.Range = init.range;
  const response = await fetch(remoteAgentUrl("/gallery/file", { rel }), {
    method: init?.method || "GET",
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(await remoteError(response, "Remote gallery file failed"));
  }
  return response;
}

export function compareAdminGalleryItems(a: AdminGalleryItem, b: AdminGalleryItem) {
  return b.mtimeMs - a.mtimeMs || a.source.localeCompare(b.source) || a.rel.localeCompare(b.rel);
}

async function listOneSource(source: AdminGallerySourceDefinition, limit: number) {
  try {
    const result = source.kind === "local"
      ? await listLocalSource(source, limit)
      : await listRemoteSource(source, limit);
    return { source, ok: true, error: "", ...result };
  } catch (error) {
    return {
      source,
      ok: false,
      error: error instanceof Error ? error.message : "Source unavailable.",
      count: 0,
      items: [] as AdminGalleryItem[],
      hasMore: false,
    };
  }
}

async function listLocalSource(source: AdminGallerySourceDefinition, limit: number) {
  const root = await local3090Root();
  const items: AdminGalleryItem[] = [];
  await walkLocal(root, root, source, items);
  items.sort(compareAdminGalleryItems);
  return { count: items.length, items: items.slice(0, limit), hasMore: items.length > limit };
}

async function walkLocal(root: string, current: string, source: AdminGallerySourceDefinition, items: AdminGalleryItem[]): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const candidate = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkLocal(root, candidate, source, items);
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = mediaKindForName(entry.name);
    if (!kind) continue;
    const stat = await fs.stat(candidate);
    const rel = path.relative(root, candidate).split(path.sep).join("/");
    items.push(toItem(source, { rel, name: entry.name, kind, bytes: stat.size, mtimeMs: stat.mtimeMs }));
  }
}

async function listRemoteSource(source: AdminGallerySourceDefinition, limit: number) {
  const response = await fetch(remoteAgentUrl("/gallery/list", { limit: String(limit) }), {
    cache: "no-store",
    headers: remoteAgentHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(await remoteError(response, "Remote gallery list failed"));
  const payload = await response.json() as {
    ok?: boolean;
    count?: number;
    hasMore?: boolean;
    items?: Array<{ rel?: string; name?: string; kind?: string; mimeType?: string; bytes?: number; mtimeMs?: number; width?: number; height?: number; durationSeconds?: number }>;
  };
  if (!payload.ok) throw new Error("Remote gallery source returned ok=false.");
  const items: AdminGalleryItem[] = [];
  for (const raw of payload.items || []) {
    const rel = normalizeAdminGalleryRelPath(String(raw.rel || ""));
    const kind = mediaKindForName(rel);
    if (!rel || !kind || raw.kind !== kind) continue;
    items.push(toItem(source, {
      rel,
      name: path.posix.basename(rel),
      kind,
      mimeType: contentTypeForAdminGalleryPath(rel),
      bytes: finiteNonNegative(raw.bytes),
      mtimeMs: finiteNonNegative(raw.mtimeMs),
      width: finitePositive(raw.width),
      height: finitePositive(raw.height),
      durationSeconds: finitePositive(raw.durationSeconds),
    }));
  }
  items.sort(compareAdminGalleryItems);
  return { count: finiteNonNegative(payload.count) || items.length, items, hasMore: Boolean(payload.hasMore) };
}

function toItem(source: AdminGallerySourceDefinition, value: Omit<AdminGalleryItem, "id" | "source" | "sourceLabel" | "mimeType" | "url"> & { mimeType?: string }) {
  const params = new URLSearchParams({ source: source.id, rel: value.rel });
  return {
    ...value,
    id: `${source.id}:${value.rel}`,
    source: source.id,
    sourceLabel: source.label,
    mimeType: value.mimeType || contentTypeForAdminGalleryPath(value.rel),
    url: `/api/admin/gallery-file?${params.toString()}`,
  };
}

async function local3090Root() {
  const configured = String(process.env.OTG_ADMIN_GALLERY_3090_ROOT || LOCAL_3090_OUTPUT_ROOT).trim();
  const real = await fs.realpath(path.resolve(configured));
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error("RTX 3090 ComfyUI output root is not a directory.");
  return real;
}

function remoteAgentUrl(route: string, params?: Record<string, string>) {
  const base = String(process.env.OTG_ADMIN_GALLERY_5060_URL || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("RTX 5060 Ti gallery agent URL is not configured.");
  const url = new URL(`${base}${route}`);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
  return url.toString();
}

function remoteAgentHeaders() {
  const token = String(process.env.OTG_ADMIN_GALLERY_5060_TOKEN || "").trim();
  if (!token) throw new Error("RTX 5060 Ti gallery agent token is not configured.");
  return { Authorization: `Bearer ${token}` } as Record<string, string>;
}

function requireRel(value: string) {
  const rel = normalizeAdminGalleryRelPath(value);
  if (!rel || !MEDIA_EXTENSIONS.has(path.extname(rel).toLowerCase())) throw new Error("Invalid or unsupported gallery file path.");
  return rel;
}

function assertWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Gallery path escapes its configured root.");
}

async function remoteError(response: Response, prefix: string) {
  const text = await response.text().catch(() => "");
  return `${prefix}: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`;
}

function clampOffset(value: number | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function clampLimit(value: number | undefined) {
  const number = Number(value || 48);
  return Number.isFinite(number) ? Math.min(100, Math.max(1, Math.floor(number))) : 48;
}

function finiteNonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
