import fs from "node:fs";
import path from "node:path";
import { deviceGalleryDir, OTG_DATA_ROOT, userGalleryDir } from "@/lib/paths";
import { ensureGalleryMetaForFile, readMetaForFile } from "@/lib/gallery";
import { warmGalleryThumb } from "@/lib/galleryThumbs";
import { markError, markReady, readState, writeState } from "@/lib/contentState";
import { readPromptRequestMeta } from "@/lib/promptRequestMeta";

type JobLine = {
  ts?: number;
  prompt_id?: string | null;
  promptId?: string | null;
  ownerKey?: string | null;
  username?: string | null;
  deviceId?: string | null;
  title?: string | null;
  workflowLabel?: string | null;
  requestKind?: string | null;
  extendRequestId?: string | null;
  sourceType?: string | null;
  extendedFromName?: string | null;
  extendSourceFrame?: string | null;
  extendMode?: string | null;
  preset?: string | null;
  positivePrompt?: string | null;
  negativePrompt?: string | null;
  submitPayload?: any | null;
};

type MediaPayload = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
  bucket?: "images" | "videos" | "gifs";
};

type SyncArgs = {
  promptId: string;
  ownerKey: string;
  username: string | null;
  deviceId: string;
  comfyBaseUrl?: string;
  imageComfyBaseUrl?: string;
  videoComfyBaseUrl?: string;
};

type ReadMediaResult =
  | { ok: true; bytes: Buffer; source: "disk" | "view"; resolvedPath?: string }
  | { ok: false; status: number; error: string };

const JOBS_FILE_DIR = path.join(OTG_DATA_ROOT, "device_jobs");
const DEFAULT_RENDER_IMPORT_ROOTS = [
  "E:\\Renders\\ComfyUI\\Video",
  "E:\\Renders\\ComfyUI",
];

function uniquePaths(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const key = process.platform === "win32" ? raw.toLowerCase() : raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function configuredRenderImportRoots() {
  const envRoots = String(process.env.OTG_GALLERY_IMPORT_ROOTS || "")
    .split(/[;\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const roots = uniquePaths([
    ...envRoots,
    process.env.COMFY_OUTPUT_DIR || null,
    process.env.ADMIN_GALLERY_ROOT || null,
    ...DEFAULT_RENDER_IMPORT_ROOTS,
  ]);

  return roots.filter((root) => {
    try {
      return fs.existsSync(root) && fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

function payloadLookupKey(payload: MediaPayload) {
  return `${String(payload.type || "output").trim().toLowerCase()}|${String(payload.subfolder || "")
    .trim()
    .replace(/\\/g, "/")}|${String(payload.filename || "")
    .trim()
    .replace(/\\/g, "/")}`;
}

function payloadRelativeCandidates(payload: MediaPayload) {
  const rawFilename = String(payload.filename || "").trim().replace(/\\/g, "/");
  const rawSubfolder = String(payload.subfolder || "").trim().replace(/\\/g, "/");
  const filenameBase = path.basename(rawFilename);

  const rels = uniqueStrings([
    rawSubfolder ? path.join(rawSubfolder, filenameBase) : null,
    path.join("Video", filenameBase),
    path.join("video", filenameBase),
    path.join("Videos", filenameBase),
    path.join("videos", filenameBase),
    rawFilename,
    filenameBase,
  ]);

  return rels
    .map((rel) => rel.replace(/^([A-Za-z]:)?[\/]+/, ""))
    .filter(Boolean)
    .filter((rel) => {
      const normalized = rel.replace(/\\/g, "/");
      return !normalized.split("/").some((part) => part === ".." || !part);
    });
}

function findPayloadFileOnDisk(payload: MediaPayload): string | null {
  const roots = configuredRenderImportRoots();
  if (!roots.length) return null;

  const relCandidates = payloadRelativeCandidates(payload);
  for (const root of roots) {
    for (const rel of relCandidates) {
      try {
        const candidate = path.resolve(root, rel);
        const relative = path.relative(root, candidate);
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
        if (!fs.existsSync(candidate)) continue;
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        return candidate;
      } catch {
        // ignore and keep scanning
      }
    }
  }

  return null;
}

function safePromptId(raw: unknown) {
  return String(raw || "").trim();
}

function safeBaseName(filename: string) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext).replace(/[^a-zA-Z0-9._() -]+/g, "_").trim() || "output";
  const cleanExt = ext.replace(/[^a-zA-Z0-9.]+/g, "") || ".bin";
  return `${stem}${cleanExt}`.slice(0, 220);
}

function readJsonlLines(filePath: string): JobLine[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return [];
    const out: JobLine[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const j = JSON.parse(s);
        if (j && typeof j === "object") out.push(j as JobLine);
      } catch {
        // ignore malformed lines
      }
    }
    return out;
  } catch {
    return [];
  }
}

function listOwnerJobs(ownerKey: string, deviceId: string, limit?: number): JobLine[] {
  const results: JobLine[] = [];
  const seen = new Set<string>();

  try {
    if (!fs.existsSync(JOBS_FILE_DIR)) return [];
    const files = fs.readdirSync(JOBS_FILE_DIR).filter((f) => f.endsWith(".jsonl"));

    for (const file of files) {
      const lines = readJsonlLines(path.join(JOBS_FILE_DIR, file));
      for (const row of lines) {
        const pid = safePromptId(row.prompt_id || row.promptId);
        if (!pid) continue;

        const rowOwner = String(row.ownerKey || "").trim();
        const rowDevice = String(row.deviceId || "").trim();

        if (rowOwner) {
          if (rowOwner !== ownerKey) continue;
        } else if (rowDevice !== deviceId) {
          continue;
        }

        if (seen.has(pid)) continue;
        seen.add(pid);
        results.push(row);
      }
    }
  } catch {
    return [];
  }

  results.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));

  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) {
    return results;
  }

  return results.slice(0, Math.max(1, Math.floor(Number(limit))));
}

