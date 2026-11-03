import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {RequestError} from "@/lib/requestError";
import type {NativeEditEngine} from "@/lib/client/nativeImages";

export type BeforeAfterJob = {
  id: string; engine: NativeEditEngine; seed: number; prompt: string; createdAt: string;
  status: string; promptId?: string; imagePath?: string; error?: string;
};
export function beforeAfterJobFile(owner: string, id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new RequestError("Invalid comparison job.", 400);
  return path.join(OTG_DATA_ROOT, "before-after-jobs", safeSegment(owner), id + ".json");
}
export async function readBeforeAfterJob(owner: string, id: string): Promise<BeforeAfterJob> {
  const file = beforeAfterJobFile(owner, id);
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new RequestError("Comparison job not found.", 404); throw error; }
}
export async function writeBeforeAfterJob(owner: string, job: BeforeAfterJob) {
  const file = beforeAfterJobFile(owner, job.id), temporary = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(job), {mode: 0o600});
  await fs.rename(temporary, file);
}
/** Exclusive durable claim: an interrupted upload or a double click cannot render twice. */
export async function claimBeforeAfterJob(owner: string, job: BeforeAfterJob) {
  const file = beforeAfterJobFile(owner, job.id);
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  try { await fs.writeFile(file, JSON.stringify(job), {flag: "wx", mode: 0o600}); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
}
export function publicBeforeAfterJob(job: BeforeAfterJob) {
  return {ok: true, jobId: job.id, engine: job.engine, seed: job.seed, status: job.status,
    promptId: job.promptId, error: job.error,
    ...(job.imagePath ? {imageUrl: `/api/images/before-after?jobId=${job.id}&image=1`} : {})};
}
