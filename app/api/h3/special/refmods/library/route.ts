import fs from "node:fs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { parseH3TargetBackend } from "@/lib/h3GpuRouting";
import { H3_BACKEND_PROFILES } from "@/lib/production/h3Workflows";

import { normalizeH3RefModLibraryEntry } from "@/lib/h3SpecialModes/refMods";
import { readH3RefModSidecar } from "@/lib/h3SpecialModes/refModCreation";
import {canUseCharacterRefMod} from "@/lib/h3SpecialModes/characterRefCardAccess";
import {CHARACTER_REF_PREFIX} from "@/lib/h3SpecialModes/characterRefCardContract";
import {characterRefCardsEnabled} from "@/lib/h3SpecialModes/characterRefCardAvailability";

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
    let owner;
    try { owner=await requireSessionUser(request); } catch { return noStore({ ok: false, error: "Sign in to read your RefMod library.", entries: [] }, { status: 401 }); }
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
    // Character cards can be created on either GPU. Merge only that namespace;
    // preserve the existing default library and its legacy lookup behavior.
    if(!target&&characterRefCardsEnabled()&&Array.isArray(raw)){
      try{const remote=await fetch(H3_BACKEND_PROFILES.rtx5060ti.baseUrl+"/refmods/library",{cache:"no-store",signal:AbortSignal.timeout(10000)});const other=await remote.json();if(remote.ok&&Array.isArray(other))for(const item of other)if(String(item.name).startsWith(CHARACTER_REF_PREFIX)&&!raw.some(e=>e.name===item.name))raw.push({...item,otgBackend:"rtx5060ti"});}catch{}
    }
    const entries = Array.isArray(raw)
      ? raw.filter(entry=>canUseCharacterRefMod(owner.ownerKey,String(entry.name||""))).map((entry) => {
          const normalized = normalizeH3RefModLibraryEntry(entry);
          normalized.canDelete=characterRefCardsEnabled();
          if (target !== "rtx5060ti" && normalized.file && fs.existsSync(normalized.file)) {
            const stat = fs.statSync(normalized.file);
            normalized.sizeBytes = stat.size;
            normalized.createdAt = stat.birthtime.toISOString();
            normalized.modifiedAt = stat.mtime.toISOString();
          }
          const privateCard=normalized.name.startsWith(CHARACTER_REF_PREFIX);
          if(privateCard)normalized.backend=target|| (entry.otgBackend==="rtx5060ti"?"rtx5060ti":"rtx3090");
          const sidecar = target === "rtx5060ti"&&!privateCard ? null : readH3RefModSidecar(normalized.name);
          if (sidecar) {
            if(privateCard&&sidecar.ownerKey===owner.ownerKey&&characterRefCardsEnabled())normalized.editableCardId=sidecar.jobId;
            if(sidecar.ownerKey===owner.ownerKey&&sidecar.voice){normalized.category="character";normalized.voiceName=sidecar.voice.name;}
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
            if(privateCard&&sidecar.ownerKey===owner.ownerKey){normalized.displayName=sidecar.name;normalized.description=sidecar.description||"";normalized.previewPath=`/api/h3/special/refmods/character-card?id=${sidecar.jobId}&preview=${sidecar.cardPreviewPath?normalized.name.split("/").pop():"1"}`;}
          }
          return normalized;
        })
      : [];
    return noStore({ ok: true, backend: target || baseUrl, entries, trashEnabled:characterRefCardsEnabled() });
  } catch (error) {
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read the RefMod library.",
      entries: [],
    }, { status: 502 });
  }
}
