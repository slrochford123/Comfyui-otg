import fs from "node:fs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import { assertProductionV2OwnedFile, resolveProductionV2Version } from "@/lib/production/postProduction";
import { productionV2Store } from "@/lib/production/v2Store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(req: NextRequest, method: "GET" | "HEAD") {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const productionId = String(req.nextUrl.searchParams.get("productionId") || "").trim();
    const production = productionId ? productionV2Store.load(ownerKey, productionId) : null;
    if (!production) return NextResponse.json({ ok: false, error: "Production media not found." }, { status: 404 });
    let mediaPath = "";
    if (req.nextUrl.searchParams.get("final") === "1") {
      mediaPath = production.assembly.finalMedia?.path || "";
    } else if (req.nextUrl.searchParams.get("musicTrackId")) {
      const trackId = String(req.nextUrl.searchParams.get("musicTrackId") || "").trim();
      mediaPath = production.assembly.musicTracks.find((track) => track.id === trackId)?.mediaPath || "";
    } else if (req.nextUrl.searchParams.get("sfxTrackId")) {
      const trackId = String(req.nextUrl.searchParams.get("sfxTrackId") || "").trim();
      mediaPath = production.assembly.sfxTracks.find((track) => track.id === trackId)?.mediaPath || "";
    } else {
      const sceneId = String(req.nextUrl.searchParams.get("sceneId") || "").trim();
      const versionId = String(req.nextUrl.searchParams.get("versionId") || "").trim();
      mediaPath = resolveProductionV2Version(production, sceneId, versionId).version.mediaPath;
    }
    const resolved = assertProductionV2OwnedFile(ownerKey, productionId, mediaPath);
    if (!fs.existsSync(resolved)) return NextResponse.json({ ok: false, error: "Production media not found." }, { status: 404 });
    return mediaFileResponse(req, resolved, { method, cacheControl: "private, no-transform, max-age=3600" });
  } catch (error) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not serve Production media." }, { status: 404 });
  }
}

export function GET(req: NextRequest) {
  return serve(req, "GET");
}

export function HEAD(req: NextRequest) {
  return serve(req, "HEAD");
}
