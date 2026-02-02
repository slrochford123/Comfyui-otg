import fs from "fs";
import path from "path";
import crypto from "crypto";

export type WorkflowMeta = {
  id: string;
  label?: string;
  description?: string;
  file: string; // relative to comfy_workflows root
  img2img?: boolean;
  tags?: string[];
  thumbnail?: string; // relative path within comfy_workflows, e.g. "thumbnails/foo.png"
  requirements?: {
    models?: { type?: string; name?: string; pathHint?: string }[];
    nodes?: string[]; // required custom node packs (human hints)
    notes?: string;
  };
};

export type WorkflowsIndex = {
  version: number;
  workflows: WorkflowMeta[];
};

export type WorkflowListItem = WorkflowMeta & {
  canRun: boolean;
  needsImages: number;

  exists: boolean;
  parseOk: boolean;
  format: "prompt_graph" | "ui_workflow" | "unknown";
  sha256?: string;
  filePath?: string;
  error?: string;
  // convenience URLs
  apiUrl: string;
  thumbnailUrl?: string;
};

export function getWorkflowsRoot() {
  const env =
    process.env.COMFY_WORKFLOWS_DIR ||
    process.env.OTG_WORKFLOWS_ROOT ||
    process.env.OTG_WORKFLOWS_DIR;

  const fallback = path.resolve(process.cwd(), "comfy_workflows");
  return env ? path.resolve(env) : fallback;
}

export function getWorkflowsIndexPath() {
  return path.join(getWorkflowsRoot(), "index.json");
}