export function listRecentOwnerJobs(ownerKey: string, deviceId: string, limit = 25): JobLine[] {
  return listOwnerJobs(ownerKey, deviceId, limit);
}

export function findOwnerJobByPromptId(ownerKey: string, deviceId: string, promptId: string): JobLine | null {
  const pid = safePromptId(promptId);
  if (!pid) return null;
  const jobs = listRecentOwnerJobs(ownerKey, deviceId, 200);
  return jobs.find((row) => safePromptId(row.prompt_id || row.promptId) === pid) || null;
}

export function newestPromptIdForOwner(ownerKey: string, deviceId: string): string | null {
  const jobs = listRecentOwnerJobs(ownerKey, deviceId, 20);
  return safePromptId(jobs[0]?.prompt_id || jobs[0]?.promptId) || null;
}

function jobWorkflowKey(job: JobLine | null | undefined) {
  const parts = [
    job?.title,
    job?.preset,
    job?.submitPayload?.workflowId,
    job?.submitPayload?.preset,
    job?.submitPayload?.title,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  return parts.join(" ");
}

function isLikelyVideoJob(job: JobLine | null | undefined) {
  const key = jobWorkflowKey(job);
  if (!key) return false;
  return (
    key.includes("create a video") ||
    key.includes("video from pictures") ||
    key.includes("extend a video") ||
    key.includes("animate") ||
    key.includes("ltx") ||
    key.includes("vhs_") ||
    key.includes("video")
  );
}

function resolveSyncComfyBaseUrl(args: SyncArgs, job: JobLine | null) {
  const single = String(args.comfyBaseUrl || "").trim().replace(/\/+$/, "");
  const image = String(args.imageComfyBaseUrl || "").trim().replace(/\/+$/, "");
  const video = String(args.videoComfyBaseUrl || "").trim().replace(/\/+$/, "");

  if (!image && !video) return single;
  if (isLikelyVideoJob(job)) return video || single || image;
  return image || single || video;
}

async function fetchHistory(comfyBaseUrl: string, promptId: string) {
  const r = await fetch(`${comfyBaseUrl.replace(/\/+$/, "")}/history/${encodeURIComponent(promptId)}`, {
    cache: "no-store",
  });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

function extractMediaPayloads(entry: any): MediaPayload[] {
  const outputs = entry?.outputs;
  if (!outputs || typeof outputs !== "object") return [];

  const out: MediaPayload[] = [];
  for (const [nodeId, node] of Object.entries(outputs) as Array<[string, any]>) {
    const buckets: Array<{ name: "images" | "videos" | "gifs"; items: any[] }> = [
      { name: "images", items: Array.isArray(node?.images) ? node.images : [] },
      { name: "videos", items: Array.isArray(node?.videos) ? node.videos : [] },
      { name: "gifs", items: Array.isArray(node?.gifs) ? node.gifs : [] },
    ];
    for (const bucket of buckets) {
      for (const item of bucket.items) {
        if (!item?.filename) continue;
        out.push({
          filename: String(item.filename),
          subfolder: item.subfolder ? String(item.subfolder) : "",
          type: item.type ? String(item.type) : "output",
          nodeId,
          bucket: bucket.name,
        });
      }
    }
  }
  return out;
}

async function readPreferredBytes(comfyBaseUrl: string, payload: MediaPayload): Promise<ReadMediaResult> {
  const diskPath = findPayloadFileOnDisk(payload);
  if (diskPath) {
    try {
      return {
        ok: true,
        bytes: fs.readFileSync(diskPath),
        source: "disk",
        resolvedPath: diskPath,
      };
    } catch {
      // fall through to Comfy /view
    }
  }

  const viewUrl = new URL(`${comfyBaseUrl.replace(/\/+$/, "")}/view`);
  viewUrl.searchParams.set("filename", path.basename(payload.filename));
  viewUrl.searchParams.set("type", payload.type || "output");
  if (payload.subfolder) {
    viewUrl.searchParams.set("subfolder", payload.subfolder);
  }

  const r = await fetch(viewUrl.toString(), { cache: "no-store" });
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      error: `Comfy /view failed (${r.status}) for ${payload.filename}`,
    };
  }

  return {
    ok: true,
    bytes: Buffer.from(await r.arrayBuffer()),
    source: "view",
  };
}



