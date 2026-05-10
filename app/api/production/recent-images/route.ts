import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, listGalleryItemsFromSources } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampLimit(value: string | null) {
  const n = Number(value || "36") || 36;
  return Math.max(1, Math.min(100, n));
}

export async function GET(req: NextRequest) {
  try {
    const limit = clampLimit(req.nextUrl.searchParams.get("limit"));
    const { sources } = await getGallerySourcesForRequest(req);
    const result = listGalleryItemsFromSources(sources, {
      filter: "images" as any,
      sort: "newest" as any,
      search: "",
      page: 1,
      per: limit,
    });

    const items = result.items.map((item) => ({
      name: item.name,
      imagePath: item.path,
      imageUrl: `/api/file?path=${encodeURIComponent(item.path)}`,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}