import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { getStorySpeechJob } from "@/lib/storyCreator/store";
import { storySpeechPath } from "@/lib/storyCreator/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    const identity = { ownerKey, projectId: request.nextUrl.searchParams.get("projectId") || "",
      jobId: request.nextUrl.searchParams.get("jobId") || "" };
    const job = getStorySpeechJob(identity);
    if (!job || job.status !== "completed") return NextResponse.json({ ok: false, error: "Speech is not ready." }, { status: 404 });
    const file = storySpeechPath(identity);
    if (!fs.existsSync(file)) return NextResponse.json({ ok: false, error: "Cached speech is unavailable. The written reply is unchanged." }, { status: 404 });
    return mediaFileResponse(request, file, { download: request.nextUrl.searchParams.get("download") === "1", fileName: "story-director.wav" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof SessionInvalidError ? "Unauthorized" : "Speech was not found." },
      { status: error instanceof SessionInvalidError ? 401 : 404 });
  }
}