export function safeJsonParse(raw: string) {
  try {
    return { ok: true as const, value: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
}

export function isObject(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Detect ComfyUI UI workflow format (layout) vs API prompt graph
export function detectWorkflowFormat(json: any): "prompt_graph" | "ui_workflow" | "unknown" {
  if (!json) return "unknown";
  // UI workflow often has nodes/links + last_node_id
  if (isObject(json) && (Array.isArray((json as any).nodes) || Array.isArray((json as any).links))) {
    return "ui_workflow";
  }
  // Some exports wrap prompt graph: { prompt: {...} }
  if (isObject(json) && isObject((json as any).prompt)) return "prompt_graph";
  // Prompt graph is (usually) an object whose keys are node ids (numbers as strings)
  // BUT we also allow harmless metadata keys like "__otg" at the top-level.
  if (isObject(json)) {
    const keys = Object.keys(json);
    const numericKeys = keys.filter((k) => /^[0-9]+$/.test(k));
    if (numericKeys.length) {
      const sample = (json as any)[numericKeys[0]];
      if (isObject(sample) && typeof sample.class_type === "string" && isObject(sample.inputs)) return "prompt_graph";
    }
  }
  return "unknown";
}

// Remove OTG-only or other metadata keys that should not be sent to ComfyUI
export function stripPromptMeta(graph: any) {
  if (!isObject(graph)) return graph;
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(graph)) {
    // Top-level metadata keys we never want to send to ComfyUI
    if (k === "__otg") continue;
    // OTG-internal nodes/keys (commonly "_otg_meta") should never be sent upstream.
    if (k.startsWith("_otg_")) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

// Best-effort conversion:
// - If json has { prompt: {...} } return that
// - Else if it *looks* like prompt graph already, return it
// - Else cannot reliably convert UI layout to prompt graph without ComfyUI-side export.
//   Return null to force a helpful error.
export function extractPromptGraph(json: any): { ok: true; graph: any } | { ok: false; error: string; format: string; gotKeys?: string[] } {
  const fmt = detectWorkflowFormat(json);

  if (fmt === "prompt_graph") {
    if (isObject(json) && isObject((json as any).prompt)) return { ok: true, graph: (json as any).prompt };
    return { ok: true, graph: stripPromptMeta(json) };
  }

  if (fmt === "ui_workflow") {
    // Some tools embed prompt graph under "prompt" or "api" or "workflow" fields—try a few common ones.
    const candidates = ["prompt", "api", "prompt_graph", "graph", "workflow_api", "workflowApi"];
    for (const k of candidates) {
      const v = (json as any)?.[k];
      if (isObject(v)) {
        const innerFmt = detectWorkflowFormat(v);
        if (innerFmt === "prompt_graph") {
          if (isObject(v) && isObject((v as any).prompt)) return { ok: true, graph: (v as any).prompt };
          return { ok: true, graph: v };
        }
      }
    }
    return {
      ok: false,
      error:
        "Workflow is ComfyUI UI format (nodes/links). Auto-conversion is not reliably possible. Export the workflow in API/prompt format from ComfyUI.",
      format: "ui_workflow",
      gotKeys: isObject(json) ? Object.keys(json) : undefined,
    };
  }

  return { ok: false, error: "Unknown workflow JSON format.", format: fmt, gotKeys: isObject(json) ? Object.keys(json) : undefined };
}

export function validatePromptGraph(graph: any): { ok: true } | { ok: false; error: string } {
  if (!isObject(graph)) return { ok: false, error: "Prompt graph must be an object." };

  const keys = Object.keys(graph);
  if (!keys.length) return { ok: false, error: "Prompt graph is empty." };

  for (const k of keys) {
    // OTG stores a small amount of internal metadata in the graph object.
    // Those keys are NOT ComfyUI nodes and must be ignored by validation.
    if (k === "__otg" || k.startsWith("_otg_")) continue;
    const node = (graph as any)[k];
    if (!isObject(node)) return { ok: false, error: `Node ${k} is not an object.` };
    if (typeof node.class_type !== "string") return { ok: false, error: `Node ${k} missing class_type.` };
    if (!isObject(node.inputs)) return { ok: false, error: `Node ${k} missing inputs.` };
  }
  return { ok: true };
}

export function sha256OfString(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function resolveWorkflowFile(meta: WorkflowMeta): { ok: true; filePath: string } | { ok: false; error: string } {
  const root = getWorkflowsRoot();
  if (!meta?.file || typeof meta.file !== "string") return { ok: false, error: "Workflow meta missing file." };
  const filePath = path.join(root, meta.file);
  return { ok: true, filePath };
}

type CacheState = {
  indexMtimeMs?: number;
  index?: WorkflowsIndex;
  list?: WorkflowListItem[];
};

function scanWorkflowFiles(root: string): WorkflowMeta[] {
  // Scan for *.json under root (commonly root/presets). This is a fallback/augmenter to index.json
  // so users can drop workflow files without needing to edit index.json.
  const out: WorkflowMeta[] = [];
  const seen = new Set<string>();

  function walk(dir: string) {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip huge/irrelevant dirs
        if (ent.name === "thumbnails" || ent.name === "node_modules") continue;
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith(".json")) continue;

      const rel = path.relative(root, abs).split(path.sep).join("/");
      const id = rel.replace(/\.json$/i, "");
      if (seen.has(id)) continue;
      seen.add(id);

      const base = path.basename(id);
      const label = base.replace(/[_-]+/g, " ").trim() || id;

      out.push({
        id,
        label,
        description: "",
        file: rel,
      });
    }
  }

  walk(root);

  // Prefer listing presets first if present (stable UX)
  out.sort((a, b) => {
    const ap = a.file.startsWith("presets/") ? 0 : 1;
    const bp = b.file.startsWith("presets/") ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.label!.localeCompare(b.label!);
  });

  return out;
}

const cache: CacheState = {};

// Read index.json fresh if changed
export function buildIndexFromDirectory(root: string): WorkflowsIndex {
  if (!fs.existsSync(root)) return { version: 1, workflows: [] };

  const workflows: WorkflowMeta[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;

      const lower = ent.name.toLowerCase();
      if (!lower.endsWith(".json")) continue;
      if (lower === "index.json") continue;

      const rel = path.relative(root, full); // may include subfolders
      const file = rel.split(path.sep).join("/"); // normalize for urls & joins
      const id = file.replace(/\.json$/i, "");

      let label: string | undefined;
      let description: string | undefined;
      let img2img: boolean | undefined;

      try {
        const raw = fs.readFileSync(full, "utf8");
        const parsed = safeJsonParse(raw);
        if (parsed.ok) {
          const j: any = parsed.value;
          const meta = j?.__otg ?? j?.meta ?? j?.metadata ?? null;
          if (meta) {
            if (typeof meta.label === "string") label = meta.label;
            if (typeof meta.description === "string") description = meta.description;
            if (typeof meta.img2img === "boolean") img2img = meta.img2img;
          }
        }
      } catch {
        // ignore
      }

      workflows.push({ id, file, label, description, img2img });
    }
  }

  walk(root);

  workflows.sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id));
  return { version: 1, workflows };
}

function readIndexFresh(): { ok: true; index: WorkflowsIndex } | { ok: false; error: string } {
  const root = getWorkflowsRoot();
const indexPath = getWorkflowsIndexPath();

// If no index.json, auto-build from directory so workflows still show up
if (!fs.existsSync(indexPath)) {
  const index = buildIndexFromDirectory(root);
  cache.indexMtimeMs = undefined;
  cache.index = index;
  cache.list = undefined;
  return { ok: true, index };
}

  const st = fs.statSync(indexPath);
  const mtime = st.mtimeMs;

  if (cache.index && cache.indexMtimeMs === mtime) return { ok: true, index: cache.index };

  const raw = fs.readFileSync(indexPath, "utf8");
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return { ok: false, error: `index.json parse error: ${parsed.error}` };

  const idx = parsed.value as any;
  const workflows = Array.isArray(idx?.workflows) ? idx.workflows : [];
  const index: WorkflowsIndex = { version: Number(idx?.version ?? 1) || 1, workflows };

  cache.indexMtimeMs = mtime;
  cache.index = index;
  cache.list = undefined; // invalidate list cache
  return { ok: true, index };
}

