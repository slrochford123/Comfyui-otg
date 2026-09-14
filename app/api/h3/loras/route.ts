import { NextResponse } from "next/server";

import { publicH3LoraCatalog, readH3LoraCatalog, synchronizeH3LoraCatalog } from "@/lib/h3LoraCatalogServer";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";

export const dynamic = "force-dynamic";

const MODES: ProductionV2H3Mode[] = ["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"];

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("mode") as ProductionV2H3Mode | null;
  const mode = requested && MODES.includes(requested) ? requested : undefined;
  if (!readH3LoraCatalog().updatedAt) {
    await synchronizeH3LoraCatalog().catch(() => undefined);
  }
  return NextResponse.json({ ok: true, ...publicH3LoraCatalog(mode) }, { headers: { "Cache-Control": "no-store" } });
}
