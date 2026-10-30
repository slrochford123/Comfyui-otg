import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {NextRequest, NextResponse} from "next/server";
import {getOwnerContext, SessionInvalidError} from "./ownerKey";
import {requireSessionUser} from "./sessionUser";
import {OTG_DATA_ROOT, safeSegment} from "./paths";
import {readH3StudioJson} from "./h3StudioRequests";

export const H3_SUBMISSION_SCOPES = ["generation", "realism", "body-swap", "studio-auto", "studio-execute"] as const;
export type H3SubmissionScope = typeof H3_SUBMISSION_SCOPES[number];
type Receipt = {fingerprint: string; status: "preparing" | "completed"; httpStatus?: number; result?: Record<string, unknown>};
function receiptPath(owner: string, scope: string, id: string) {
  if (!H3_SUBMISSION_SCOPES.includes(scope as H3SubmissionScope) || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error("Invalid video request identity.");
  return path.join(OTG_DATA_ROOT, "h3-submissions", safeSegment(owner), scope, id + ".json");
}
function reply(data: unknown, status = 200) { return NextResponse.json(data, {status, headers: {"Cache-Control": "private, no-store"}}); }
export async function readH3Submission(owner: string, scope: string, id: string) {
  const file = receiptPath(owner, scope, id);
  try { return JSON.parse(await fs.readFile(file, "utf8")) as Receipt; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; return {status: "preparing"} as Receipt; }
}
export function h3SubmissionReply(receipt: Receipt) {
  return receipt.status === "completed" && receipt.result
    ? reply(receipt.result, receipt.httpStatus)
    : reply({ok: false, pending: true, code: "H3_SUBMISSION_PENDING", error: "Checking the original video request. No duplicate was submitted."}, 409);
}

/** Atomic owner-scoped claim survives a lost HTTP response/process restart.
 * Never reclaim an uncertain claim: absence of a response is not rejection.
 * Clients without this header retain their existing request contract.
 */
export async function recoverableH3Submission(request: NextRequest, scope: H3SubmissionScope, handler: (request: NextRequest) => Promise<Response>): Promise<Response> {
  const id = request.headers.get("x-h3-request-id");
  if (!id) return handler(request);
  let claimed = false;
  try {
    await requireSessionUser(request);
    const owner = await getOwnerContext(request);
    const file = receiptPath(owner.ownerKey, scope, id);
    if (!request.headers.get("content-type")?.includes("application/json")) return reply({error: "Recoverable video requests require prepared JSON media."}, 400);
    const body = JSON.stringify(await readH3StudioJson(request, 128 * 1024));
    const fingerprint = crypto.createHash("sha256").update(body).digest("hex");
    await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    try {
      const claim = await fs.open(file, "wx", 0o600);
      claimed = true;
      try { await claim.writeFile(JSON.stringify({fingerprint, status: "preparing"})); }
      finally { await claim.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const prior = await readH3Submission(owner.ownerKey, scope, id);
      if (prior?.fingerprint && prior.fingerprint !== fingerprint) return reply({error: "This video request belongs to different inputs. Recover the original request first."}, 409);
      return h3SubmissionReply(prior || {fingerprint, status: "preparing"});
    }
    const headers = new Headers(request.headers); headers.delete("content-length");
    // Client disconnects do not cancel an already accepted server operation.
    const forwarded = new NextRequest(request.url, {method: "POST", headers, body});
    const response = await handler(forwarded);
    const result = await response.clone().json();
    const temporary = file + "." + crypto.randomUUID() + ".tmp";
    await fs.writeFile(temporary, JSON.stringify({fingerprint, status: "completed", httpStatus: response.status, result}), {mode: 0o600});
    await fs.rename(temporary, file);
    return response;
  } catch (error) {
    if (error instanceof SessionInvalidError || /unauthorized|session invalid/i.test((error as Error).message)) return reply({error: "Sign in again to create your video. Your inputs were kept."}, 401);
    if (!claimed) return reply({error: "Invalid or oversized video request. Your inputs were kept."}, (error as Error & {status?: number}).status === 413 ? 413 : 400);
    // Do not erase a claim or automatically replay a possibly accepted job.
    return reply({error: "Video request could not be confirmed. Use Create Video again to check the same request.", code: "H3_SUBMISSION_UNCERTAIN"}, 409);
  }
}
