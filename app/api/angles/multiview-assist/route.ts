import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string };

type MultiViewManifest = {
  uploadId: string;
  deviceId: string;
  ownerKey: string;
  status: "processing" | "ready" | "partial" | "failed";
  files: Record<string, string>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_MULTIVIEW_COMFY_URL = "http://127.0.0.1:8288";
const MULTIVIEW_WORKFLOW_ID = "internal/angles_multiview_texture_turntable_v11";
const EXPECTED_VIEWS = [
  "front_view",
  "front_right_45",
  "right_90",
  "back_right_135",
  "back_view",
  "back_left_135",
  "left_90",
  "front_left_45",
] as const;

class StageError extends Error {
  stage: string;
  detail?: unknown;
  status?: number;

  constructor(stage: string, message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = "StageError";
    this.stage = stage;
    this.status = status;
    this.detail = detail;
  }
}

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "local";
}

function safeUploadId(value: FormDataEntryValue | null) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  return cleaned || "";
}

function ensureDirSync(p: string) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}

function randSeed() {
  return Math.floor(Math.random() * 9_000_000_000_000_000);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchStage(url: string, init: RequestInit, stage: string, timeoutMs: number) {
  const { signal, cancel } = timeoutSignal(timeoutMs);
  try {
    return await fetch(url, { ...init, signal, cache: "no-store" });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms.` : e?.message || String(e);
    throw new StageError(stage, msg);
  } finally {
    cancel();
  }
}

async function readJsonOrText(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function extractAnyFilesFromHistory(record: any): HistoryFile[] {
  const out: HistoryFile[] = [];
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return out;

  const pushIfFile = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (!x.filename) return;
    out.push({
      filename: String(x.filename),
      subfolder: x.subfolder ? String(x.subfolder) : "",
      type: x.type ? String(x.type) : "output",
    });
  };

  for (const nodeId of Object.keys(outputs)) {
    const nodeOut = outputs[nodeId];
    if (!nodeOut || typeof nodeOut !== "object") continue;
    for (const value of Object.values(nodeOut)) {
      if (Array.isArray(value)) {
        for (const item of value) pushIfFile(item);
      } else if (value && typeof value === "object" && Array.isArray((value as any).files)) {
        for (const item of (value as any).files) pushIfFile(item);
      }
    }
  }
  return out;
}

async function assertComfyReachable(baseUrl: string) {
  const health = await fetchStage(`${baseUrl}/system_stats`, { method: "GET" }, "multiview_healthcheck", 10_000);
  const parsed = await readJsonOrText(health);
  if (!health.ok) {
    throw new StageError(
      "multiview_healthcheck",
      `Remote Comfy healthcheck failed (${health.status}).`,
      health.status,
      parsed.json ?? parsed.text
    );
  }
  return parsed.json ?? parsed.text;
}

async function fetchComfyViewBytes(baseUrl: string, file: HistoryFile) {
  const filename = encodeURIComponent(file.filename);
  const type = encodeURIComponent(file.type || "output");
  const subfolder = encodeURIComponent(file.subfolder || "");
  const url = `${baseUrl}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;
  const res = await fetchStage(url, { method: "GET" }, "multiview_fetch_output", 60_000);
  if (!res.ok) {
    const parsed = await readJsonOrText(res);
    throw new StageError(
      "multiview_fetch_output",
      `Comfy /view failed (${res.status}) for ${file.filename}.`,
      res.status,
      parsed.json ?? parsed.text
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

function updateManifest(base: MultiViewManifest, patch: Partial<MultiViewManifest>): MultiViewManifest {
  return {
    ...base,
    ...patch,
    files: patch.files ?? base.files,
    updatedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  let owner;
  try {
    owner = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const deviceId = safeDeviceId(req.headers.get("x-otg-device-id") || owner.deviceId || null);
  const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");

  let manifestPath = "";
  let manifest: MultiViewManifest | null = null;

  try {
    const fd = await req.formData();
    const file = fd.get("image");
    const uploadId = safeUploadId(fd.get("uploadId"));
    if (!uploadId) {
      return NextResponse.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
    }
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    const workDir = path.join(dataRoot, "tmp", "angles_multiview", deviceId, uploadId);
    ensureDirSync(workDir);
    manifestPath = path.join(workDir, "manifest.json");

    const nowIso = new Date().toISOString();
    manifest = {
      uploadId,
      deviceId,
      ownerKey: owner.ownerKey,
      status: "processing",
      files: {},
      error: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const comfyBaseUrl = normalizeBase(process.env.OTG_ANGLES_MULTIVIEW_COMFY_URL || DEFAULT_MULTIVIEW_COMFY_URL);
    const comfyClientId = `${deviceId}-angles3d-multiview-${uploadId}`;

    await assertComfyReachable(comfyBaseUrl);

    const originalName = (file as any)?.name ? String((file as any).name) : `otg_multiview_${Date.now()}.png`;
    const fileBytes = Buffer.from(await (file as any).arrayBuffer());
    const mimeType = String((file as any)?.type || "").trim() || "application/octet-stream";

    const upload = new FormData();
    upload.append("image", new Blob([fileBytes], { type: mimeType }), originalName);
    upload.append("type", "input");
    upload.append("overwrite", "true");

    const uploadRes = await fetchStage(`${comfyBaseUrl}/upload/image`, { method: "POST", body: upload }, "multiview_upload", 60_000);
    const uploadParsed = await readJsonOrText(uploadRes);
    const uploadJson: any = uploadParsed.json;
    if (!uploadRes.ok || !uploadJson?.name) {
      throw new StageError(
        "multiview_upload",
        uploadJson?.error || `Comfy upload failed (${uploadRes.status}).`,
        uploadRes.status,
        uploadJson ?? uploadParsed.text
      );
    }

    const uploadedName = uploadJson.subfolder
      ? `${String(uploadJson.subfolder).replace(/^\/+|\/+$/g, "")}/${uploadJson.name}`
      : String(uploadJson.name);

    const workflow = loadWorkflowById(MULTIVIEW_WORKFLOW_ID);
    if (!workflow.ok) {
      return NextResponse.json(
        { ok: false, error: `Multi-view workflow not found: ${MULTIVIEW_WORKFLOW_ID}`, detail: workflow.error },
        { status: workflow.status }
      );
    }

    const extracted = extractPromptGraph(workflow.json);
    if (!extracted.ok) return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });
    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

    const graph: any = JSON.parse(JSON.stringify(extracted.graph));
    if (graph?.["25"]?.class_type === "LoadImage" && graph["25"]?.inputs) {
      graph["25"].inputs.image = uploadedName;
    }

    const savePrefixByNode: Record<string, string> = {
      "31": `MVTEX-${uploadId}-front_view`,
      "36": `MVTEX-${uploadId}-front_right_45`,
      "38": `MVTEX-${uploadId}-right_90`,
      "41": `MVTEX-${uploadId}-back_right_135`,
      "34": `MVTEX-${uploadId}-back_view`,
      "43": `MVTEX-${uploadId}-back_left_135`,
      "47": `MVTEX-${uploadId}-left_90`,
      "45": `MVTEX-${uploadId}-front_left_45`,
    };
    for (const [nodeId, prefix] of Object.entries(savePrefixByNode)) {
      if (graph?.[nodeId]?.class_type === "SaveImage" && graph[nodeId]?.inputs) {
        graph[nodeId].inputs.filename_prefix = prefix;
      }
    }

    for (const nodeId of Object.keys(graph)) {
      if (graph?.[nodeId]?.inputs && Object.prototype.hasOwnProperty.call(graph[nodeId].inputs, "seed")) {
        graph[nodeId].inputs.seed = randSeed();
      }
    }

    const submit = await fetchStage(
      `${comfyBaseUrl}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
      },
      "multiview_submit_prompt",
      30_000
    );
    const submitParsed = await readJsonOrText(submit);
    const submitJson: any = submitParsed.json;
    if (!submit.ok || !submitJson?.prompt_id) {
      throw new StageError(
        "multiview_submit_prompt",
        submitJson?.error || `Comfy submit failed (${submit.status}).`,
        submit.status,
        submitJson ?? submitParsed.text
      );
    }

    const promptId = String(submitJson.prompt_id);
    const historyDeadline = Date.now() + 420_000;
    const found: Record<string, HistoryFile> = {};
    const prefixMatchers = EXPECTED_VIEWS.reduce((acc, view) => {
      acc[view] = `mvtex-${uploadId.toLowerCase()}-${view.toLowerCase()}`;
      return acc;
    }, {} as Record<string, string>);

    while (Date.now() < historyDeadline) {
      const historyRes = await fetchStage(
        `${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`,
        { method: "GET" },
        "multiview_poll_history",
        20_000
      );

      if (historyRes.ok) {
        const historyParsed = await readJsonOrText(historyRes);
        const historyJson = historyParsed.json || {};
        const record = historyJson?.[promptId] || historyJson;
        const files = extractAnyFilesFromHistory(record).filter((item) => /\.(png|jpg|jpeg|webp)$/i.test(item.filename));

        for (const fileInfo of files) {
          const lower = String(fileInfo.filename || "").toLowerCase();
          for (const view of EXPECTED_VIEWS) {
            if (!found[view] && lower.includes(prefixMatchers[view])) {
              found[view] = fileInfo;
            }
          }
        }

        if (EXPECTED_VIEWS.every((view) => !!found[view])) break;
      }
      await sleep(1200);
    }

    const localFiles: Record<string, string> = {};
    for (const view of EXPECTED_VIEWS) {
      const historyFile = found[view];
      if (!historyFile) continue;
      const ext = path.extname(historyFile.filename || "").toLowerCase() || ".png";
      const bytes = await fetchComfyViewBytes(comfyBaseUrl, historyFile);
      const localPath = path.join(workDir, `${view}${ext}`);
      await fs.writeFile(localPath, bytes);
      localFiles[view] = localPath;
    }

    const nextStatus: MultiViewManifest["status"] =
      Object.keys(localFiles).length === EXPECTED_VIEWS.length ? "ready" : Object.keys(localFiles).length > 0 ? "partial" : "failed";

    manifest = updateManifest(manifest, {
      status: nextStatus,
      files: localFiles,
      error: nextStatus === "failed" ? "No multiview images were returned by ComfyUI." : null,
    });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return NextResponse.json(
      {
        ok: true,
        uploadId,
        promptId,
        status: manifest.status,
        readyCount: Object.keys(localFiles).length,
        expectedCount: EXPECTED_VIEWS.length,
        files: Object.fromEntries(Object.entries(localFiles).map(([key, value]) => [key, `/api/file?path=${encodeURIComponent(value)}`])),
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    if (manifest && manifestPath) {
      try {
        const failedManifest = updateManifest(manifest, {
          status: "failed",
          error: e?.message || String(e),
        });
        await fs.writeFile(manifestPath, JSON.stringify(failedManifest, null, 2), "utf8");
      } catch {}
    }
    if (e instanceof StageError) {
      return NextResponse.json(
        { ok: false, error: e.message, stage: e.stage, status: e.status ?? 500, detail: e.detail ?? null },
        { status: e.status && e.status >= 400 ? e.status : 500 }
      );
    }
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