type PayloadCandidate = {
  payload: MediaPayload;
  diskPath: string | null;
  stat: fs.Stats | null;
  ext: string;
  mediaKind: "image" | "video";
  score: number;
};

function payloadExt(payload: MediaPayload) {
  return path.extname(String(payload.filename || "")).trim().toLowerCase();
}

function payloadMediaKind(payload: MediaPayload): "image" | "video" {
  const ext = payloadExt(payload);
  if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"].includes(ext)) return "video";
  if (payload.bucket === "videos" || payload.bucket === "gifs") return "video";
  return "image";
}

function payloadNamePenalty(name: string) {
  const raw = String(name || "").trim().toLowerCase();
  let score = 0;
  if (/(^|[_\-.])preview([_\-.]|$)/.test(raw)) score -= 80;
  if (/(^|[_\-.])thumb([_\-.]|$)/.test(raw)) score -= 80;
  if (/(^|[_\-.])temp([_\-.]|$)/.test(raw)) score -= 100;
  if (/(^|[_\-.])cache([_\-.]|$)/.test(raw)) score -= 50;
  if (/(^|[_\-.])frame[s]?([_\-.]|$)/.test(raw)) score -= 120;
  if (/(^|[_\-.])latent([_\-.]|$)/.test(raw)) score -= 100;
  if (/(^|[_\-.])mask([_\-.]|$)/.test(raw)) score -= 90;
  if (/(^|[_\-.])alpha([_\-.]|$)/.test(raw)) score -= 50;
  if (/(^|[_\-.])intermediate([_\-.]|$)/.test(raw)) score -= 120;
  if (/(^|[_\-.])contactsheet([_\-.]|$)/.test(raw)) score -= 120;
  return score;
}

function payloadExtScore(ext: string, desiredKind: "image" | "video") {
  const e = String(ext || "").toLowerCase();
  if (desiredKind === "video") {
    if (e === ".mp4") return 260;
    if (e === ".webm") return 220;
    if (e === ".mov") return 200;
    if (e === ".gif") return 120;
    if (e === ".png" || e === ".jpg" || e === ".jpeg" || e === ".webp") return -300;
    return 0;
  }
  if (e === ".png") return 220;
  if (e === ".jpg" || e === ".jpeg") return 200;
  if (e === ".webp") return 180;
  if (e === ".gif" || e === ".mp4" || e === ".webm" || e === ".mov") return -300;
  return 0;
}

function buildPayloadCandidate(payload: MediaPayload, desiredKind: "image" | "video"): PayloadCandidate {
  const ext = payloadExt(payload);
  const mediaKind = payloadMediaKind(payload);
  let diskPath: string | null = null;
  let stat: fs.Stats | null = null;
  try {
    diskPath = findPayloadFileOnDisk(payload);
    if (diskPath && fs.existsSync(diskPath)) {
      stat = fs.statSync(diskPath);
    }
  } catch {
    diskPath = null;
    stat = null;
  }

  const nodeIdNum = Number(String(payload.nodeId || "").trim());
  let score = 0;
  score += mediaKind === desiredKind ? 1000 : -1000;
  score += payloadExtScore(ext, desiredKind);
  score += payloadNamePenalty(path.basename(payload.filename));
  if (payload.type === "output") score += 80;
  if (stat?.isFile()) score += 120;
  if (Number.isFinite(nodeIdNum)) score += Math.min(60, Math.max(0, nodeIdNum / 10));
  if (stat?.size) {
    score += Math.min(240, Math.round(Math.log10(Math.max(1, stat.size)) * 40));
  }
  if (stat?.mtimeMs) {
    score += Math.min(220, Math.round(stat.mtimeMs / 1000) % 220);
  }

  return { payload, diskPath, stat, ext, mediaKind, score };
}

