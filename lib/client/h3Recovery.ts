import {newClientRequestId} from "./requestId";
import {normalizeProfileStorageOwner} from "./profileStorage";

export const H3_RECOVERY_RESUME_EVENT = "otg:h3:resume";
const SCOPES: Record<string, string> = {
  "/api/h3/generation": "generation",
  "/api/h3/special/realism/generation": "realism",
  "/api/h3/special/body-swap/generation": "body-swap",
  "/api/h3/studio/auto": "studio-auto",
  "/api/h3/studio/execute": "studio-execute",
};
type Pending = {id: string; endpoint: string; body: string};
export type H3UploadIdentity = {id: string; kind: "image" | "video" | "audio"; name: string; type: string; size: number; complete?: boolean};
export class H3RecoveryError extends Error {
  constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message); }
}
export function h3RecoveryMessage(error: unknown) {
  if (error instanceof H3RecoveryError) return error.message;
  const message = error instanceof Error ? error.message : String(error || "");
  if (/failed to fetch|fetch failed|networkerror|load failed|abort|timed?\s*out/i.test(message)) {
    return "Connection interrupted. Your inputs were kept. Use Create Video again to reconnect safely; do not restart the app.";
  }
  return message || "Could not prepare your video. Your inputs were kept.";
}

/** One immutable intent per click. Unknown acceptance retains the same key/body. */
export class H3RecoveryClient {
  private pending: Pending | null = null;
  private uploads = new WeakMap<File, H3UploadIdentity>();
  private key: string;
  constructor(private owner: string, channel = "legacy", private fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.key = `otg:h3:pending-submission:v1:${encodeURIComponent(owner)}:${channel}`;
  }
  private read() {
    if (this.pending) return this.pending;
    try {
      const value = JSON.parse(localStorage.getItem(this.key) || "null");
      if (value && SCOPES[value.endpoint] && /^[a-zA-Z0-9_-]{8,100}$/.test(value.id) && typeof value.body === "string" && value.body.length <= 128 * 1024) this.pending = value;
    } catch { /* Storage unavailable: retain the in-memory intent. */ }
    return this.pending;
  }
  private save(value: Pending | null) {
    this.pending = value;
    try { if (value) localStorage.setItem(this.key, JSON.stringify(value)); else localStorage.removeItem(this.key); } catch {}
  }
  async fetch(url: string, init: RequestInit = {}, retrySafe = false) {
    for (let attempt = 0;; attempt++) {
      try {
        return await this.fetchImpl(url, {credentials: "include", cache: "no-store", ...init, signal: init.signal || AbortSignal.timeout(60_000)});
      } catch (error) {
        if (!retrySafe || attempt >= 1 || init.signal?.aborted) throw error;
      }
    }
  }
  async json(response: Response) {
    if (response.status === 401) throw new H3RecoveryError("Sign in again to create your video. Your prompt and references were kept.", 401);
    if (response.status === 413) throw new H3RecoveryError("This upload exceeded the server limit. Choose a smaller reference file.", 413);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new H3RecoveryError(data.error || "The server could not prepare this video. Your inputs were kept.", response.status, Boolean(data.pending || data.code === "H3_SUBMISSION_UNCERTAIN"));
    return data;
  }
  async ready() {
    const auth = await this.json(await this.fetch("/api/auth/me", {}, true));
    if (auth.user?.username && normalizeProfileStorageOwner(auth.user.username) !== normalizeProfileStorageOwner(this.owner)) {
      throw new H3RecoveryError("Your signed-in account changed. Reopen H3 before creating video; no job was submitted.", 401);
    }
    const health = await this.fetch("/api/healthz", {}, true);
    if (!health.ok) throw new H3RecoveryError("The server is reconnecting. Your inputs were kept; try Create Video again.", health.status);
  }
  get hasPending() { return Boolean(this.read()); }
  async recover(replayMissing = false): Promise<any | null> {
    const pending = this.read(); if (!pending) return null;
    const url = `/api/h3/submissions?scope=${SCOPES[pending.endpoint]}&requestId=${encodeURIComponent(pending.id)}`;
    const response = await this.fetch(url, {}, true);
    if (response.status === 404) return replayMissing ? this.send(pending) : null;
    if (response.status === 409) throw new H3RecoveryError("Still checking your original video request. Use Create Video again to reconnect; no duplicate was submitted.", 409, true);
    if (!response.ok && response.status !== 401 && response.status < 500) this.save(null);
    const data = await this.json(response);
    if (data.job?.id) { this.save(null); return data; }
    throw new H3RecoveryError("The original video request is unresolved. No duplicate was submitted.", 409, true);
  }
  private async send(pending: Pending): Promise<any> {
    try {
      const response = await this.fetch(pending.endpoint, {method: "POST", headers: {"Content-Type": "application/json", "X-H3-Request-Id": pending.id}, body: pending.body});
      if (!response.ok && response.status !== 401 && response.status !== 409 && response.status < 500) this.save(null);
      const data = await this.json(response);
      if (!data.job?.id) throw new H3RecoveryError("The server has not confirmed the video job. Use Create Video to check the same request.", 409, true);
      this.save(null); return data;
    } catch (error) {
      if (error instanceof H3RecoveryError) throw error;
      // GET only after an uncertain POST. Never blindly issue a second POST.
      const recovered = await this.recover(false).catch(() => null);
      if (recovered) return recovered;
      throw new H3RecoveryError(h3RecoveryMessage(error), 0, true);
    }
  }
  async submit(endpoint: string, payload: unknown) {
    if (!SCOPES[endpoint]) throw new Error("Unsupported video submission route.");
    const old = this.read();
    if (old) return await this.recover(true);
    const pending = {endpoint, id: newClientRequestId(), body: JSON.stringify(payload)};
    this.save(pending); return this.send(pending);
  }
  rememberUpload(file: File, upload: H3UploadIdentity) { this.uploads.set(file, upload); }
  async cachedUpload(file: File, kind: H3UploadIdentity["kind"]) {
    const cached = this.uploads.get(file);
    if (!cached || cached.kind !== kind) return null;
    if (!cached.complete) return cached;
    const response = await this.fetch(`/api/h3/generation/upload?id=${encodeURIComponent(cached.id)}`, {}, true);
    if (response.status === 404) { this.uploads.delete(file); return null; }
    const data = await this.json(response);
    if (data.upload?.id !== cached.id || data.upload?.size !== file.size || data.upload?.kind !== kind || data.upload?.name !== cached.name || !data.upload?.complete) throw new Error("Reference verification failed. Select this reference again.");
    return cached;
  }
}
