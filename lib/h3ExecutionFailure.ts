/** Public diagnostics only: never expose node tracebacks, paths or prompts. */
export function h3ExecutionFailure(entry: unknown, queueError?: string | null): Error {
  const messages = (entry as { status?: { messages?: unknown[] } } | null)?.status?.messages;
  const errors = Array.isArray(messages) ? messages.filter(m => Array.isArray(m) && m[0] === "execution_error").map(m => (m as unknown[])[1]) : [];
  const details = errors.map(e => typeof e === "object" && e ? String((e as { exception_message?: unknown }).exception_message || "") : "").join(" ");
  const text = queueError?.startsWith("The original ComfyUI worker stopped") ? queueError
    : /Comfy dispatch (requires its durable physical GPU reservation|does not match its reserved graph)/i.test(`${details} ${queueError || ""}`) ? "The GPU scheduler could not confirm this job's reservation, so the render was not submitted. Your original video is unchanged. Contact the administrator before retrying."
    : /illegal memory access|device-side assert|Triton Error/i.test(details) ? "The GPU attention kernel failed. This render stopped; no automatic retry was submitted. Try the safe Edit Video workflow or a smaller output."
    : /out of memory|cuda.*alloc|allocation.*failed/i.test(details) ? "The GPU ran out of available memory. Try a shorter clip or lower resolution; the original video is unchanged."
    : "H3 could not complete this render. The original video is unchanged. Check GPU status before retrying.";
  return Object.assign(new Error(text), { name: "H3ExecutionError" });
}
