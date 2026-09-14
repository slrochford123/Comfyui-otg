import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { OTG_DATA_ROOT, ensureDir } from "@/lib/paths";
import type { H3StudioLoraSelection } from "@/lib/h3Studio";
import {
  H3_BACKEND_PROFILES,
  type ProductionV2H3BackendId,
  type ProductionV2H3Mode,
} from "@/lib/production/h3Workflows";

export const H3_OPTIONAL_LORA_DEFAULT_MAX = 3;
export const H3_LORA_FOLDER = "MiniMax-H3";
const H3_LORA_PREFIX = `${H3_LORA_FOLDER}/`;
const BACKENDS = Object.keys(H3_BACKEND_PROFILES) as ProductionV2H3BackendId[];
const MODEL_EXTENSIONS = /\.(safetensors|pt|pth|bin)$/i;
const execFile = promisify(execFileCallback);

export type H3LoraCatalogEntry = {
  id: string;
  displayName: string;
  filename: string;
  description: string;
  enabled: boolean;
  approvedForH3: boolean;
  approvedForT2V: boolean;
  approvedForI2V: boolean;
  approvedForR2V: boolean;
  defaultStrength: number;
  minStrength: number;
  maxStrength: number;
  recommendedMin: number;
  recommendedMax: number;
  triggerWords: string[];
  triggerRequired: boolean;
  previewImage: string;
  notes: string;
  discoveredOn: ProductionV2H3BackendId[];
  missingOn: ProductionV2H3BackendId[];
  compatibilityStatus: "approved" | "review" | "incompatible";
};

type H3LoraCatalogFile = {
  version: 1;
  updatedAt: string;
  maxSelections: number;
  entries: H3LoraCatalogEntry[];
};

export type ResolvedH3OptionalLora = {
  id: string;
  label: string;
  filename: string;
  strength: number;
  triggerWords: string[];
  triggerRequired: boolean;
};

export type H3LoraBackendScan = {
  backend: ProductionV2H3BackendId;
  ok: boolean;
  files: Set<string>;
  error: string;
};

function catalogFile() {
  return (
    process.env.OTG_H3_LORA_CATALOG_FILE ||
    path.join(OTG_DATA_ROOT, "h3_lora_catalog.json")
  );
}

export function h3LoraBackendRoot(backend: ProductionV2H3BackendId) {
  if (backend === "rtx3090")
    return (
      process.env.OTG_H3_LORA_ROOT_RTX3090 ||
      "/home/shawn-rochford/AI/ComfyUI/models/loras/MiniMax-H3"
    );
  return (
    process.env.OTG_H3_LORA_ROOT_RTX5060TI ||
    "/opt/ComfyUI/models/loras/MiniMax-H3"
  );
}

export function h3LoraBackendRoots() {
  return BACKENDS.map((id) => ({
    id,
    label: H3_BACKEND_PROFILES[id].label,
    root: h3LoraBackendRoot(id),
  }));
}

function bounded(value: unknown, fallback: number, min = 0, max = 2) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
}

function normalizeEntry(
  value: Partial<H3LoraCatalogEntry>,
): H3LoraCatalogEntry | null {
  const id = String(value.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = String(value.filename || "")
    .trim()
    .replaceAll("\\", "/");
  if (!id || !MODEL_EXTENSIONS.test(filename)) return null;
  const minStrength = bounded(value.minStrength, 0);
  const maxStrength = bounded(value.maxStrength, 1.2, minStrength);
  const defaultStrength = bounded(
    value.defaultStrength,
    1,
    minStrength,
    maxStrength,
  );
  return {
    id,
    displayName: String(
      value.displayName || path.basename(filename).replace(/\.[^.]+$/, ""),
    ).trim(),
    filename,
    description: String(value.description || "").trim(),
    enabled: value.enabled === true,
    approvedForH3: value.approvedForH3 === true,
    approvedForT2V: value.approvedForT2V === true,
    approvedForI2V: value.approvedForI2V === true,
    approvedForR2V: value.approvedForR2V === true,
    defaultStrength,
    minStrength,
    maxStrength,
    recommendedMin: bounded(
      value.recommendedMin,
      defaultStrength,
      minStrength,
      maxStrength,
    ),
    recommendedMax: bounded(
      value.recommendedMax,
      defaultStrength,
      minStrength,
      maxStrength,
    ),
    triggerWords: Array.isArray(value.triggerWords)
      ? value.triggerWords
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    triggerRequired: value.triggerRequired === true,
    previewImage: String(value.previewImage || "").trim(),
    notes: String(value.notes || "").trim(),
    discoveredOn: Array.isArray(value.discoveredOn)
      ? value.discoveredOn.filter((item): item is ProductionV2H3BackendId =>
          BACKENDS.includes(item as ProductionV2H3BackendId),
        )
      : [],
    missingOn: Array.isArray(value.missingOn)
      ? value.missingOn.filter((item): item is ProductionV2H3BackendId =>
          BACKENDS.includes(item as ProductionV2H3BackendId),
        )
      : [],
    compatibilityStatus:
      value.compatibilityStatus === "approved" ||
      value.compatibilityStatus === "incompatible"
        ? value.compatibilityStatus
        : "review",
  };
}

export function readH3LoraCatalog(): H3LoraCatalogFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    const entries = Array.isArray(parsed?.entries)
      ? (parsed.entries
          .map(normalizeEntry)
          .filter(Boolean) as H3LoraCatalogEntry[])
      : [];
    return {
      version: 1,
      updatedAt: String(parsed?.updatedAt || ""),
      maxSelections: Math.max(
        1,
        Math.min(
          8,
          Number(parsed?.maxSelections) || H3_OPTIONAL_LORA_DEFAULT_MAX,
        ),
      ),
      entries,
    };
  } catch {
    return {
      version: 1,
      updatedAt: "",
      maxSelections: H3_OPTIONAL_LORA_DEFAULT_MAX,
      entries: [],
    };
  }
}

