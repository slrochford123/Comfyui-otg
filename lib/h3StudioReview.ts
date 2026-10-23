import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { studioPrivateOwnerRoot } from "@/lib/h3StudioMedia";
import type { H3StudioPlan } from "@/lib/h3StudioPlan";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)]));
  return value;
}
export const studioRequestHash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
export type StudioExecutionReceipt = { executionDigest: string; credits: number | null; seconds: number | null };
/** Normalize only explicit worker filename/output bindings. Prompt and seed remain exact. */
export function studioReviewedExecutionDigest(graph: H3PromptGraph) {
  const normalized = structuredClone(graph);
  const fields: Record<string, string> = { LoadImage: "image", LoadVideo: "file", LoadAudio: "audio", SaveVideo: "filename_prefix" };
  for (const node of Object.values(normalized)) {
    const field = fields[node.class_type];
    if (field && typeof node.inputs[field] === "string") node.inputs[field] = `[bound:${node.class_type}.${field}]`;
  }
  return studioRequestHash(normalized);
}
export type StudioReview = { id: string; session: string; planHash: string; mediaFingerprint: string; qualificationFingerprint: string; graphSha256: string; receipt?: StudioExecutionReceipt; expiresAt: number };
function reviewPath(owner: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Preview a fresh plan.");
  return path.join(studioPrivateOwnerRoot(owner), "reviews", `${id}.json`);
}
export async function createStudioReview(owner: string, session: string, plan: H3StudioPlan, mediaFingerprint: string, qualificationFingerprint: string, graphSha256: string, receipt?: StudioExecutionReceipt) {
  const review: StudioReview = { id: crypto.randomUUID(), session, planHash: studioRequestHash(plan), mediaFingerprint, qualificationFingerprint, graphSha256, ...(receipt ? { receipt } : {}), expiresAt: Date.now() + 15 * 60_000 };
  const file = reviewPath(owner, review.id); await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(review), { mode: 0o600, flag: "wx" }); return review;
}
export async function validateStudioReview(owner: string, session: string, id: string, plan: H3StudioPlan, mediaFingerprint: string, qualificationFingerprint: string, graphSha256: string, receipt?: StudioExecutionReceipt) {
  const review = JSON.parse(await fs.readFile(reviewPath(owner, id), "utf8")) as StudioReview;
  if (review.id !== id || review.session !== session || review.expiresAt <= Date.now() || review.planHash !== studioRequestHash(plan) || review.mediaFingerprint !== mediaFingerprint || review.qualificationFingerprint !== qualificationFingerprint || review.graphSha256 !== graphSha256 || (receipt && studioRequestHash(receipt) !== studioRequestHash(review.receipt || null))) throw new Error("The plan, references, estimate or configuration changed. Preview and approve a fresh plan.");
  return review;
}
export async function claimStudioReview(owner: string, id: string) {
  const file = reviewPath(owner, id) + ".claimed";
  const handle = await fs.open(file, "wx", 0o600); await handle.close();
  return async () => { await fs.rm(file, { force: true }); };
}
