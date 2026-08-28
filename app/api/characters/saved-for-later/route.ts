import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data");
const ROOT = path.join(DATA_ROOT, "characters", "saved-for-later");

type SavedCharacterRecord = {
  id: string;
  ownerKey: string;
  filename: string;
  contentType: string;
  createdAt: string;
  promptId: string;
  seed: number;
  backend: string;
  modelLabel: string;
  styleLabel: string;
  mode: "standard" | "freeform";
  description: string;
};

function safeOwnerKey(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 128);
}

async function authenticatedOwner(request: NextRequest) {
  const session = await requireSessionUser(request);
  const ownerKey = safeOwnerKey(session.ownerKey);
  if (session.scope !== "user" || !session.username || !ownerKey) {
    throw new SessionInvalidError("An authenticated Character account is required.");
  }
  return ownerKey;
}

function ownerDir(ownerKey: string) {
  return path.join(ROOT, ownerKey);
}

function recordPath(dir: string, id: string) {
  return path.join(dir, `${id}.json`);
}

function safeRecordId(value: unknown) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
}

function extensionFor(type: string) {
  if (String(type).toLowerCase() === "image/jpeg") return ".jpg";
  if (String(type).toLowerCase() === "image/webp") return ".webp";
  return ".png";
}

function imageUrl(id: string) {
  return `/api/characters/saved-for-later?id=${encodeURIComponent(id)}&image=1`;
}

function readRecord(dir: string, id: string): SavedCharacterRecord | null {
  const safeId = safeRecordId(id);
  if (!safeId) return null;
  const target = recordPath(dir, safeId);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as SavedCharacterRecord;
  } catch {
    return null;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  if (error instanceof SessionInvalidError) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
}

export async function GET(request: NextRequest) {
  try {
    const ownerKey = await authenticatedOwner(request);
    const dir = ownerDir(ownerKey);
    const id = safeRecordId(request.nextUrl.searchParams.get("id"));
    if (id && request.nextUrl.searchParams.get("image") === "1") {
      const record = readRecord(dir, id);
      if (!record || (record.ownerKey && record.ownerKey !== ownerKey)) {
        return jsonResponse({ ok: false, error: "Saved Character image not found." }, 404);
      }
      const file = path.join(dir, path.basename(record.filename));
      if (!fs.existsSync(file)) return jsonResponse({ ok: false, error: "Saved Character image file is missing." }, 404);
      return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
        headers: { "Content-Type": record.contentType || "image/png", "Cache-Control": "private, no-store" },
      });
    }

    if (!fs.existsSync(dir)) return jsonResponse({ ok: true, items: [] });
    const items = fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as SavedCharacterRecord;
          if (record.ownerKey && record.ownerKey !== ownerKey) return null;
          return { ...record, ownerKey: undefined, imageUrl: imageUrl(record.id) };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return jsonResponse({ ok: true, items });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ownerKey = await authenticatedOwner(request);
    const dir = ownerDir(ownerKey);
    fs.mkdirSync(dir, { recursive: true });
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) return jsonResponse({ ok: false, error: "Saved Character image is required." }, 400);
    const contentType = image.type || "image/png";
    if (!contentType.toLowerCase().startsWith("image/")) return jsonResponse({ ok: false, error: "Saved Character file must be an image." }, 400);

    const id = `${Date.now()}-${randomUUID()}`;
    const filename = `${id}${extensionFor(contentType)}`;
    const imageTmp = path.join(dir, `${filename}.tmp-${process.pid}`);
    fs.writeFileSync(imageTmp, new Uint8Array(await image.arrayBuffer()));
    fs.renameSync(imageTmp, path.join(dir, filename));
    const record: SavedCharacterRecord = {
      id,
      ownerKey,
      filename,
      contentType,
      createdAt: new Date().toISOString(),
      promptId: String(form.get("promptId") || ""),
      seed: Number(form.get("seed") || 0),
      backend: String(form.get("backend") || ""),
      modelLabel: String(form.get("modelLabel") || ""),
      styleLabel: String(form.get("styleLabel") || ""),
      mode: String(form.get("mode") || "") === "freeform" ? "freeform" : "standard",
      description: String(form.get("description") || ""),
    };
    const target = recordPath(dir, id);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
    fs.renameSync(tmp, target);
    return jsonResponse({ ok: true, item: { ...record, ownerKey: undefined, imageUrl: imageUrl(id) } });
  } catch (error) {
    return failure(error);
  }
}
