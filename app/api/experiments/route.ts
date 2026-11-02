import { NextResponse } from "next/server";
import { EXPERIMENTS, H3_LICENSE_URL, H3_LICENSE_NOTICE, canvas, labExperiment } from "@/lib/experiments/catalog";
import { createSession, getSession, listSessions, updateSession } from "@/lib/experiments/store";
import { boundedJson, labRoute } from "@/lib/experiments/http";
import { RequestError } from "@/lib/requestError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = labRoute(async (request, owner) => {
  const id = request.nextUrl.searchParams.get("export");
  if (id) {
    const session = getSession(owner, id), experiment = labExperiment(session.experiment)!;
    return NextResponse.json({ schemaVersion: 1, runnable: false, environment: "test", exportedAt: new Date().toISOString(), experiment, session,
      target: { ...canvas(session.settings), fps: 24, deliveredFrames: session.settings.seconds * 24 },
      warnings: ["Planning manifest only: not a ComfyUI graph, generation receipt or promotion authorization.", "Native temporal framing and each mode require exact-graph verification. No frame padding or speed changes.", "Uploaded comparison media is owner-supplied, not evidence of an in-app generation."], licenseSource: H3_LICENSE_URL, authorization: H3_LICENSE_NOTICE,
    }, { headers: { "Content-Disposition": `attachment; filename="experiment-${id}.json"` } });
  }
  return NextResponse.json({ ok: true, environment: "test", executionEnabled: false, catalog: EXPERIMENTS, sessions: listSessions(owner) });
});
export const POST = labRoute(async (request, owner) => {
  const data = await boundedJson(request);
  if (data.action === "create" && typeof data.experiment === "string") return NextResponse.json({ ok: true, session: createSession(owner, data.experiment) }, { status: 201 });
  if (data.action === "update" && typeof data.id === "string") return NextResponse.json({ ok: true, session: updateSession(owner, data.id, data) });
  if (data.action === "generate" || data.action === "promote") throw new RequestError("Generation and promotion are unavailable: isolated runtime and exact workflow qualification are incomplete. No job was submitted.", 409);
  throw new RequestError("Unknown experiment action.", 400);
});
