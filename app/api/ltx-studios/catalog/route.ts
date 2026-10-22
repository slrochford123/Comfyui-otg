import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { configurationPath, runtimePath, qualificationEnvironment } from "@/lib/runtime/configPaths";
import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getGallerySourcesForRequest } from "@/lib/gallery";
import { LTX_STUDIOS_CATALOG, validateLtxStudiosCatalog } from "@/lib/ltxStudiosCatalog";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {inspectH3LtxAlphaCompatibility} from "@/lib/h3SpecialModes/ltxAlphaMotion";
import {LTX_STUDIO_RUNTIME,isLtxStudioRuntimeTool,inspectLtxStudioRuntime} from "@/lib/ltxStudiosRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function comfyRoot() {
  return String(process.env.OTG_LTX_STUDIO_COMFY_MODELS || process.env.COMFYUI_MODELS_ROOT || runtimePath("comfyui", "models")).trim();
}

function localAssetState() {
  const roots = [path.join(comfyRoot(), "loras"), path.join(comfyRoot(), "checkpoints")];
  const filenames = roots.flatMap((root) => {
    try { return fs.readdirSync(root).filter((name) => /\.(safetensors|gguf|pt|bin)$/i.test(name)); } catch { return []; }
  });
  const normalized = filenames.map((name) => name.toLowerCase());
  return { roots, filenames, normalized };
}

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req).catch(()=>{throw new SessionInvalidError();});
    validateLtxStudiosCatalog();
    const assets = localAssetState();
    let qualified:Record<string,{workflowRevision?:string;promptId?:string}>={};
    try{
      const proof=JSON.parse(fs.readFileSync(process.env.OTG_LTX_STUDIOS_QUALIFICATION_FILE || configurationPath("ltx-studios-qualified.json"),"utf8"));
      const environment=qualificationEnvironment();
      if(environment && (environment === "prod" ? proof.environment === "prod" : !proof.environment || proof.environment === environment)) qualified=proof.entries||proof;
    }catch{}
    const entries = await Promise.all(LTX_STUDIOS_CATALOG.map(async(entry) => {
      const tool=isLtxStudioRuntimeTool(entry.id)?entry.id:null;
      const compatibility=tool?await inspectLtxStudioRuntime(configuredVideoComfyBaseUrl() || "",tool):null;
      const executable=Boolean(tool&&compatibility?.compatible);
      const runtimeReady=Boolean(tool&&executable&&qualified[entry.id]?.workflowRevision===LTX_STUDIO_RUNTIME[tool].revision&&qualified[entry.id]?.promptId);
      return {...entry,installed:executable||entry.assetNames.some(name=>assets.normalized.includes(name.toLowerCase())),executable,runtimeReady,
        recommendedStrength:tool?LTX_STUDIO_RUNTIME[tool].strength:entry.recommendedStrength,
        status:runtimeReady?"ready":executable?"cataloged":"needs-workflow",
        statusReason:runtimeReady?"Ready":executable?"Runtime verification pending":"Publisher access required",
        notes:executable?entry.notes.filter(note=>!note.startsWith("Publisher approval required:")):entry.notes};
    }));
    return NextResponse.json({ ok: true, schemaVersion: "ltx-studios-v1", baseModel: "LTX 2.5", selectedBackend: "3090-primary", entries, assetCount: assets.filenames.length, additive: true });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "LTX Studios catalog failed." }, { status: 500 });
  }
}