function sortPayloadCandidates(outputs: MediaPayload[], desiredKind: "image" | "video") {
  const candidates = outputs.map((payload) => buildPayloadCandidate(payload, desiredKind));
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aMtime = Number(a.stat?.mtimeMs || 0);
    const bMtime = Number(b.stat?.mtimeMs || 0);
    if (bMtime !== aMtime) return bMtime - aMtime;
    const aSize = Number(a.stat?.size || 0);
    const bSize = Number(b.stat?.size || 0);
    if (bSize !== aSize) return bSize - aSize;
    return String(a.payload.filename).localeCompare(String(b.payload.filename));
  });
  return candidates;
}

function payloadLooksIntermediate(payload: MediaPayload) {
  const raw = path.basename(String(payload.filename || "")).trim().toLowerCase();
  if (!raw) return true;
  return (
    /(^|[_\-.])thumb([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])temp([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])cache([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])latent([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])mask([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])intermediate([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])contactsheet([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])preview([_\-.]|$)/.test(raw) ||
    /(^|[_\-.])frames?([_\-.]|$)/.test(raw)
  );
}

function selectImportPayloads(outputs: MediaPayload[], job: JobLine | null | undefined): MediaPayload[] {
  if (!outputs.length) return [];

  const desiredKind: "image" | "video" = isLikelyVideoJob(job) ? "video" : "image";
  const sorted = sortPayloadCandidates(outputs, desiredKind);

  const finalOfDesiredKind = sorted.filter((candidate) => {
    if (candidate.mediaKind !== desiredKind) return false;
    if (payloadLooksIntermediate(candidate.payload)) return false;
    return true;
  });

  if (finalOfDesiredKind.length) {
    return finalOfDesiredKind.map((candidate) => candidate.payload);
  }

  const desiredFallback = sorted.filter((candidate) => candidate.mediaKind === desiredKind);
  if (desiredFallback.length) {
    return [desiredFallback[0].payload];
  }

  return sorted.length ? [sorted[0].payload] : [];
}

function chooseGalleryDir(username: string | null, deviceId: string) {
  return username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
}

function chooseDestinationName(destDir: string, originalBase: string, promptId: string, bytes: Buffer, sourcePayloadKey: string) {
  const initial = safeBaseName(originalBase);
  const direct = path.join(destDir, initial);

  if (!fs.existsSync(direct)) {
    return { name: initial, existing: false };
  }

  try {
    const meta = readMetaForFile(direct);
    const st = fs.statSync(direct);
    if (
      meta?.sourcePromptId === promptId &&
      (String(meta?.sourcePayloadKey || "").trim() === sourcePayloadKey || st.size === bytes.length)
    ) {
      return { name: initial, existing: true };
    }
  } catch {
    // ignore
  }

  const ext = path.extname(initial);
  const stem = path.basename(initial, ext);

  let n = 1;
  while (n < 1000) {
    const candidate = `${stem}__${promptId.slice(0, 12)}__${n}${ext}`;
    const abs = path.join(destDir, candidate);
    if (!fs.existsSync(abs)) {
      return { name: candidate, existing: false };
    }
    n++;
  }

  return { name: `${Date.now()}__${initial}`, existing: false };
}

function importedPayloadKeysForPrompt(destDir: string, promptId: string) {
  const keys = new Set<string>();
  try {
    if (!fs.existsSync(destDir)) return keys;
    const files = fs.readdirSync(destDir).filter((f) => f.endsWith(".meta.json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(destDir, file), "utf-8");
        const meta = JSON.parse(raw);
        if (String(meta?.sourcePromptId || "").trim() !== promptId) continue;
        const payloadKey = String(meta?.sourcePayloadKey || "").trim();
        if (payloadKey) keys.add(payloadKey);
      } catch {
        // ignore
      }
    }
  } catch {
    return keys;
  }
  return keys;
}

