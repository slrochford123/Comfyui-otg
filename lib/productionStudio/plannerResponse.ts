import { createAssistantStream } from "@/lib/workers/assistantProvider";

// Detailed, schema-backed stories can take several minutes. This limit belongs
// only to the durable Production planner, not to every assistant in the app.
export const PLANNER_TIMEOUT_MS = 10 * 60 * 1000;
type PlannerRequest = Omit<Parameters<typeof createAssistantStream>[0], "signal" | "timeoutMs" | "maxRetries">;

export async function createPlannerResponse(
  request: PlannerRequest,
  canceled: () => boolean,
  onProgress: (message: string) => void = () => {},
  purpose: "story" | "assets" | "prompt" = "story",
) {
  if (canceled()) throw new Error("Canceled");
  const controller = new AbortController(), started = Date.now();
  let timedOut = false, userCanceled = false, receiving = false;
  let lastProgress = -Infinity, monitoringError: unknown;
  const progress = (force = false) => {
    if (!force && Date.now() - lastProgress < 15000) return;
    lastProgress = Date.now();
    const seconds = Math.floor((Date.now() - started) / 1000);
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    onProgress(purpose === "prompt" ? `AI Director ${receiving ? "is receiving your prompt proposal" : "is reviewing this shot"} · ${elapsed} elapsed. Your prompt is unchanged until you apply the proposal.` : purpose === "assets"
      ? `${receiving ? "Receiving asset requirements" : "Analyzing approved story assets"} · ${elapsed} elapsed. You may leave and return; no media is being generated.`
      : `${receiving ? "Receiving the story and scene details" : "Waiting for the filmmaker's story"} · ${elapsed} elapsed. Detailed plans may take several minutes.`);
  };
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, PLANNER_TIMEOUT_MS);
  const monitor = setInterval(() => {
    try {
      if (canceled()) { userCanceled = true; controller.abort(); }
      else if (!controller.signal.aborted) progress();
    } catch (error) { monitoringError = error; controller.abort(); }
  }, 1000);
  try {
    progress(true);
    const stream = await createAssistantStream({ ...request, signal: controller.signal, timeoutMs: PLANNER_TIMEOUT_MS, maxRetries: 0 });
    let text: string | undefined;
    for await (const event of stream) {
      if (controller.signal.aborted || canceled()) throw new Error("Planning stopped");
      if (event.type === "delta" && !receiving) { receiving = true; progress(true); }
      // Never publish partial JSON or install it as a story. The shared provider
      // emits done only after confirmed completion and usage accounting.
      if (event.type === "done") text = event.text;
    }
    if (text === undefined) throw new Error("OpenAI stream ended before completion.");
    return { text };
  } catch (error) {
    if (userCanceled || canceled()) throw new Error("Canceled");
    if (monitoringError) throw monitoringError;
    if (purpose === "prompt" && (timedOut || /abort|timed?\s*out|timeout|stream ended before completion|connection error|max_output_tokens|response incomplete/i.test(error instanceof Error ? error.message : "")))
      throw new Error(`The AI Director ${timedOut?"timed out":"was interrupted before a complete proposal arrived"}. Your prompt is unchanged. Retry when ready; no automatic retry was made.`);
    if (timedOut) throw new Error(purpose === "assets" ? "Asset analysis timed out after 10 minutes. Your approved story and previous assets are unchanged. Retry Analysis when ready; no automatic retry was made." : "The filmmaker reached the 10-minute planning limit. No complete story was received. Your saved story is unchanged. You can retry when ready; no automatic retry was made.");
    const message = error instanceof Error ? error.message : "";
    if (/abort|timed?\s*out|timeout|stream ended before completion|connection error/i.test(message))
      throw new Error(purpose === "assets" ? "Asset analysis was interrupted by a connection failure or upstream timeout before a complete response arrived. Your approved story and assets are unchanged. Retry Analysis when ready." : "The connection to the filmmaker ended before a complete story arrived. Your saved story is unchanged. You can retry when ready; no automatic retry was made.");
    if (/max_output_tokens|response incomplete/i.test(message))
      throw new Error(purpose === "assets" ? "The asset inventory exceeded the response limit. No partial inventory was installed. Your approved story and assets are unchanged; retry with a smaller approved working segment." : "The filmmaker could not finish the full plan within the response limit. Your saved story is unchanged. Ask for a more concise story and scene details, then try again.");
    throw error;
  } finally {
    clearTimeout(deadline);
    clearInterval(monitor);
    controller.abort();
  }
}