export function writeH3LoraCatalog(
  entries: H3LoraCatalogEntry[],
  maxSelections: number,
) {
  const unique = new Map<string, H3LoraCatalogEntry>();
  entries
    .map(normalizeEntry)
    .filter(Boolean)
    .forEach((entry) => unique.set(entry!.id, entry!));
  const result: H3LoraCatalogFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    maxSelections: Math.max(
      1,
      Math.min(
        8,
        Math.round(Number(maxSelections) || H3_OPTIONAL_LORA_DEFAULT_MAX),
      ),
    ),
    entries: [...unique.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    ),
  };
  const target = catalogFile();
  ensureDir(path.dirname(target));
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(result, null, 2), "utf8");
  fs.renameSync(temporary, target);
  return result;
}

function allowedForMode(entry: H3LoraCatalogEntry, mode: ProductionV2H3Mode) {
  return mode === "h3-text-to-video"
    ? entry.approvedForT2V
    : mode === "h3-image-to-video"
      ? entry.approvedForI2V
      : entry.approvedForR2V;
}

export function publicH3LoraCatalog(mode?: ProductionV2H3Mode) {
  const catalog = readH3LoraCatalog();
  return {
    ...catalog,
    entries: catalog.entries.filter(
      (entry) =>
        entry.enabled &&
        entry.approvedForH3 &&
        entry.compatibilityStatus === "approved" &&
        (!mode || allowedForMode(entry, mode)) &&
        entry.discoveredOn.length > 0,
    ),
  };
}

export function validateH3LoraSelections(
  value: unknown,
  mode: ProductionV2H3Mode,
) {
  const catalog = readH3LoraCatalog();
  const requested = Array.isArray(value)
    ? (value as H3StudioLoraSelection[])
    : [];
  if (requested.length > catalog.maxSelections)
    throw new Error(
      `H3 supports at most ${catalog.maxSelections} optional LoRAs.`,
    );
  const seen = new Set<string>();
  const resolved = requested.map((selection): ResolvedH3OptionalLora => {
    const id = String(selection?.id || "").trim();
    if (!id || seen.has(id))
      throw new Error(
        `Invalid or duplicate H3 LoRA selection: ${id || "missing id"}.`,
      );
    seen.add(id);
    const entry = catalog.entries.find((item) => item.id === id);
    if (!entry) throw new Error(`H3 LoRA ${id} is not in the admin catalog.`);
    if (
      !entry.enabled ||
      !entry.approvedForH3 ||
      entry.compatibilityStatus !== "approved"
    )
      throw new Error(
        `H3 LoRA ${entry.displayName} is not approved and enabled.`,
      );
    if (!allowedForMode(entry, mode))
      throw new Error(
        `H3 LoRA ${entry.displayName} is not approved for this generation mode.`,
      );
    if (!entry.discoveredOn.length)
      throw new Error(
        `H3 LoRA ${entry.displayName} is not installed on an H3 backend.`,
      );
    const strength = Number(selection.strength);
    if (
      !Number.isFinite(strength) ||
      strength < entry.minStrength ||
      strength > entry.maxStrength
    )
      throw new Error(
        `H3 LoRA ${entry.displayName} strength must be between ${entry.minStrength} and ${entry.maxStrength}.`,
      );
    return {
      id,
      label: entry.displayName,
      filename: entry.filename,
      strength,
      triggerWords: entry.triggerWords,
      triggerRequired: entry.triggerRequired,
    };
  });
  return { maxSelections: catalog.maxSelections, resolved };
}