function primarySavedNameForPrompt(destDir: string, promptId: string) {
  try {
    if (!fs.existsSync(destDir)) return null;
    const files = fs.readdirSync(destDir).filter((f) => !f.endsWith('.meta.json'));
    const matches: Array<{ name: string; createdAt: number }> = [];
    for (const file of files) {
      try {
        const abs = path.join(destDir, file);
        const meta = readMetaForFile(abs);
        if (String(meta?.sourcePromptId || "").trim() !== promptId) continue;
        matches.push({ name: file, createdAt: Number(meta?.createdAt || meta?.updatedAt || 0) });
      } catch {
        // ignore
      }
    }
    matches.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
    return matches[0]?.name || null;
  } catch {
    return null;
  }
}

function resolvePromptSyncContext(promptId: string, ownerKey: string, state: ReturnType<typeof readState>, job: JobLine | null) {
  const safeStatePromptId = safePromptId(state?.promptId || state?.lastSyncedPromptId || "");
  const stateMatchesPrompt = !!safeStatePromptId && safeStatePromptId === promptId;
  const promptMeta = readPromptRequestMeta(ownerKey, promptId);

  const promptMetaSubmitPayload = promptMeta?.submitPayload && typeof promptMeta.submitPayload === "object"
    ? promptMeta.submitPayload
    : null;
  const jobSubmitPayload = job?.submitPayload && typeof job.submitPayload === "object" ? job.submitPayload : null;
  const stateSubmitPayload = stateMatchesPrompt && state?.submitPayload && typeof state.submitPayload === "object"
    ? state.submitPayload
    : null;

  const mergedPromptSubmitPayload = {
    ...(promptMetaSubmitPayload && typeof promptMetaSubmitPayload === "object" ? promptMetaSubmitPayload : {}),
    workflowLabel:
      String((promptMetaSubmitPayload as any)?.workflowLabel || promptMeta?.workflowLabel || "").trim() ||
      (promptMetaSubmitPayload as any)?.workflowLabel ||
      null,
    title:
      String((promptMetaSubmitPayload as any)?.title || promptMeta?.title || "").trim() ||
      (promptMetaSubmitPayload as any)?.title ||
      null,
    requestKind:
      String((promptMetaSubmitPayload as any)?.requestKind || promptMeta?.requestKind || "").trim() ||
      (promptMetaSubmitPayload as any)?.requestKind ||
      null,
    extendRequestId:
      String((promptMetaSubmitPayload as any)?.extendRequestId || promptMeta?.extendRequestId || "").trim() ||
      (promptMetaSubmitPayload as any)?.extendRequestId ||
      null,
    sourceType:
      String((promptMetaSubmitPayload as any)?.sourceType || promptMeta?.sourceType || "").trim() ||
      (promptMetaSubmitPayload as any)?.sourceType ||
      null,
    extendedFromName:
      String((promptMetaSubmitPayload as any)?.extendedFromName || promptMeta?.extendedFromName || "").trim() ||
      (promptMetaSubmitPayload as any)?.extendedFromName ||
      null,
    extendSourceFrame:
      String((promptMetaSubmitPayload as any)?.extendSourceFrame || promptMeta?.extendSourceFrame || "").trim() ||
      (promptMetaSubmitPayload as any)?.extendSourceFrame ||
      null,
    extendMode:
      String((promptMetaSubmitPayload as any)?.extendMode || promptMeta?.extendMode || "").trim() ||
      (promptMetaSubmitPayload as any)?.extendMode ||
      null,
  };

  const mergedJobSubmitPayload = {
    ...(jobSubmitPayload && typeof jobSubmitPayload === "object" ? jobSubmitPayload : {}),
    workflowLabel:
      String((jobSubmitPayload as any)?.workflowLabel || job?.workflowLabel || "").trim() ||
      (jobSubmitPayload as any)?.workflowLabel ||
      null,
    title:
      String((jobSubmitPayload as any)?.title || job?.title || "").trim() ||
      (jobSubmitPayload as any)?.title ||
      null,
    requestKind:
      String((jobSubmitPayload as any)?.requestKind || job?.requestKind || "").trim() ||
      (jobSubmitPayload as any)?.requestKind ||
      null,
    extendRequestId:
      String((jobSubmitPayload as any)?.extendRequestId || job?.extendRequestId || "").trim() ||
      (jobSubmitPayload as any)?.extendRequestId ||
      null,
    sourceType:
      String((jobSubmitPayload as any)?.sourceType || job?.sourceType || "").trim() ||
      (jobSubmitPayload as any)?.sourceType ||
      null,
    extendedFromName:
      String((jobSubmitPayload as any)?.extendedFromName || job?.extendedFromName || "").trim() ||
      (jobSubmitPayload as any)?.extendedFromName ||
      null,
    extendSourceFrame:
      String((jobSubmitPayload as any)?.extendSourceFrame || job?.extendSourceFrame || "").trim() ||
      (jobSubmitPayload as any)?.extendSourceFrame ||
      null,
    extendMode:
      String((jobSubmitPayload as any)?.extendMode || job?.extendMode || "").trim() ||
      (jobSubmitPayload as any)?.extendMode ||
      null,
  };

  const submitPayload =
    (promptMetaSubmitPayload ? mergedPromptSubmitPayload : null) ??
    (jobSubmitPayload ? mergedJobSubmitPayload : null) ??
    stateSubmitPayload ??
    null;

  return {
    submitPayload,
    positivePrompt:
      promptMeta?.positivePrompt ??
      (promptMetaSubmitPayload ? String((promptMetaSubmitPayload as any).positivePrompt || (promptMetaSubmitPayload as any).prompt || "").trim() || null : null) ??
      job?.positivePrompt ??
      (jobSubmitPayload ? String((jobSubmitPayload as any).positivePrompt || (jobSubmitPayload as any).prompt || "").trim() || null : null) ??
      (stateMatchesPrompt ? state?.positivePrompt ?? null : null),
    negativePrompt:
      promptMeta?.negativePrompt ??
      (promptMetaSubmitPayload ? String((promptMetaSubmitPayload as any).negativePrompt || (promptMetaSubmitPayload as any).neg || "").trim() || null : null) ??
      job?.negativePrompt ??
      (jobSubmitPayload ? String((jobSubmitPayload as any).negativePrompt || (jobSubmitPayload as any).neg || "").trim() || null : null) ??
      (stateMatchesPrompt ? state?.negativePrompt ?? null : null),
    workflowId:
      String(
        promptMeta?.workflowId ||
        (promptMetaSubmitPayload as any)?.workflowId ||
        (promptMetaSubmitPayload as any)?.preset ||
        job?.submitPayload?.workflowId ||
        job?.submitPayload?.preset ||
        job?.preset ||
        (stateMatchesPrompt ? state?.workflowId : "") ||
        ""
      ).trim() || null,
    workflowTitle:
      String(
        promptMeta?.workflowLabel ||
        promptMeta?.title ||
        (promptMetaSubmitPayload as any)?.workflowLabel ||
        (promptMetaSubmitPayload as any)?.title ||
        job?.title ||
        job?.submitPayload?.workflowLabel ||
        job?.submitPayload?.title ||
        (stateMatchesPrompt ? state?.workflowTitle : "") ||
        ""
      ).trim() || null,
  };
}

