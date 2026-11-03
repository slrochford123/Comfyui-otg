import { recoverableH3Submission } from "@/lib/h3SubmissionRecovery";
import { makeH3SmartReferenceInput, saveH3SmartReferenceImage } from "@/lib/h3SmartReferencesServer";
import { normalizeH3SmartReferenceSelection } from "@/lib/h3SmartReferences";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  cancelH3RefModsJob,
  createH3RefModsJob,
  ensureH3RefModsJobRunner,
  getH3RefModsJob,
  getLatestH3RefModsJob,
  h3RefModsPublicStatus,
  retryH3RefModsJob,
  startH3RefModsJob,
} from "@/lib/h3SpecialModes/refModsJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id ? await getH3RefModsJob(ownerKey, id) : await getLatestH3RefModsJob(ownerKey);
    if (!job) {
      return id
        ? noStore({ ok: false, error: "H3 Ref Mods generation job not found." }, { status: 404 })
        : noStore({ ok: true, job: null });
    }
    ensureH3RefModsJobRunner(job);
    return noStore({ ok: true, job: h3RefModsPublicStatus(job) });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "H3 Ref Mods generation status failed.",
    }, { status: 400 });
  }
}

export async function POST(req: NextRequest) { return recoverableH3Submission(req, "refmods", postRefMods); }
async function postRefMods(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    const body = await req.json().catch(() => null) as {
      action?: unknown;
      jobId?: unknown;
      config?: unknown;
      staged?: {firstImage?: unknown; referenceImages?: unknown[]};
    } | null;
    if (body?.action === "cancel") {
      const canceled = await cancelH3RefModsJob(ownerKey, String(body.jobId || ""));
      return noStore({ ok: true, job: h3RefModsPublicStatus(canceled) });
    }
    if (body?.action === "retry") {
      const source = await getH3RefModsJob(ownerKey, String(body.jobId || ""));
      if (!source) throw new Error("H3 Ref Mods generation job not found.");
      const retry = await retryH3RefModsJob(source);
      startH3RefModsJob(retry);
      return noStore({ ok: true, job: h3RefModsPublicStatus(retry) }, { status: 202 });
    }
    const config = body?.config && typeof body.config === "object"
      ? body.config as Record<string, unknown>
      : {};
    const targetBackend = await (await import("@/lib/h3SmartReferencesServer")).characterRefSelectionBackend(config.smartReferences,await (await import("@/lib/mediaGpuRoutingServer")).requestedH3MediaGpu(config.targetBackend),ownerKey);
    const selection = normalizeH3SmartReferenceSelection(config.smartReferences);
    const staged = body?.staged;
    if (selection && JSON.stringify(selection.refMods) !== JSON.stringify((await import("@/lib/h3SpecialModes/refMods")).normalizeH3RefModSlots(config.refMods))) throw Error("The RefMod selection changed. Recheck your references.");
    if (staged?.referenceImages && (!Array.isArray(staged.referenceImages) || staged.referenceImages.length > 9)) throw Error("Use at most nine ordinary reference images.");
    const images = selection ? await Promise.all((staged?.referenceImages || []).map(item => saveH3SmartReferenceImage(ownerKey, item))) : [];
    const notes = Array.isArray(config.imageDescriptions) ? config.imageDescriptions : [];
    images.forEach((image, i) => { image.description = String(notes[i] || ""); });
    const first = selection?.useFirstFrame ? await saveH3SmartReferenceImage(ownerKey, staged?.firstImage) : null;
    const smartReferences = await makeH3SmartReferenceInput(selection, targetBackend || "rtx3090", images, first,0,0,undefined,ownerKey);
    if (smartReferences) smartReferences.originalPrompt = String(config.prompt || "");
    const job = await createH3RefModsJob(ownerKey, {...config, smartReferences, targetBackend}, owner);
    startH3RefModsJob(job);
    return noStore({ ok: true, job: h3RefModsPublicStatus(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "H3 Ref Mods generation request failed.",
    }, { status: 400 });
  }
}
