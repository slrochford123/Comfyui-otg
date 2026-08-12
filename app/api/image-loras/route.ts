import { NextResponse } from "next/server";

import { publicImageLoraCatalog } from "@/lib/imageLoraCatalogServer";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, ...publicImageLoraCatalog() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
