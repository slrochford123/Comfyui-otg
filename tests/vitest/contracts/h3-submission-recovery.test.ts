import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {NextRequest} from "next/server";
const m = vi.hoisted(() => ({owner: vi.fn(), session: vi.fn()}));
vi.mock("@/lib/sessionUser", () => ({requireSessionUser: m.session}));
vi.mock("@/lib/ownerKey", async original => ({...await original<typeof import("@/lib/ownerKey")>(), getOwnerContext: m.owner}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-h3-recovery-"));
vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_ENV", "test");
const {recoverableH3Submission, readH3Submission} = await import("@/lib/h3SubmissionRecovery");
const {GET} = await import("@/app/api/h3/submissions/route");
let key = 0;
const request = (id: string, value: unknown = {config: {prompt: "A kite", seed: 12}, staged: {}}) => new NextRequest("http://localhost/api/h3/generation", {
  method: "POST", headers: {"content-type": "application/json", "x-h3-request-id": id}, body: JSON.stringify(value),
});
beforeEach(() => {vi.clearAllMocks(); m.owner.mockResolvedValue({ownerKey: "owner-a"}); m.session.mockResolvedValue({}); key++;});
afterAll(async () => {vi.unstubAllEnvs(); await fs.rm(root, {recursive: true, force: true});});
describe("Durable owner-scoped H3 click receipts", () => {
  it("replays a lost acceptance response without creating a second video", async () => {
    const id = `request-${key}`, handler = vi.fn(async () => Response.json({ok: true, job: {id: "job-1", status: "queued"}}, {status: 202}));
    await recoverableH3Submission(request(id), "generation", handler);
    const replay = await recoverableH3Submission(request(id), "generation", handler);
    expect(replay.status).toBe(202); expect(await replay.json()).toMatchObject({job: {id: "job-1"}});
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await readH3Submission("owner-a", "generation", id))?.status).toBe("completed");
  });
  it("atomically admits only one double tap while the first request is still preparing", async () => {
    const id = `request-${key}`; let release!: () => void;
    const gate = new Promise<void>(r => {release = r;});
    const handler = vi.fn(async () => {await gate; return Response.json({job: {id: "only-job"}});});
    const first = recoverableH3Submission(request(id), "generation", handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    const second = await recoverableH3Submission(request(id), "generation", handler);
    expect(second.status).toBe(409); expect(await second.json()).toMatchObject({pending: true});
    release(); await first; expect(handler).toHaveBeenCalledTimes(1);
  });
  it("rejects reuse of an identity with different media or settings", async () => {
    const id = `request-${key}`, handler = vi.fn(async () => Response.json({job: {id: "one"}}));
    await recoverableH3Submission(request(id), "generation", handler);
    const other = await recoverableH3Submission(request(id, {config: {prompt: "Different"}}), "generation", handler);
    expect(other.status).toBe(409); expect(handler).toHaveBeenCalledTimes(1);
  });
  it("a separate explicit click gets a new video, including after a completed result", async () => {
    const handler = vi.fn(async () => Response.json({job: {id: String(Math.random()), status: "completed"}}));
    await recoverableH3Submission(request(`first-request-${key}`), "generation", handler);
    await recoverableH3Submission(request(`second-request-${key}`), "generation", handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("isolates another owner's receipt and rejects unauthenticated lookup", async () => {
    const id = `request-${key}`, handler = vi.fn(async () => Response.json({job: {id: "private-job"}}));
    await recoverableH3Submission(request(id), "generation", handler);
    m.owner.mockResolvedValue({ownerKey: "owner-b"});
    expect((await GET(new NextRequest(`http://localhost/api/h3/submissions?scope=generation&requestId=${id}`))).status).toBe(404);
    m.session.mockRejectedValue(new Error("Unauthorized"));
    expect((await GET(new NextRequest(`http://localhost/api/h3/submissions?scope=generation&requestId=${id}`))).status).toBe(401);
  });
  it("never reclaims an uncertain/crashed claim or launches a replacement job", async () => {
    const id = `request-${key}`, handler = vi.fn(async () => {throw Error("Unexpected shutdown after acceptance");});
    expect((await recoverableH3Submission(request(id), "generation", handler)).status).toBe(409);
    expect((await recoverableH3Submission(request(id), "generation", handler)).status).toBe(409);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("keeps definitive input errors reproducible without executing them again", async () => {
    const id = `request-${key}`, handler = vi.fn(async () => Response.json({error: "Choose a reference"}, {status: 400}));
    await recoverableH3Submission(request(id), "generation", handler);
    expect((await recoverableH3Submission(request(id), "generation", handler)).status).toBe(400);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("does not expose filesystem identities and refuses malformed/traversal identities", async () => {
    const handler = vi.fn();
    expect((await recoverableH3Submission(request("../escape"), "generation", handler)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
  it("bounds JSON before any operation and preserves legacy clients without the recovery header", async () => {
    const handler = vi.fn(async () => Response.json({ok: true}));
    expect((await recoverableH3Submission(request(`request-${key}`, {text: "x".repeat(140_000)}), "generation", handler)).status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    const old = new NextRequest("http://localhost/api/h3/generation", {method: "POST", body: "legacy"});
    expect((await recoverableH3Submission(old, "generation", handler)).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