export function canonicalH3OptionalLoraFilename(value: unknown) {
  const filename = String(value || "")
    .trim()
    .replaceAll("\\", "/");
  if (!filename.toLowerCase().startsWith(H3_LORA_PREFIX.toLowerCase()))
    return null;
  const relative = filename.slice(H3_LORA_PREFIX.length);
  const parts = relative.split("/");
  if (!relative || parts.some((part) => !part || part === "." || part === ".."))
    return null;
  if (
    parts[0].toLowerCase() === "acceleration" ||
    parts.some((part) => part.startsWith("."))
  )
    return null;
  if (!MODEL_EXTENSIONS.test(relative)) return null;
  return `${H3_LORA_PREFIX}${relative}`;
}

function collectH3FolderFiles(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    const filename = canonicalH3OptionalLoraFilename(value);
    if (filename) output.add(filename);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectH3FolderFiles(item, output));
  } else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectH3FolderFiles(item, output),
    );
  }
}

export function extractH3OptionalLoraFilenames(objectInfo: unknown) {
  const files = new Set<string>();
  collectH3FolderFiles(objectInfo, files);
  return files;
}

function stablePolicyId(filename: string) {
  const stem =
    path
      .basename(filename)
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "lora";
  return `${stem}-${crypto.createHash("sha256").update(filename.toLowerCase()).digest("hex").slice(0, 10)}`;
}

