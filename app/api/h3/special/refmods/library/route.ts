import fs from "node:fs";

import { NextResponse } from "next/server";

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

export async function GET() {
  try {
    const baseUrl = DEFAULT_REFMOD_LIBRARY_URL.replace(/\/+$/, "");
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
          if (normalized.file && fs.existsSync(normalized.file)) {
            const stat = fs.statSync(normalized.file);
            normalized.sizeBytes = stat.size;
            normalized.createdAt = stat.birthtime.toISOString();
            normalized.modifiedAt = stat.mtime.toISOString();
          }
          const sidecar = readH3RefModSidecar(normalized.name);
          if (sidecar) {
            normalized.sourceType = "otg-created";
            normalized.characterId = sidecar.characterId || null;
            normalized.createdAt ||= sidecar.createdAt;
            normalized.modifiedAt ||= sidecar.updatedAt;
          }
          return normalized;
        })
      : [];
    return noStore({ ok: true, backend: baseUrl, entries });
  } catch (error) {
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read the RefMod library.",
      entries: [],
    }, { status: 502 });
  }
}
