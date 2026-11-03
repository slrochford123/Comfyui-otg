import {newClientRequestId} from "./requestId";
import type {NativeEditEngine} from "./nativeImages";
import {profileStorageKey} from "./profileStorage";

export type ComparisonJob = {jobId: string; engine: NativeEditEngine; seed: number; status: string; promptId?: string; imageUrl?: string; error?: string};
export type ComparisonDraft = {version: 1; prompt: string; engine: NativeEditEngine; position: number; job: ComparisonJob | null; saved: boolean};
export const emptyComparisonDraft = (): ComparisonDraft => ({version: 1, prompt: "", engine: "qwen", position: 50, job: null, saved: false});
export const comparisonPending = (job: ComparisonJob | null) => Boolean(job && !["completed", "failed", "canceled"].includes(job.status));
export function freshComparisonSeed(previous?: number) {
  const bytes = new Uint32Array(1); globalThis.crypto.getRandomValues(bytes);
  return bytes[0] === previous ? (bytes[0] + 1) % 2 ** 32 : bytes[0];
}
const DB = "otg-before-after-v1";
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("Comparison storage is unavailable."));
  });
}
const ownerKey = (owner: string) => profileStorageKey("before-after", owner);
export async function loadComparison(owner: string): Promise<{draft: ComparisonDraft; source: File | null}> {
  await writes.catch(() => {});
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", "readonly"), store = transaction.objectStore("sessions");
      const draft = store.get(ownerKey(owner) + ":draft"), source = store.get(ownerKey(owner) + ":source");
      transaction.oncomplete = () => resolve({draft: draft.result?.version === 1 ? draft.result : emptyComparisonDraft(), source: source.result || null});
      transaction.onabort = transaction.onerror = () => reject(transaction.error || Error("Could not restore comparison."));
    });
  } finally { db.close(); }
}
// Serialize writes so a slow older IndexedDB transaction cannot replace a new edit.
let writes: Promise<void> = Promise.resolve();
export function saveComparison(owner: string, draft: ComparisonDraft, source?: File | null) {
  const work = writes.catch(() => {}).then(async () => {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("sessions", "readwrite"), store = transaction.objectStore("sessions");
        store.put(draft, ownerKey(owner) + ":draft");
        if (source !== undefined) source ? store.put(source, ownerKey(owner) + ":source") : store.delete(ownerKey(owner) + ":source");
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error || Error("Your comparison could not be saved on this device."));
      });
    } finally { db.close(); }
  });
  writes = work; return work;
}
export function newComparisonJob(engine: NativeEditEngine, previousSeed?: number): ComparisonJob {
  return {jobId: newClientRequestId(), engine, seed: freshComparisonSeed(previousSeed), status: "submitting"};
}
export async function submitComparison(job: ComparisonJob, source: File, prompt: string, fetcher: typeof fetch = fetch) {
  const body = new FormData();
  body.set("clientRequestId", job.jobId); body.set("engine", job.engine); body.set("seed", String(job.seed));
  body.set("prompt", prompt); body.set("image", source);
  const response = await fetcher("/api/images/before-after", {method: "POST", credentials: "include", body});
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || "The edit could not be submitted."), {status: response.status});
  if (result.jobId !== job.jobId) throw Error("The comparison job did not match your request.");
  return result as ComparisonJob;
}
