import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { listStoryCreatorProjects } from "@/lib/storyCreator/store";
import { callStoryCpu } from "@/lib/storyCreator/cpuClient";
import { storySpeechCapabilities } from "@/lib/storyCreator/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function POST(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    if (!storySpeechCapabilities().transcription) return NextResponse.json({ ok: false,
      error: "Local dictation is not ready. Type your message or explicitly select OpenAI transcription." }, { status: 503 });
    if (Number(request.headers.get("content-length") || 0) > 17 * 1024 * 1024) throw new Error("Recording is too large (16 MiB maximum).");
    const form = await request.formData();
    const projectId = String(form.get("projectId") || "");
    if (!listStoryCreatorProjects(ownerKey).some((project) => project.id === projectId)) throw new Error("Story project was not found.");
    const file = form.get("audio");
    if (!(file instanceof File) || file.size === 0 || file.size > 16 * 1024 * 1024) throw new Error("Choose a recording up to 16 MiB.");
    const language = String(form.get("language") || "").trim();
    if (language && !/^[a-z]{2,3}$/.test(language)) throw new Error("Choose a supported language or automatic detection.");
    const jobId = randomUUID();
    const onAbort = () => { void callStoryCpu("/cancel", { jobId }, 3000).catch(() => {}); };
    request.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (request.signal.aborted) throw new Error("Recording transcription was cancelled.");
      const result = await callStoryCpu<{ text: string; language: string; durationSeconds: number }>("/transcribe", {
        jobId, audio: Buffer.from(await file.arrayBuffer()).toString("base64"), language,
        translate: request.nextUrl.searchParams.get("translate") === "en",
        vocabulary: String(form.get("vocabulary") || "").slice(0, 1200),
      }, 170_000);
      if (!result.text.trim()) return NextResponse.json({ ok: false, error: "No clear speech was detected. Your draft was not changed." }, { status: 422 });
      return NextResponse.json({ ok: true, ...result, provider: "local-whisper", transcript: result.text },
        { headers: { "Cache-Control": "no-store" } });
    } finally { request.signal.removeEventListener("abort", onAbort); }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof SessionInvalidError ? "Unauthorized"
      : error instanceof Error ? error.message : "Local transcription failed. No paid fallback was used." },
      { status: error instanceof SessionInvalidError ? 401 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
