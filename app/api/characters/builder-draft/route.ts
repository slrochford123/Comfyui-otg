import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DATA_ROOT = process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data");
const DRAFTS_ROOT = path.join(DATA_ROOT, "character-builder-drafts");
const BLOCKED_GLOBAL_OWNER = "web_characters_builder";

function cleanOwnerKey(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 80);
}

function readOwnerKey(req: NextRequest): string {
  const url = new URL(req.url);

  const fromQuery = cleanOwnerKey(
    url.searchParams.get("ownerId") ||
    url.searchParams.get("owner") ||
    "",
  );

  if (fromQuery) return fromQuery;

  const fromHeader = cleanOwnerKey(req.headers.get("x-otg-device-id") || "");
  if (fromHeader) return fromHeader;

  return "";
}

function isBlockedOwner(ownerKey: string): boolean {
  const cleaned = cleanOwnerKey(ownerKey);
  return cleaned === BLOCKED_GLOBAL_OWNER || cleaned === "profile_unresolved";
}

function ensureDraftsRoot() {
  fs.mkdirSync(DRAFTS_ROOT, { recursive: true });
}

function draftPathFor(ownerKey: string): string {
  const safeOwner = cleanOwnerKey(ownerKey);
  if (!safeOwner) throw new Error("Missing character draft owner.");
  if (isBlockedOwner(safeOwner)) throw new Error("Global/unresolved character builder draft owner is disabled.");
  return path.join(DRAFTS_ROOT, `${safeOwner}.json`);
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
  ensureDraftsRoot();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function deleteIfExists(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch {
    // Best effort.
  }
}

export async function GET(req: NextRequest) {
  try {
    const ownerKey = readOwnerKey(req);

    // OTG_PROFILE_ISOLATION_BLOCK_GLOBAL_BUILDER_DRAFT:
    // Never restore the legacy shared builder draft into any real profile.
    if (!ownerKey || isBlockedOwner(ownerKey)) {
      return NextResponse.json(
        { ok: true, draft: null, blockedOwner: ownerKey || "" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const filePath = draftPathFor(ownerKey);
    const draft = readJsonSafe(filePath);

    return NextResponse.json(
      { ok: true, ownerKey, draft },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ownerKey = readOwnerKey(req);

    // Hard reject the old shared owner so stale open tabs cannot recreate
    // data/character-builder-drafts/web_characters_builder.json.
    if (!ownerKey || isBlockedOwner(ownerKey)) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          ownerKey: ownerKey || "",
          error: "Global/unresolved character builder draft owner is disabled. Switch to a real profile owner.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const now = new Date().toISOString();

    const draft = {
      ownerKey,
      mode: String(body?.mode || "new_character"),
      characterId: String(body?.characterId || ""),
      currentStage: String(body?.currentStage || ""),
      state: body?.state && typeof body.state === "object" ? body.state : {},
      updatedAt: now,
    };

    const filePath = draftPathFor(ownerKey);
    writeJsonAtomic(filePath, draft);

    return NextResponse.json(
      { ok: true, ownerKey, draft },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function DELETE(req: NextRequest) {
  try {
    const ownerKey = readOwnerKey(req);

    if (!ownerKey || isBlockedOwner(ownerKey)) {
      const legacyPath = path.join(DRAFTS_ROOT, `${BLOCKED_GLOBAL_OWNER}.json`);
      deleteIfExists(legacyPath);

      return NextResponse.json(
        { ok: true, ownerKey: ownerKey || "", deleted: false, blockedOwner: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const filePath = draftPathFor(ownerKey);
    const existed = fs.existsSync(filePath);
    deleteIfExists(filePath);

    return NextResponse.json(
      { ok: true, ownerKey, deleted: existed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}