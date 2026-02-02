function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { deviceGalleryDir, userGalleryDir } from "@/lib/paths";
import { markReady, readState, resetState } from "@/lib/contentState";

export const runtime = "nodejs";

const COMFY_BASE_URL = (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "";
}

async function fetchAndStoreLatestOutput(args: {
  promptId: string;
  ownerKey: string;
  baseDir: string;
}): Promise<string | null> {
  const { promptId, ownerKey, baseDir } = args;
  try {
    const hr = await fetch(`${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
    const hj = await hr.json().catch(() => ({}));
    const entry = (hj as any)?.[promptId];
    const outputs = entry?.outputs;
    if (!outputs || typeof outputs !== "object") return null;

    // Find first image/video-like payload
    let file: { filename: string; subfolder?: string; type?: string } | null = null;
    for (const out of Object.values(outputs) as any[]) {
      const imgs = out?.images;
      const vids = out?.videos;
      const gifs = out?.gifs;
      const cand =
        (Array.isArray(imgs) && imgs[0]) ||
        (Array.isArray(vids) && vids[0]) ||
        (Array.isArray(gifs) && gifs[0]) ||
        null;
      if (cand?.filename) {
        file = { filename: String(cand.filename), subfolder: cand.subfolder, type: cand.type };
        break;
      }
    }
    if (!file) return null;

    const filename = path.basename(file.filename);
    const subfolder = file.subfolder ? String(file.subfolder) : "";
    const type = file.type ? String(file.type) : "output";

    const viewUrl = new URL(`${COMFY_BASE_URL}/view`);
    viewUrl.searchParams.set("filename", filename);
    viewUrl.searchParams.set("type", type);
    if (subfolder) viewUrl.searchParams.set("subfolder", subfolder);

    const vr = await fetch(viewUrl.toString(), { cache: "no-store" });
    if (!vr.ok) return null;
    const buf = Buffer.from(await vr.arrayBuffer());

    // Ensure unique name in gallery
    let outName = filename;
    const outPath = () => path.join(baseDir, outName);
    if (fs.existsSync(outPath())) {
      const ext = path.extname(filename);
      const stem = path.basename(filename, ext);
      outName = `${stem}_${Date.now()}${ext}`;
    }
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(outPath(), buf);

    markReady(ownerKey, outName);
    return outName;
  } catch {
    // If anything goes wrong, do not break polling.
    return null;
  }
}

function newestPromptIdForDevice(deviceId: string): string | null {
  try {
    const dir = path.join(JOBS_DIR, deviceId);
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!files.length) return null;
    const raw = fs.readFileSync(files[0].p, "utf-8");
    const j = JSON.parse(raw);
    const pid = String(j?.prompt_id || "").trim();
    return pid || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  let deviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
  let ownerKey = "";
  let username: string | null = null;
  let scope: "user" | "device" = "device";

  try {
    const ctx = await getOwnerContext(req);
    deviceId = safeDeviceId(ctx.deviceId);
    ownerKey = ctx.ownerKey;
    username = ctx.username;
    scope = ctx.scope;
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    // If auth is unavailable for some reason, fall back to device-only progress.
  }

  try {
    // 1) Queue state (global, but still useful as fallback)
    const r = await fetch(`${COMFY_BASE_URL}/queue`, { cache: "no-store" });
    const qj = await r.json().catch(() => ({}));

    const runningCount =
      Array.isArray((qj as any)?.queue_running) ? (qj as any).queue_running.length :
      Array.isArray((qj as any)?.running) ? (qj as any).running.length :
      0;

    const pendingCount =
      Array.isArray((qj as any)?.queue_pending) ? (qj as any).queue_pending.length :
      Array.isArray((qj as any)?.pending) ? (qj as any).pending.length :
      0;

    const queue_remaining = runningCount + pendingCount;

    // 2) Device-scoped: determine the newest prompt_id we submitted for this device
    let prompt_id: string | null = deviceId ? newestPromptIdForDevice(deviceId) : null;

    // 3) Check ComfyUI history for that prompt to know TRUE completion
    let prompt_complete = false;
    let prompt_error: string | null = null;
    if (prompt_id) {
      try {
        const hr = await fetch(`${COMFY_BASE_URL}/history/${encodeURIComponent(prompt_id)}`, { cache: "no-store" });
        const hj = await hr.json().catch(() => ({}));
        // history/<prompt_id> returns an object keyed by prompt_id
        const entry = (hj as any)?.[prompt_id];
        const outputs = entry?.outputs;
        if (outputs && typeof outputs === "object" && Object.keys(outputs).length > 0) {
          prompt_complete = true;
        }
        if (entry?.status?.status_str && String(entry.status.status_str).toLowerCase().includes("error")) {
          prompt_error = String(entry?.status?.status_str);
        }
      } catch {
        // ignore
      }
    }

    const status = prompt_error ? "error" : (prompt_complete ? "complete" : (queue_remaining === 0 ? "idle" : "running"));

    // Auto-complete: when a prompt completes and OTG state is "running", fetch the latest output from ComfyUI
    // and save it into the OTG gallery dir so Preview can show it.
    if (ownerKey) {
      const st = readState(ownerKey);
      if (prompt_error) {
        // If upstream errored, clear the lock so the UI is usable again.
        if (st.status === "running") resetState(ownerKey);
      } else if (prompt_complete && st.status === "running") {
        const baseDir = username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
        await fetchAndStoreLatestOutput({ promptId: prompt_id!, ownerKey, baseDir });
      }
    }

    return Response.json({
      status,
      running: status === "running",
      queue: queue_remaining,
      queue_remaining,
      running_count: runningCount,
      pending_count: pendingCount,
      prompt_id,
      prompt_complete,
      prompt_error,
      // pct/nodeName not available via REST; frontend uses /api/comfy-events for true progress.
      pct: status === "complete" ? 100 : 0,
      nodeName: null,
      doneNodes: 0,
      totalNodes: 0,
    });
  } catch {
    return Response.json({ status: "idle", running: false, queue: 0, queue_remaining: 0, pct: 0, nodeName: null, doneNodes: 0, totalNodes: 0 });
  }
}
