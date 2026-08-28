import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data");
const DRAFTS_ROOT = path.join(DATA_ROOT, "character-builder-drafts");

function cleanOwnerKey(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 128);
}

async function authenticatedOwner(req: NextRequest): Promise<string> {
  const session = await requireSessionUser(req);
  const ownerKey = cleanOwnerKey(session.ownerKey);
  if (session.scope !== "user" || !session.username || !ownerKey) {
    throw new SessionInvalidError("An authenticated Character account is required.");
  }
  return ownerKey;
}

function draftPathFor(ownerKey: string): string {
  return path.join(DRAFTS_ROOT, `${ownerKey}.json`);
}

function readJsonSafe(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(DRAFTS_ROOT, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, 401);
  return noStore({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
}

export async function GET(req: NextRequest) {
  try {
    const ownerKey = await authenticatedOwner(req);
    return noStore({ ok: true, ownerKey, draft: readJsonSafe(draftPathFor(ownerKey)) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ownerKey = await authenticatedOwner(req);
    const body = await req.json().catch(() => ({}));
    const draft = {
      ownerKey,
      mode: String(body?.mode || "new_character"),
      characterId: String(body?.characterId || ""),
      currentStage: String(body?.currentStage || ""),
      state: body?.state && typeof body.state === "object" ? body.state : {},
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(draftPathFor(ownerKey), draft);
    return noStore({ ok: true, ownerKey, draft });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function DELETE(req: NextRequest) {
  try {
    const ownerKey = await authenticatedOwner(req);
    const filePath = draftPathFor(ownerKey);
    const existed = fs.existsSync(filePath);
    if (existed) fs.rmSync(filePath, { force: true });
    return noStore({ ok: true, ownerKey, deleted: existed });
  } catch (error) {
    return failure(error);
  }
}
