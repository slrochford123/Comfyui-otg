import fs from "node:fs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { parseH3TargetBackend } from "@/lib/h3GpuRouting";
import { H3_BACKEND_PROFILES } from "@/lib/production/h3Workflows";

import { normalizeH3RefModLibraryEntry } from "@/lib/h3SpecialModes/refMods";
import { readH3RefModSidecar } from "@/lib/h3SpecialModes/refModCreation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REFMOD_LIBRARY_URL =
  process.env.OTG_H3_REFMODS_COMFY_URL
  || process.env.OTG_H3_BODY_SWAP_3090_COMFY_URL
  || "http://100.75.162.64:8189";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    try { await requireSessionUser(request); } catch { return noStore({ ok: false, error: "Sign in to read your RefMod library.", entries: [] }, { status: 401 }); }
    let target;
    try { target = parseH3TargetBackend(request.nextUrl.searchParams.get("backend") ?? undefined); }
    catch { return noStore({ ok: false, error: "Choose RTX 3090 or RTX 5060 Ti.", entries: [] }, { status: 400 }); }
    const baseUrl = (target ? H3_BACKEND_PROFILES[target].baseUrl : DEFAULT_REFMOD_LIBRARY_URL).replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/refmods/library`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`RefMod library returned HTTP ${response.status}.`);
    }
    const raw = await response.json().catch(() => null);
    const entries = Array.isArray(raw)
      ? raw.map((entry) => {
          const normalized = normalizeH3RefModLibraryEntry(entry);
          if (target !== "rtx5060ti" && normalized.file && fs.existsSync(normalized.file)) {
            const stat = fs.statSync(normalized.file);
            normalized.sizeBytes = stat.size;
            normalized.createdAt = stat.birthtime.toISOString();
            normalized.modifiedAt = stat.mtime.toISOString();
          }
          const sidecar = target === "rtx5060ti" ? null : readH3RefModSidecar(normalized.name);
          if (sidecar) {
            normalized.sourceType = "otg-created";
            normalized.characterId = sidecar.characterId || null;
            normalized.motionType = sidecar.motionType || null;
            normalized.isolationEnabled = sidecar.isolationEnabled === true;
            normalized.alphaGenerator = sidecar.alphaGenerator || null;
            normalized.sourceClipPath = sidecar.sourceClipPath || null;
            normalized.isolatedDerivativePath = sidecar.isolatedDerivativePath || null;
            normalized.alphaMattePath = sidecar.alphaMattePath || null;
            normalized.previewPath = sidecar.isolatedDerivativePath || sidecar.sourceClipPath || sidecar.sourceAssets?.[0]?.path || null;
            normalized.createdAt ||= sidecar.createdAt;
            normalized.modifiedAt ||= sidecar.updatedAt;
          }
          return normalized;
        })
      : [];
    return noStore({ ok: true, backend: target || baseUrl, entries });
  } catch (error) {
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read the RefMod library.",
      entries: [],
    }, { status: 502 });
  }
}