export async function syncPromptOutputsForOwner(args: SyncArgs): Promise<{
  ok: boolean;
  promptId: string;
  status: "pending" | "synced" | "already-synced" | "error";
  saved: string[];
  error?: string;
}> {
  const promptId = safePromptId(args.promptId);
  if (!promptId) {
    return { ok: false, promptId: "", status: "error", saved: [], error: "Missing promptId" };
  }

  const state = readState(args.ownerKey);
  const galleryDir = chooseGalleryDir(args.username, args.deviceId);
  fs.mkdirSync(galleryDir, { recursive: true });


  const job = findOwnerJobByPromptId(args.ownerKey, args.deviceId, promptId);
  const comfyBaseUrl = resolveSyncComfyBaseUrl(args, job);
  const historyJson = await fetchHistory(comfyBaseUrl, promptId);
  const entry = historyJson?.[promptId];

  if (entry?.status?.status_str && String(entry.status.status_str).toLowerCase().includes("error")) {
    const message = String(entry.status.status_str || "ComfyUI reported an error");
    markError(args.ownerKey, message);
    return { ok: false, promptId, status: "error", saved: [], error: message };
  }

  const outputs = extractMediaPayloads(entry);
  const dedupedOutputs: MediaPayload[] = [];
  const seenPayloads = new Set<string>();
  for (const payload of outputs) {
    const payloadKey = payloadLookupKey(payload);
    if (seenPayloads.has(payloadKey)) continue;
    seenPayloads.add(payloadKey);
    dedupedOutputs.push(payload);
  }

  if (!dedupedOutputs.length) {
    return { ok: true, promptId, status: "pending", saved: [] };
  }

  const selectedPayloads = selectImportPayloads(dedupedOutputs, job);
  if (!selectedPayloads.length) {
    return { ok: true, promptId, status: "pending", saved: [] };
  }

  const selectedPayloadKeys = new Set(selectedPayloads.map((payload) => payloadLookupKey(payload)));
  const importedPayloadKeys = importedPayloadKeysForPrompt(galleryDir, promptId);
  const payloadsToImport = selectedPayloads.filter((payload) => !importedPayloadKeys.has(payloadLookupKey(payload)));

  if (!payloadsToImport.length && selectedPayloadKeys.size > 0) {
    const primaryExisting = primarySavedNameForPrompt(galleryDir, promptId) || state?.fileName || null;
    writeState(args.ownerKey, {
      promptId,
      fileName: primaryExisting,
      status: primaryExisting ? "done" : state?.status || "idle",
      lastSyncedPromptId: promptId,
    });

    return {
      ok: true,
      promptId,
      status: "already-synced",
      saved: [],
    };
  }

  const syncContext = resolvePromptSyncContext(promptId, args.ownerKey, state, job);

  const saved: string[] = [];
  let missingCount = 0;

  for (const payload of payloadsToImport) {
    const fetched = await readPreferredBytes(comfyBaseUrl, payload);

    if (!fetched.ok) {
      if (fetched.status === 404) {
        missingCount++;
        continue;
      }
      return { ok: false, promptId, status: "error", saved, error: fetched.error };
    }

    const bytes = fetched.bytes;
    const originalBase = path.basename(payload.filename);
    const sourcePayloadKey = payloadLookupKey(payload);
    const dest = chooseDestinationName(galleryDir, originalBase, promptId, bytes, sourcePayloadKey);
    const absPath = path.join(galleryDir, dest.name);

    if (!dest.existing) {
      fs.writeFileSync(absPath, bytes);
    }

    let existingMeta: any = {};
    try {
      existingMeta = readMetaForFile(absPath) || {};
    } catch {
      existingMeta = {};
    }

    const submitPayload = syncContext.submitPayload;
    const inferredGalleryExtend =
      submitPayload &&
      typeof submitPayload === "object" &&
      (String((submitPayload as any).requestKind || "").trim() === "gallery-extend" ||
        !!String((submitPayload as any).extendedFromName || "").trim() ||
        !!String((submitPayload as any).extendSourceFrame || "").trim() ||
        !!String((submitPayload as any).extendMode || "").trim());

    ensureGalleryMetaForFile(absPath, {
      originalName: originalBase,
      renamedName: existingMeta?.renamedName || dest.name,
      positivePrompt: syncContext.positivePrompt,
      negativePrompt: syncContext.negativePrompt,
      submitPayload,
      workflowId: syncContext.workflowId,
      workflowTitle: syncContext.workflowTitle,
      sourcePromptId: promptId,
      sourcePayloadKey,
      sourceNodeId: payload.nodeId ? String(payload.nodeId) : null,
      sourceBucket: payload.bucket || null,
      sourceType:
        existingMeta?.sourceType ??
        (submitPayload && typeof submitPayload === "object" ? String((submitPayload as any).sourceType || "").trim() || null : null) ??
        (inferredGalleryExtend ? "gallery-extend" : null) ??
        "generated",
      extendedFromName:
        existingMeta?.extendedFromName ??
        (submitPayload && typeof submitPayload === "object" ? String((submitPayload as any).extendedFromName || "").trim() || null : null),
      extendSourceFrame:
        existingMeta?.extendSourceFrame ??
        (submitPayload && typeof submitPayload === "object" ? String((submitPayload as any).extendSourceFrame || "").trim() || null : null),
      extendMode:
        existingMeta?.extendMode ??
        (submitPayload && typeof submitPayload === "object" ? String((submitPayload as any).extendMode || "").trim() || null : null),
      requestKind:
        existingMeta?.requestKind ??
        (submitPayload && typeof submitPayload === "object" ? String((submitPayload as any).requestKind || "").trim() || null : null),
      extendRequestId:
        existingMeta?.extendRequestId ??
        (submitPayload && typeof submitPayload === "object" ? String((submitPayload as any).extendRequestId || "").trim() || null : null),
      ownerKey: args.ownerKey,
      username: args.username,
      deviceId: args.deviceId,
      importedFromPath: fetched.resolvedPath || null,
      importedFromSource: fetched.source,
      createdAt: Number(job?.ts || state?.startedAt || Date.now()),
      metaVersion: 2,
    });

    saved.push(dest.name);
    warmGalleryThumb(absPath, 768);
    warmGalleryThumb(absPath, 512);
  }

  const importedAfterSave = importedPayloadKeysForPrompt(galleryDir, promptId);
  const fullySynced = Array.from(selectedPayloadKeys).every((key) => importedAfterSave.has(key));
  const primary = saved[0] || primarySavedNameForPrompt(galleryDir, promptId) || state?.fileName || null;

  if (primary) {
    markReady(args.ownerKey, primary);
  }

  writeState(args.ownerKey, {
    promptId,
    fileName: primary,
    status: primary ? "done" : state?.status || "idle",
    lastSyncedPromptId: fullySynced ? promptId : null,
  });

  if (primary && fullySynced) {
    return {
      ok: true,
      promptId,
      status: saved.length > 0 ? "synced" : "already-synced",
      saved,
    };
  }

  if (missingCount > 0 || saved.length > 0) {
    return {
      ok: true,
      promptId,
      status: fullySynced ? "synced" : "pending",
      saved,
    };
  }

  return {
    ok: true,
    promptId,
    status: "pending",
    saved: [],
  };
}

