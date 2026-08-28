import { NextRequest, NextResponse } from "next/server";
import {
  ensureGalleryMetaForFile,
  getGallerySourcesForRequest,
  readMetaForFile,
  resolveGalleryItemByName,
} from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { sources } = await getGallerySourcesForRequest(req);
    const name = String(req.nextUrl.searchParams.get("name") || "").trim();
    const scopeHint = req.nextUrl.searchParams.get("scope");
    const ensure = req.nextUrl.searchParams.get("ensure") !== "0";

    if (!name) {
      return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    }

    const item = resolveGalleryItemByName({ sources, name, scopeHint });
    if (!item) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const meta = ensure ? ensureGalleryMetaForFile(item.path, {}, sources.find((source) => source.scope === item.scope) || null) : readMetaForFile(item.path);
    return NextResponse.json({ ok: true, name: item.name, sourceName: item.meta.renamedName || item.name, scope: item.scope, meta });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Failed to read metadata" }, { status: 500 });
  }
}