function displayNameFromFilename(filename: string) {
  return path
    .basename(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function newDiscoveredEntry(filename: string): H3LoraCatalogEntry {
  return {
    id: stablePolicyId(filename),
    displayName: displayNameFromFilename(filename),
    filename,
    description:
      "Discovered MiniMax H3 optional LoRA. Review compatibility before enabling.",
    enabled: false,
    approvedForH3: false,
    approvedForT2V: false,
    approvedForI2V: false,
    approvedForR2V: false,
    defaultStrength: 1,
    minStrength: 0,
    maxStrength: 1.2,
    recommendedMin: 0.5,
    recommendedMax: 1,
    triggerWords: [],
    triggerRequired: false,
    previewImage: "",
    notes: "Automatically discovered from a MiniMax-H3 LoRA folder.",
    discoveredOn: [],
    missingOn: [],
    compatibilityStatus: "review",
  };
}

export function mergeH3LoraCatalogScans(
  catalog: H3LoraCatalogFile,
  scans: H3LoraBackendScan[],
) {
  const successful = new Map(
    scans.filter((scan) => scan.ok).map((scan) => [scan.backend, scan.files]),
  );
  const discovered = new Set(
    scans.flatMap((scan) => (scan.ok ? [...scan.files] : [])),
  );
  const remaining = [...catalog.entries];
  const entries: H3LoraCatalogEntry[] = [];

  for (const filename of [...discovered].sort()) {
    const exactIndex = remaining.findIndex(
      (entry) => entry.filename.toLowerCase() === filename.toLowerCase(),
    );
    const basenameMatches = remaining
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          path.basename(entry.filename).toLowerCase() ===
          path.basename(filename).toLowerCase(),
      );
    const matchIndex =
      exactIndex >= 0
        ? exactIndex
        : basenameMatches.length === 1
          ? basenameMatches[0].index
          : -1;
    const existing =
      matchIndex >= 0
        ? remaining.splice(matchIndex, 1)[0]
        : newDiscoveredEntry(filename);
    entries.push({
      ...existing,
      filename,
      discoveredOn: BACKENDS.filter((backend) =>
        successful.has(backend)
          ? successful.get(backend)!.has(filename)
          : existing.discoveredOn.includes(backend),
      ),
      missingOn: BACKENDS.filter((backend) =>
        successful.has(backend)
          ? !successful.get(backend)!.has(filename)
          : existing.missingOn.includes(backend),
      ),
    });
  }

  for (const existing of remaining) {
    entries.push({
      ...existing,
      discoveredOn: BACKENDS.filter((backend) =>
        successful.has(backend)
          ? successful.get(backend)!.has(existing.filename)
          : existing.discoveredOn.includes(backend),
      ),
      missingOn: BACKENDS.filter((backend) =>
        successful.has(backend)
          ? !successful.get(backend)!.has(existing.filename)
          : existing.missingOn.includes(backend),
      ),
    });
  }
  return entries;
}

async function inventory(backend: ProductionV2H3BackendId) {
  const response = await fetch(
    `${H3_BACKEND_PROFILES[backend].baseUrl}/object_info/LoraLoaderModelOnly`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return extractH3OptionalLoraFilenames(await response.json());
}

export async function synchronizeH3LoraCatalog() {
  const scans: H3LoraBackendScan[] = await Promise.all(
    BACKENDS.map(async (backend) => {
      try {
        return {
          backend,
          ok: true,
          files: await inventory(backend),
          error: "",
        };
      } catch (error) {
        return {
          backend,
          ok: false,
          files: new Set<string>(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  if (!scans.some((scan) => scan.ok))
    throw new Error("No H3 ComfyUI backend returned a LoRA inventory.");
  const catalog = readH3LoraCatalog();
  const result = writeH3LoraCatalog(
    mergeH3LoraCatalogScans(catalog, scans),
    catalog.maxSelections,
  );
  return {
    ...result,
    backends: scans.map((scan) => ({
      id: scan.backend,
      label: H3_BACKEND_PROFILES[scan.backend].label,
      root: h3LoraBackendRoot(scan.backend),
      ok: scan.ok,
      count: scan.files.size,
      error: scan.error,
    })),
  };
}

export function resolveH3LoraDeleteTarget(
  backend: ProductionV2H3BackendId,
  filename: string,
) {
  const canonical = canonicalH3OptionalLoraFilename(filename);
  if (!canonical)
    throw new Error(
      "Only optional model files inside the MiniMax-H3 LoRA folder may be deleted.",
    );
  const root = path.resolve(h3LoraBackendRoot(backend));
  const relative = canonical.slice(H3_LORA_PREFIX.length);
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(`${root}${path.sep}`))
    throw new Error("Refused H3 LoRA path outside the approved root.");
  return { root, relative, target, canonical };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function deleteLocalH3Lora(
  target: ReturnType<typeof resolveH3LoraDeleteTarget>,
) {
  const rootReal = fs.realpathSync(target.root);
  const targetReal = fs.realpathSync(target.target);
  if (!targetReal.startsWith(`${rootReal}${path.sep}`))
    throw new Error("Refused H3 LoRA symlink outside the approved root.");
  const stat = fs.lstatSync(target.target);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("The selected H3 LoRA is not a regular model file.");
  fs.unlinkSync(target.target);
}

async function deleteRemoteH3Lora(
  target: ReturnType<typeof resolveH3LoraDeleteTarget>,
) {
  const script =
    "import base64,pathlib,sys; root=pathlib.Path(base64.b64decode(sys.argv[1]).decode()).resolve(strict=True); rel=base64.b64decode(sys.argv[2]).decode(); candidate=root/rel; assert not candidate.is_symlink(), 'symlink refused'; target=candidate.resolve(strict=True); assert target!=root and root in target.parents, 'outside approved root'; assert target.is_file(), 'not a regular model file'; target.unlink()";
  const root = Buffer.from(target.root).toString("base64");
  const relative = Buffer.from(target.relative).toString("base64");
  const command = `/usr/bin/python3 -c ${shellQuote(script)} ${root} ${relative}`;
  await execFile(
    "/usr/bin/ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      process.env.OTG_H3_RTX5060TI_SSH_HOST || "otg-slr",
      command,
    ],
    { timeout: 30_000 },
  );
}

export async function deleteH3LoraFiles(
  id: string,
  requestedBackends: unknown,
) {
  const catalog = readH3LoraCatalog();
  const entry = catalog.entries.find((item) => item.id === id);
  if (!entry) throw new Error("The selected H3 LoRA policy no longer exists.");
  const backends = Array.isArray(requestedBackends)
    ? [
        ...new Set(
          requestedBackends.filter((item): item is ProductionV2H3BackendId =>
            BACKENDS.includes(item as ProductionV2H3BackendId),
          ),
        ),
      ]
    : [];
  if (!backends.length)
    throw new Error("Choose at least one installed backend for deletion.");
  let currentEntry = entry;
  let currentEntries = catalog.entries;
  for (const backend of backends) {
    if (!entry.discoveredOn.includes(backend))
      throw new Error(
        `${entry.displayName} is not recorded as installed on ${H3_BACKEND_PROFILES[backend].label}.`,
      );
    const target = resolveH3LoraDeleteTarget(backend, entry.filename);
    if (backend === "rtx3090") await deleteLocalH3Lora(target);
    else await deleteRemoteH3Lora(target);
    currentEntry = {
      ...currentEntry,
      enabled: false,
      approvedForH3: false,
      compatibilityStatus: "review",
      discoveredOn: currentEntry.discoveredOn.filter(
        (installed) => installed !== backend,
      ),
      missingOn: [...new Set([...currentEntry.missingOn, backend])],
    };
    currentEntries = currentEntries.map((item) =>
      item.id === id ? currentEntry : item,
    );
    writeH3LoraCatalog(currentEntries, catalog.maxSelections);
  }
  return {
    ...readH3LoraCatalog(),
    deleted: { id, filename: entry.filename, backends },
  };
}
