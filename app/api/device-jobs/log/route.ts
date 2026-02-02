import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function safeDeviceId(raw: string | null) {
  const v = (raw || "local").toString();
  return v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) || "local";
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export async function POST(req: NextRequest) {
  const headerDeviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
  const body = await req.json().catch(() => ({}));

  const deviceId = safeDeviceId(body.deviceId || headerDeviceId);
  const promptId = body.promptId ? String(body.promptId) : "";

  if (!promptId) return Response.json({ ok: false, error: "Missing promptId" }, { status: 400 });

  ensureDir(JOBS_DIR);
  const file = path.join(JOBS_DIR, `${deviceId}.jsonl`);
  fs.appendFileSync(file, JSON.stringify({ promptId, at: Date.now() }) + "\n", "utf-8");

  return Response.json({ ok: true, deviceId, promptId });
}
