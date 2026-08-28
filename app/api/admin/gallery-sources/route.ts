import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { isAdminGallerySourceId, listAdminGallery } from "@/lib/adminGallerySources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });

  const requestedSource = request.nextUrl.searchParams.get("source") || "all";
  if (requestedSource !== "all" && !isAdminGallerySourceId(requestedSource)) {
    return NextResponse.json({ ok: false, error: "Unknown admin gallery source." }, { status: 400 });
  }

  try {
    const result = await listAdminGallery({
      source: requestedSource,
      offset: Number(request.nextUrl.searchParams.get("offset") || 0),
      limit: Number(request.nextUrl.searchParams.get("limit") || 48),
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list Admin Full Gallery.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
