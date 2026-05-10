import { NextRequest, NextResponse } from "next/server";
import { ensureGalleryMetaForFile, getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { sources } = await getGallerySourcesForRequest(req);
    const name = String(req.nextUrl.searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });

    const item = resolveGalleryItemByName({ sources, name, scopeHint: req.nextUrl.searchParams.get("scope") });
    if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    ensureGalleryMetaForFile(item.path, { favorite: true });
    return NextResponse.json({ ok: true, name: item.name, scope: item.scope });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Favorite failed" }, { status: 500 });
  }
}