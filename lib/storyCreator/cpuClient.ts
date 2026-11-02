import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export const STORY_EMBEDDING_MODEL = "bge-small@5c38ec7c405ec4b44b94cc5a9bb96e735b38267a";

export function storyCpuRoot() {
  // No automatic inference, remote HTTP fallback, or media GPU allocation.
  return String(process.env.STORY_CREATOR_CPU_ROOT || "").trim();
}

export function storyCpuAvailable() {
  const root = storyCpuRoot();
  return Boolean(root && fs.existsSync(path.join(root, "worker.sock")));
}

export function callStoryCpu<T extends Record<string, unknown>>(
  endpoint: "/embed" | "/tts" | "/transcribe" | "/cancel" | "/health",
  data: Record<string, unknown> = {}, timeoutMs = 10_000,
): Promise<T> {
  const root = storyCpuRoot();
  if (!root) return Promise.reject(new Error("Local Story Creator models are not configured."));
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(data));
    const request = http.request({ socketPath: path.join(root, "worker.sock"), path: endpoint,
      method: endpoint === "/health" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length } }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) { request.destroy(new Error("Local model response is too large.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (response.statusCode !== 200 || !result.ok) reject(new Error(result.error || "Local model is unavailable."));
          else resolve(result);
        } catch (error) { reject(error); }
      });
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new Error("Local model timed out; no paid fallback was used.")), timeoutMs);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end(endpoint === "/health" ? undefined : body);
  });
}