export function clearWorkflowCache() {
  cache.indexMtimeMs = undefined;
  cache.index = undefined;
  cache.list = undefined;
}

// Build list with validation info; re-run when index changes (hot reload)
export function getWorkflowList(): { ok: true; list: WorkflowListItem[] } | { ok: false; error: string } {
  const idx = readIndexFresh();
  if (!idx.ok) return { ok: false, error: idx.error };

  if (cache.list) return { ok: true, list: cache.list };

  const root = getWorkflowsRoot();
  
// Build meta list from index.json plus a directory scan (so workflows appear even if index.json is stale)
const indexMetas: WorkflowMeta[] = (idx.index.workflows || []).map((w: any) => ({
  id: String(w.id ?? ""),
  label: typeof w.label === "string" ? w.label : undefined,
  description: typeof w.description === "string" ? w.description : undefined,
  file: String(w.file ?? ""),
  img2img: !!w.img2img,
  tags: Array.isArray(w.tags) ? w.tags.map(String) : undefined,
  thumbnail: typeof w.thumbnail === "string" ? w.thumbnail : undefined,
  requirements: isObject(w.requirements) ? w.requirements : undefined,
}));

const scannedMetas = scanWorkflowFiles(root);
const byId = new Map<string, WorkflowMeta>();

// scanned first, then index overrides metadata (label/desc/thumb/etc)
for (const m of scannedMetas) {
  if (m.id) byId.set(m.id, m);
}
for (const m of indexMetas) {
  if (m.id) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? { ...prev, ...m } : m);
  }
}

const metas = Array.from(byId.values()).filter((m) => m.id && m.file);

const list: WorkflowListItem[] = metas.map((meta) => {
  const res = resolveWorkflowFile(meta);
  const apiUrl = `/api/workflows/${encodeURIComponent(meta.id)}`;
  const thumbnailUrl = meta.thumbnail ? `/api/workflows/${encodeURIComponent(meta.id)}/thumbnail` : undefined;

  if (!res.ok) {
    return { ...meta, exists: false, parseOk: false, format: "unknown", canRun: false, needsImages: 0, apiUrl, thumbnailUrl, error: res.error };
  }

  const filePath = res.filePath;
  if (!fs.existsSync(filePath)) {
    return { ...meta, exists: false, parseOk: false, format: "unknown", canRun: false, needsImages: 0, apiUrl, thumbnailUrl, filePath, error: "missing" };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) {
    return { ...meta, exists: true, parseOk: false, format: "unknown", canRun: false, needsImages: 0, apiUrl, thumbnailUrl, filePath, error: parsed.error };
  }

  const v = parsed.value as any;
  const format: WorkflowListItem["format"] = detectWorkflowFormat(v);

  // Determine whether this workflow can actually run (i.e. we can extract a prompt graph to send to ComfyUI).
  const extracted = extractPromptGraph(v);
  const canRun = extracted.ok;

  // Count how many input images are required (based on placeholders in the raw JSON text)
  const needsImages = (raw.match(/__OTG_INPUT_IMAGE__/g) || []).length;
;

  // Note: helper is named sha256OfString in this codebase
  const sha256 = sha256OfString(raw);

  return { ...meta, exists: true, parseOk: true, format, canRun, needsImages, apiUrl, thumbnailUrl, filePath, sha256 };
});
cache.list = list;
  return { ok: true, list };
}

export function loadWorkflowById(id: string): { ok: true; meta: WorkflowMeta; filePath: string; json: any } | { ok: false; status: number; error: string } {
  const lst = getWorkflowList();
  if (!lst.ok) return { ok: false, status: 500, error: lst.error };

  const item = lst.list.find((w) => w.id === id);
  if (!item) return { ok: false, status: 404, error: "workflow not found" };
  if (!item.filePath) return { ok: false, status: 500, error: "workflow path missing" };
  if (!fs.existsSync(item.filePath)) return { ok: false, status: 404, error: "workflow file missing" };

  try {
    const raw = fs.readFileSync(item.filePath, "utf8");
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) return { ok: false, status: 400, error: `workflow JSON parse error: ${parsed.error}` };

    return {
      ok: true,
      meta: item,
      filePath: item.filePath,
      json: parsed.value,
    };
  } catch (e: any) {
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}