export async function forcePullOwnerPrompts(args: {
  ownerKey: string;
  username: string | null;
  deviceId: string;
  comfyBaseUrl?: string;
  imageComfyBaseUrl?: string;
  videoComfyBaseUrl?: string;
  limit?: number;
}) {
  const state = readState(args.ownerKey);
  const promptIds: string[] = [];
  const seen = new Set<string>();

  const pushPid = (v: unknown) => {
    const pid = safePromptId(v);
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    promptIds.push(pid);
  };

  pushPid(state?.promptId);

  const maxJobs = Math.max(1, Math.min(5000, Number(args.limit || 5000) || 5000));
  for (const row of listOwnerJobs(args.ownerKey, args.deviceId, maxJobs)) {
    pushPid(row.prompt_id || row.promptId);
  }

  const results: Array<{ promptId: string; status: string; saved: string[]; error?: string }> = [];

  for (const promptId of promptIds) {
    try {
      const res = await syncPromptOutputsForOwner({
        promptId,
        ownerKey: args.ownerKey,
        username: args.username,
        deviceId: args.deviceId,
        comfyBaseUrl: args.comfyBaseUrl,
        imageComfyBaseUrl: args.imageComfyBaseUrl,
        videoComfyBaseUrl: args.videoComfyBaseUrl,
      });

      results.push({
        promptId: res.promptId,
        status: res.status,
        saved: res.saved,
        error: res.error,
      });
    } catch (e: any) {
      results.push({
        promptId,
        status: "error",
        saved: [],
        error: String(e?.message || e),
      });
    }
  }

  return {
    ok: true,
    checked: promptIds.length,
    results,
    syncedCount: results.reduce((n, r) => n + r.saved.length, 0),
    pendingCount: results.filter((r) => r.status === "pending").length,
    alreadySyncedCount: results.filter((r) => r.status === "already-synced").length,
    errorCount: results.filter((r) => r.status === "error").length,
  };
}

