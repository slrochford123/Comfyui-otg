import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { listStoryCreatorProjects } from "@/lib/storyCreator/store";
import { callStoryCpu } from "@/lib/storyCreator/cpuClient";
import { openAIEnabled, transcribeOpenAIAudio } from "@/lib/openai/provider";
import { storySpeechCapabilities } from "@/lib/storyCreator/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;
export async function POST(request: NextRequest) {
  try {
    const { ownerKey } = await requireSessionUser(request);
    const provider = request.nextUrl.searchParams.get("provider");
    const worker = process.env.STORY_DICTATION_ROOT;
    const upgraded = provider === "parakeet" || provider === "openai" || provider === "whisper";
    const origin = request.headers.get("origin");
    if (upgraded && ((origin && new URL(origin).host !== request.headers.get("host")) ||
        request.headers.get("sec-fetch-site") === "cross-site")) {
      return NextResponse.json({ ok: false, error: "Same-origin request required." },
        { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (upgraded && !worker) return NextResponse.json({ ok: false, error: "The Story Creator dictation worker is unavailable." }, { status: 503 });
    if ((!upgraded || provider === "whisper") && !storySpeechCapabilities().transcription) return NextResponse.json({ ok: false,
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
    const onAbort = () => {
      if (worker && upgraded) void callStoryCpu("/cancel", { jobId }, 3000, worker).catch(() => {});
      if (!upgraded || provider === "whisper") void callStoryCpu("/cancel", { jobId }, 3000).catch(() => {});
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (request.signal.aborted) throw new Error("Recording transcription was cancelled.");
      const audio = Buffer.from(await file.arrayBuffer()).toString("base64");
      if (request.signal.aborted) throw new Error("Recording transcription was cancelled.");
      const vocabulary = String(form.get("vocabulary") || "").slice(0, 1200);
      if (provider === "openai" && !openAIEnabled()) throw new Error("OpenAI dictation is unavailable. Select Parakeet for local dictation.");
      const processed = provider === "parakeet" || provider === "openai" ? await callStoryCpu<{ text?: string; wav?: string; durationSeconds: number; model?: string }>("/transcribe", {
        jobId, audio, normalizeOnly: provider !== "parakeet",
      }, 140_000, worker) : null;
      if (request.signal.aborted) throw new Error("Recording transcription was cancelled.");
      const noStore = { headers: { "Cache-Control": "no-store" } };
      if (processed && provider === "parakeet") {
        return NextResponse.json({ ok: true, ...processed, transcript: processed.text, provider }, noStore);
      }
      if (processed?.wav && provider === "openai") {
        const result = await transcribeOpenAIAudio({
          ownerKey, projectId, audio: Buffer.from(processed.wav, "base64"), fileName: "story-dictation.wav",
          mimeType: "audio/wav", audioSeconds: processed.durationSeconds, language,
          keywords: vocabulary.split(/[,\n]/).map(word => word.trim()).filter(Boolean).slice(0, 40),
          signal: request.signal,
          prompt: "Story development and filmmaking discussion.",
        });
        if (!result.text) throw new Error("No clear speech was detected. Nothing was sent.");
        return NextResponse.json({ ok: true, text: result.text, transcript: result.text, provider }, noStore);
      }
      const result = await callStoryCpu<{ text: string; language: string; durationSeconds: number }>("/transcribe", {
        jobId, audio, language,
        translate: request.nextUrl.searchParams.get("translate") === "en",
        vocabulary,
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
