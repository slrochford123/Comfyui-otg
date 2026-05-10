import { NextRequest, NextResponse } from "next/server";
import { ensureGalleryMetaForFile, getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string; scope?: string };
    const name = String(body.name || req.nextUrl.searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Missing filename" }, { status: 400 });

    const { sources } = await getGallerySourcesForRequest(req);
    const item = resolveGalleryItemByName({ sources, name, scopeHint: body.scope || req.nextUrl.searchParams.get("scope") });
    if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    ensureGalleryMetaForFile(item.path, { favorite: false });
    return NextResponse.json({ ok: true, name: item.name, scope: item.scope });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Unfavorite failed" }, { status: 500 });
  }
}