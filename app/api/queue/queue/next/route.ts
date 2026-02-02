import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
function sanitizeComfyPromptGraph(graph: any) {
  const out: Record<string, any> = {};
  if (!graph || typeof graph !== "object") return out;

  for (const [id, node] of Object.entries(graph)) {
    if (!/^\d+$/.test(id)) continue;      // drop _otg_meta and non-node keys
    if (!node || typeof node !== "object") continue;
    if (!("class_type" in node)) continue;
    out[id] = node;
  }
  return out;
}

export const runtime = "nodejs";

const COMFY_BASE_URL =
  (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "";
}

function makeFallbackDeviceId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function getDeviceIdFromReq(req: NextRequest) {
  const fromHeader = safeDeviceId(req.headers.get("x-otg-device-id"));
  if (fromHeader) return fromHeader;

  const fromCookie = safeDeviceId(req.cookies.get("otg_device_id")?.value || null);
  if (fromCookie) return fromCookie;

  return makeFallbackDeviceId();
}


function readJsonlObjects(filePath: string): any[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: any[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

function appendJobLine(deviceId: string, obj: any) {
  try {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
    const jobPath = path.join(JOBS_DIR, `${deviceId}.jsonl`);
    fs.appendFileSync(jobPath, JSON.stringify(obj) + "\n", "utf-8");
  } catch {}
}

function getLatestStates(items: any[]) {
  const latestByJob = new Map<string, any>();
  for (const it of items) {
    const jid = String(it?.job_id || it?.jobId || "").trim();
    if (!jid) continue;
    const prev = latestByJob.get(jid);
    const ts = Number(it?.ts || 0) || 0;
    const prevTs = Number(prev?.ts || 0) || 0;
    if (!prev || ts >= prevTs) latestByJob.set(jid, it);
  }
  return latestByJob;
}

export async function POST(req: NextRequest) {
  const deviceId = getDeviceIdFromReq(req);

const jobPath = path.join(JOBS_DIR, `${deviceId}.jsonl`);
  const items = readJsonlObjects(jobPath);
  const latestByJob = getLatestStates(items);

  // If anything is currently running, do nothing (sequential queue).
  for (const v of latestByJob.values()) {
    if (v?.state === "running") return NextResponse.json({ ok: true, started: false, reason: "running" });}

  // Find oldest queued job by ts
  const queued = Array.from(latestByJob.values())
    .filter((v) => v?.state === "queued" && v?.promptGraph)
    .sort((a, b) => (Number(a.ts || 0) || 0) - (Number(b.ts || 0) || 0))[0];

  if (!queued) return NextResponse.json({ ok: true, started: false, reason: "empty" });

  const jobId = String(queued.job_id || queued.jobId);
  const ownerKey = String(queued.ownerKey || "");
  const graph = queued.promptGraph;

  const upstream = await fetch(`${COMFY_BASE_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: sanitizeComfyPromptGraph(graph), client_id: deviceId  }),
  });

  const text = await upstream.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

  if (!upstream.ok) {
    appendJobLine(deviceId, { ts: Date.now(), job_id: jobId, state: "error", ownerKey, deviceId, error: parsed });
    return NextResponse.json({ ok: false, jobId, error: "ComfyUI submit failed", upstreamStatus: upstream.status, response: parsed }, { status: 502 });
  }

  const prompt_id = String(parsed?.prompt_id || "").trim() || null;
  appendJobLine(deviceId, { ts: Date.now(), job_id: jobId, state: "running", ownerKey, deviceId, prompt_id });

  return NextResponse.json({ ok: true, started: true, jobId, prompt_id, response: parsed });
}
