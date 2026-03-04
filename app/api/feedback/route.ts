import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

function getDataRoot() {
  return (process.env.OTG_DATA_DIR && process.env.OTG_DATA_DIR.trim()) || path.join(process.cwd(), "data");
}

function sanitizeEmail(email: any): string {
  if (!email || typeof email !== "string") return "";
  const e = email.trim();
  if (!e) return "";
  // Keep it lightweight; we only store it if user provides it.
  if (e.length > 320) return e.slice(0, 320);
  return e;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return NextResponse.json({ error: "Request must be JSON" }, { status: 415 });
    }

    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const email = sanitizeEmail(body?.email);
    const page = typeof body?.page === "string" ? body.page.trim() : "";

    if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });
    if (message.length > 8000) return NextResponse.json({ error: "Message too long" }, { status: 413 });

    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");

    const dataRoot = getDataRoot();
    const dir = path.join(dataRoot, "feedback");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `feedback-${y}-${m}.jsonl`);

    // Best-effort: include device id if provided via header
    const deviceId = req.headers.get("x-otg-device-id") || req.headers.get("x-otg-device") || req.headers.get("x-device-id") || "";

    const record = {
      createdAt: now.toISOString(),
      category: category || "Question",
      email: email || undefined,
      page: page || undefined,
      deviceId: deviceId || undefined,
      message,
    };

    await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
