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
  const backend = new URL(request.url).searchParams.get("backend");
  if (backend && backend !== "rtx3090" && backend !== "rtx5060ti") {
    return NextResponse.json({ ok: false, error: "Choose RTX 3090 or RTX 5060 Ti." }, { status: 400 });
  }
  const requested =
    new URL(request.url).searchParams.get("mode") as H3LoraRequestMode | null;

  const mode =
    requested && MODES.includes(requested)
      ? requested
      : undefined;

  const current = readH3LoraCatalog();
  const age = Date.now() - Date.parse(current.updatedAt);
  if (!current.updatedAt || (backend && (!Number.isFinite(age) || age > 60_000))) {
    await synchronizeH3LoraCatalog().catch(() => undefined);
  }

  return NextResponse.json(
    { ok: true, ...publicH3LoraCatalog(mode, backend === "rtx3090" || backend === "rtx5060ti" ? backend : undefined) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
