import { after, NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { cancelStorySpeechJob, getStorySpeechJob, listStoryCreatorProjects } from "@/lib/storyCreator/store";
import { enqueueStorySpeech, prepareStorySpeech, storySpeechCapabilities } from "@/lib/storyCreator/speech";
import { callStoryCpu } from "@/lib/storyCreator/cpuClient";
import { isStoryLocalEngine, validStoryVoice } from "@/lib/storyCreator/speechVoices";
import { limitedJson } from "@/lib/limitedRequestBody";
import { RequestError } from "@/lib/requestError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
const headers = { "Cache-Control": "no-store" };
function errorResponse(error: unknown) {
  const status = error instanceof SessionInvalidError ? 401 : error instanceof RequestError ? error.status : 400;
  return NextResponse.json({ ok: false, error: status === 401 ? "Unauthorized"
    : error instanceof Error ? error.message : "Local speech request failed." }, { status, headers });
}
function authorizeProject(ownerKey: string, projectId: string) {
  if (!listStoryCreatorProjects(ownerKey).some((project) => project.id === projectId)) throw new Error("Story project was not found.");
}
export async function GET(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    const projectId = request.nextUrl.searchParams.get("projectId") || "";
    authorizeProject(ownerKey, projectId);
    const jobId = request.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      const capabilities = storySpeechCapabilities();
      if (capabilities.available) {
        try { await callStoryCpu("/health", {}, 1500); }
        catch { return NextResponse.json({ ok: true, capabilities: { ...capabilities, available: false, transcription: false,
          engines: { paradee: false, kokoro: false, bark: false }, defaultEngine: "browser" } }, { headers }); }
      }
      return NextResponse.json({ ok: true, capabilities }, { headers });
    }
    const job = getStorySpeechJob({ ownerKey, projectId, jobId });
    if (!job) return NextResponse.json({ ok: false, error: "Speech job was not found." }, { status: 404, headers });
    return NextResponse.json({ ok: true, job, url: job.status === "completed"
      ? `/api/story-creator/speech/media?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(job.id)}` : null }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    const body = await limitedJson(request, 8192);
    const projectId = String(body.projectId || "");
    authorizeProject(ownerKey, projectId);
    if (body.action === "cancel") {
      const identity = { ownerKey, projectId, jobId: String(body.jobId || "") };
      if (!identity.jobId) throw new Error("Missing speech job.");
      const job = cancelStorySpeechJob(identity);
      if (!job) throw new Error("Speech job was not found.");
      if (job.status === "running") await callStoryCpu("/cancel", { jobId: job.id }, 5000).catch(() => {});
      return NextResponse.json({ ok: true, job }, { headers });
    }
    if (!isStoryLocalEngine(body.engine) || !validStoryVoice(body.engine, body.voice)) throw new Error("Unsupported local voice selection.");
    await callStoryCpu("/health", {}, 1500);
    const result = prepareStorySpeech({ ownerKey, projectId, messageId: String(body.messageId || ""),
      engine: body.engine, voice: body.voice, retry: body.retry === true });
    if (result.created) after(() => enqueueStorySpeech({ ownerKey, projectId, jobId: result.job.id }));
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 202 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
