import {requireTestLab} from "@/lib/experiments/store";
import { NextRequest, NextResponse } from "next/server";
import { createH3DirectJob, h3DirectPublicStatus, startH3DirectJob, validateH3DirectInput } from "@/lib/h3DirectJobs";
import { h3CharacterVoiceOptions, pinH3CharacterVoiceInputs, prepareH3CharacterVoices } from "@/lib/h3CharacterVoicesServer";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
import { recoverableH3Submission } from "@/lib/h3SubmissionRecovery";
import { withOwner } from "@/lib/routeSecurity";
import { requireTestingVoiceTools } from "@/lib/testingVoiceToolsAccess";
import { h3CharacterVoicesQualificationOnly } from "@/lib/h3StudioQualification";
import { verifyH3QualificationBridgeRoute } from "@/lib/h3QualificationBridgeRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "The cast request could not be completed." }, { status: 400 });
}

export const GET = withOwner(async (request, owner) => {
  requireTestLab();
  await requireTestingVoiceTools(request);
  try {
    const result = await h3CharacterVoiceOptions(owner.ownerKey, request.nextUrl.searchParams.getAll("characterId"));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return badRequest(error); }
});

export const POST = withOwner(async (request, owner) => {
  requireTestLab();
  await requireTestingVoiceTools(request);
  try {
    const body = await readH3StudioJson(request, 24_000);
    if (body.action === "preview") {
      const { preview } = await prepareH3CharacterVoices(request, owner.ownerKey, body);
      return NextResponse.json({ ok: true, ...preview });
    }
    if (body.action !== "generate") throw Error("Choose Preview or Generate.");
    if (typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) || typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint)) throw Error("Preview the current cast before generating.");
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    headers.set("x-h3-request-id", body.requestId);
    const staged = new NextRequest(request.url, { method: "POST", headers, body: JSON.stringify(body) });
    return recoverableH3Submission(staged, "character-voices", async protectedRequest => {
      if (h3CharacterVoicesQualificationOnly()) return NextResponse.json({ ok: false, error: "This TEST pilot requires a separate exact local owner approval. Preview does not submit work." }, { status: 409 });
      try { await verifyH3QualificationBridgeRoute(); }
      catch { return NextResponse.json({ ok: false, error: "The installed TEST bridge route could not be verified. No render was submitted." }, { status: 409 }); }
      try {
        const { input, preview, seed } = await prepareH3CharacterVoices(protectedRequest, owner.ownerKey, body);
        if (preview.fingerprint !== body.fingerprint) return NextResponse.json({ ok: false, error: "The reviewed cast, prompt or references changed. Preview the current selection again." }, { status: 409 });
        const verified = validateH3DirectInput(await pinH3CharacterVoiceInputs(owner.ownerKey, input, seed), owner.ownerKey);
        const job = await createH3DirectJob(owner.ownerKey, verified, owner, true);
        startH3DirectJob(job);
        return NextResponse.json({ ok: true, jobId: job.id, job: h3DirectPublicStatus(job) }, { status: 202 });
      } catch (error) { return badRequest(error); }
    });
  } catch (error) { return badRequest(error); }
});
