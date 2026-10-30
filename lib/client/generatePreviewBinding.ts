import type {NativeImageResult} from "./nativeImages";

/** A preview belongs to a submission, not to the mutable global "last file". */
export class GeneratePreviewBinding {
  private revision = 0;
  private mode: "legacy" | "native" | "cleared" = "legacy";
  private jobId = "";

  begin(mode: "legacy" | "native") {
    this.revision += 1;
    this.mode = mode;
    this.jobId = "";
    return this.revision;
  }

  get token() { return this.revision; }
  get nativeJobId() { return this.jobId; }
  get blocksLegacy() { return this.mode !== "legacy"; }
  isCurrent(token: number) { return token === this.revision; }
  acceptsProgress(token: number) { return this.isCurrent(token) && this.mode !== "native"; }

  expectNative(token: number, jobId: string) {
    if (!this.isCurrent(token) || this.mode !== "native") return false;
    this.jobId = jobId;
    return true;
  }

  acceptsNative(token: number, result: NativeImageResult) {
    return this.isCurrent(token) && this.mode === "native" && Boolean(this.jobId) && result.jobId === this.jobId;
  }

  acceptsLegacy(token: number, force = false) {
    return this.isCurrent(token) && (this.mode === "legacy" || (force && this.mode === "cleared" && !this.jobId));
  }

  clear() {
    this.revision += 1;
    // Keep a native job identity so explicit Refresh can recover only that image.
    this.mode = this.jobId ? "native" : "cleared";
  }
}

/** One read only; Refresh must never submit a new job or fall back to another file. */
export async function loadNativeImagePreview(jobId: string, fetchImpl: typeof fetch = fetch): Promise<NativeImageResult> {
  const response = await fetchImpl(`/api/images/native?jobId=${encodeURIComponent(jobId)}`, {
    credentials: "include", cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "This image could not be refreshed.");
  if (result.jobId !== jobId || result.status !== "completed" || !result.imageUrl || !result.serverPath) {
    throw new Error("This image is not available yet. No unrelated image was substituted.");
  }
  return result;
}
