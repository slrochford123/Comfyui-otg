import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, listGalleryItemsFromSources } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { owner, sources } = await getGallerySourcesForRequest(req);
    const result = listGalleryItemsFromSources(sources, { sort: "favorited", per: 5000 });
    const items = result.items.filter((x) => !!x.meta.favorite);

    const files = items.map((x) => {
      const fileName = path.basename(x.path);
      const cacheBust = encodeURIComponent(String(x.updatedAt || x.createdAt || 0));

      return {
        name: x.name,
        fileName,
        sourceName: x.meta.originalName || fileName,
        url: `${x.url}${x.url.includes("?") ? "&" : "?"}v=${cacheBust}`,
        ts: x.createdAt,
        createdAt: x.createdAt,
        updatedAt: x.updatedAt,
        video: x.kind === "video",
        kind: x.kind,
        source: x.scope,
        favorite: true,
        meta: x.meta,
      };
    });

    return NextResponse.json({
      ok: true,
      scope: owner.scope,
      ownerKey: owner.ownerKey,
      username: owner.username,
      deviceId: owner.deviceId,
      items: files,
      files,
    });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Failed to list favorites" }, { status: 500 });
  }
}