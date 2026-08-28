import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function safeDeviceId(raw: string | null) {
  const v = String(raw || "local").trim();
  return v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) || "local";
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function appendJsonl(deviceId: string, row: Record<string, unknown>) {
  ensureDir(JOBS_DIR);
  const file = path.join(JOBS_DIR, `${deviceId}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

function writeLegacyRecord(deviceId: string, row: Record<string, unknown>) {
  const dir = path.join(JOBS_DIR, deviceId);
  ensureDir(dir);
  const promptId = String(row.prompt_id || row.promptId || "job").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) || "job";
  const filename = `${Date.now()}-${promptId}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(row, null, 2), "utf-8");
}

export async function POST(req: NextRequest) {
  const headerDeviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
  const body = await req.json().catch(() => ({}));

  const deviceId = safeDeviceId((body as any).deviceId || headerDeviceId);
  const promptId = String((body as any).promptId || (body as any).prompt_id || "").trim();

  if (!promptId) {
    return Response.json({ ok: false, error: "Missing promptId" }, { status: 400 });
  }

  const row = {
    prompt_id: promptId,
    promptId,
    ts: Date.now(),
    deviceId,
  };

  appendJsonl(deviceId, row);
  writeLegacyRecord(deviceId, row);

  return Response.json({ ok: true, deviceId, promptId });
}