export async function syncRecentOwnerPrompts(args: {
  ownerKey: string;
  username: string | null;
  deviceId: string;
  comfyBaseUrl?: string;
  imageComfyBaseUrl?: string;
  videoComfyBaseUrl?: string;
  limit?: number;
}) {
  const state = readState(args.ownerKey);
  const promptIds: string[] = [];
  const seen = new Set<string>();

  const pushPid = (v: unknown) => {
    const pid = safePromptId(v);
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    promptIds.push(pid);
  };

  pushPid(state?.promptId);

  for (const row of listRecentOwnerJobs(args.ownerKey, args.deviceId, args.limit || 12)) {
    pushPid(row.prompt_id || row.promptId);
  }

  const results: Array<{ promptId: string; status: string; saved: string[]; error?: string }> = [];

  for (const promptId of promptIds) {
    try {
      const res = await syncPromptOutputsForOwner({
        promptId,
        ownerKey: args.ownerKey,
        username: args.username,
        deviceId: args.deviceId,
        comfyBaseUrl: args.comfyBaseUrl,
        imageComfyBaseUrl: args.imageComfyBaseUrl,
        videoComfyBaseUrl: args.videoComfyBaseUrl,
      });

      results.push({
        promptId: res.promptId,
        status: res.status,
        saved: res.saved,
        error: res.error,
      });
    } catch (e: any) {
      results.push({
        promptId,
        status: "error",
        saved: [],
        error: String(e?.message || e),
      });
    }
  }

  return {
    ok: true,
    checked: promptIds.length,
    results,
    syncedCount: results.reduce((n, r) => n + r.saved.length, 0),
    errorCount: results.filter((r) => r.status === "error").length,
  };
}
