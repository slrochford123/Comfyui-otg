import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { studioPrivateOwnerRoot } from "@/lib/h3StudioMedia";
import { studioRequestHash } from "@/lib/h3StudioReview";
function quotePath(owner: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Request a new planner estimate.");
  return path.join(studioPrivateOwnerRoot(owner), "quotes", `${id}.json`);
}
export async function createStudioPlannerConsent(owner: string, session: string, request: unknown) {
  const id = crypto.randomUUID(); const file = quotePath(owner, id); await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify({ id, session, fingerprint: studioRequestHash(request), expiresAt: Date.now() + 10 * 60_000 }), { flag: "wx", mode: 0o600 });
  return id;
}
/** Consumes one exact quoted request before any paid call. Failure never retries it. */
export async function consumeStudioPlannerConsent(owner: string, session: string, id: string, request: unknown, consent: boolean) {
  if (!consent) throw new Error("Explicit approval of the planner estimate is required.");
  const file = quotePath(owner, id); const quote = JSON.parse(await fs.readFile(file, "utf8"));
  if (quote.id !== id || quote.session !== session || quote.expiresAt <= Date.now() || quote.fingerprint !== studioRequestHash(request)) throw new Error("The planner estimate expired or its inputs changed.");
  const claim = await fs.open(file + ".used", "wx", 0o600); await claim.close();
}
