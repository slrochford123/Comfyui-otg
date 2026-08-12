import fs from "node:fs";
import fsp from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, metaPathForFile, resolveGalleryItemByName } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function readJsonBody(req: NextRequest): Promise<Record<string, any>> {
  try {
    const raw = await req.text();
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function deleteFileIfExists(
  absPath: string,
  deleted: string[],
  failed: Array<{ path: string; error: string }>,
) {
  try {
    if (!fs.existsSync(absPath)) return;
    await fsp.rm(absPath, { force: true });
    deleted.push(absPath);
  } catch (error: any) {
    failed.push({ path: absPath, error: error?.message || "Delete failed" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req);
    const { sources } = await getGallerySourcesForRequest(req);

    const url = new URL(req.url);
    const name = String(body?.name ?? body?.fileName ?? url.searchParams.get("name") ?? "").trim();
    const scopeHint = String(body?.scope ?? body?.source ?? url.searchParams.get("scope") ?? "").trim() || null;

    if (!name) {
      return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    }

    const item = resolveGalleryItemByName({
      sources,
      name,
      scopeHint,
    });

    if (!item) {
      return NextResponse.json({ ok: false, error: "Item not found", name, scopeHint }, { status: 404 });
    }

    const requestedDeleteOriginals = Boolean(
      body?.deleteOriginals ?? body?.deleteSource ?? body?.purgeOriginal ?? body?.purgeOriginals ?? false,
    );

    const galleryDeleted: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    await deleteFileIfExists(item.path, galleryDeleted, failed);
    await deleteFileIfExists(metaPathForFile(item.path), galleryDeleted, failed);

    const ok = galleryDeleted.length > 0 && failed.length === 0;

    return NextResponse.json({
      ok,
      deleted: ok,
      name,
      scope: item.scope,
      galleryDeleted,
      comfyDeleted: [],
      failed,
      deleteMode: "gallery-only",
      upstreamDeletionAttempted: false,
      upstreamDeletionBlocked: requestedDeleteOriginals,
      warning: requestedDeleteOriginals
        ? "Upstream output deletion is disabled. Gallery delete now removes only the OTG gallery copy."
        : null,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { ok: false, error: error?.message || "Delete failed" },
      { status: 500 },
    );
  }
}
