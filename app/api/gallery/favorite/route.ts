import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, resolveGalleryItemByName, writeMetaForFile } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req);
    const { sources } = await getGallerySourcesForRequest(req);

    const name = String(body?.name ?? body?.fileName ?? "").trim();
    const scopeHint = String(body?.scope ?? body?.source ?? "").trim() || null;
    const favorite =
      typeof body?.favorite === "boolean" ? body.favorite : undefined;

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Missing name", received: body },
        { status: 400 }
      );
    }

    const item = resolveGalleryItemByName({
      sources,
      name,
      scopeHint,
    });

    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Item not found", name, scopeHint },
        { status: 404 }
      );
    }

    const nextFavorite =
      typeof favorite === "boolean" ? favorite : !Boolean(item.meta?.favorite);

    const nextMeta = writeMetaForFile(item.path, {
      ...item.meta,
      favorite: nextFavorite,
      originalName: item.meta?.originalName || item.sourceName || item.name,
      renamedName: item.meta?.renamedName || item.name,
    });

    return NextResponse.json({
      ok: true,
      favorite: Boolean(nextMeta?.favorite),
      name: item.name,
      scope: item.scope,
      meta: nextMeta,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { ok: false, error: error?.message || "Favorite toggle failed" },
      { status: 500 }
    );
  }
}
