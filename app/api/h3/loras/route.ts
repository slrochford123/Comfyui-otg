import { NextResponse } from "next/server";

import {
  publicH3LoraCatalog,
  readH3LoraCatalog,
  synchronizeH3LoraCatalog,
  type H3LoraRequestMode,
} from "@/lib/h3LoraCatalogServer";

export const dynamic = "force-dynamic";

const MODES: H3LoraRequestMode[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
  "h3-realism",
  "h3-body-swap",
  "h3-refmods",
];

export async function GET(request: Request) {
  const requested =
    new URL(request.url).searchParams.get("mode") as H3LoraRequestMode | null;

  const mode =
    requested && MODES.includes(requested)
      ? requested
      : undefined;

  if (!readH3LoraCatalog().updatedAt) {
    await synchronizeH3LoraCatalog().catch(() => undefined);
  }

  return NextResponse.json(
    { ok: true, ...publicH3LoraCatalog(mode) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
