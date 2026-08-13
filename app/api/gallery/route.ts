import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, listGalleryItemsFromSources, type ListGalleryOptions } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeText(input: string | null) {
  return String(input || "").trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  try {
    const sourceStartedAt = performance.now();
    const { owner, sources } = await getGallerySourcesForRequest(req);
    const sourceMs = performance.now() - sourceStartedAt;
    const media = safeText(req.nextUrl.searchParams.get("media") || req.nextUrl.searchParams.get("filter")) || "all";
    const sort = safeText(req.nextUrl.searchParams.get("sort")) || "newest";
    const search = String(req.nextUrl.searchParams.get("search") || "").trim();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") || "1") || 1);
    const per = Math.max(1, Math.min(5000, Number(req.nextUrl.searchParams.get("per") || "5000") || 5000));

    const listStartedAt = performance.now();
    const result = listGalleryItemsFromSources(sources, {
      filter: media as ListGalleryOptions["filter"],
      sort: sort as ListGalleryOptions["sort"],
      search,
      page,
      per,
    });
    const listMs = performance.now() - listStartedAt;

    const mapStartedAt = performance.now();
    const pageItems = result.items.map((item) => {
      const fileName = path.basename(item.path);
      const cacheBust = encodeURIComponent(String(item.updatedAt || item.createdAt || 0));

      return {
        name: item.name,
        fileName,
        sourceName: item.meta.originalName || fileName,
        url: `${item.url}${item.url.includes("?") ? "&" : "?"}v=${cacheBust}`,
        ts: item.createdAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        video: item.kind === "video",
        kind: item.kind,
        source: item.scope,
        meta: item.meta,
      };
    });
    const mapMs = performance.now() - mapStartedAt;

    const response = NextResponse.json({
      ok: true,
      items: pageItems,
      files: pageItems,
      total: result.total,
      page,
      per,
      totalPages: result.totalPages,
      sources: {
        user: owner.username || null,
        device: owner.deviceId,
      },
    });
    response.headers.set(
      "Server-Timing",
      `owner;dur=${sourceMs.toFixed(1)}, list;dur=${listMs.toFixed(1)}, map;dur=${mapMs.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`
    );
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-OTG-Gallery-Items", String(pageItems.length));
    response.headers.set("X-OTG-Gallery-Total", String(result.total));
    return response;
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
