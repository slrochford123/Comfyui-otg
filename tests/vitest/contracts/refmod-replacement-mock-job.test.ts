import { afterAll, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ fixture: "", submissions: 0 }));
vi.mock("@/app/api/h3/special/refmods/library/route", () => ({ GET: async () => Response.json({ entries: [{ name: "characters/mock", kind: "video", category: "character", hasVisual: true }] }) }));
vi.mock("@/lib/auth/admin", () => ({ isAdminUserId: () => true }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: async () => ({ ownerKey: "mock-owner" }) }));
vi.mock("@/lib/production/h3Comfy", () => ({
  uploadH3InputToBaseUrl: async (a: { sourcePath: string }) => path.basename(a.sourcePath),
  submitH3PromptToBaseUrl: async (a: { beforeSubmit: () => Promise<void>; onAccepted: (id: string) => void }) => { mock.submissions++; await a.beforeSubmit(); a.onAccepted("mock-prompt"); return { accepted: true, promptId: "mock-prompt" }; },
  getH3PromptHistoryFromBaseUrl: async (_base: string, _id: string, _fetch: unknown, nodeId = "5") => ({ state: "completed", entry: {}, video: { filename: "mock.mp4", subfolder: "", type: "output", nodeId } }),
}));
vi.mock("@/lib/storyCreator/remoteComfyMedia", () => ({ retrieveRemoteComfyMedia: async (a: { destinationPath: string }) => { await fs.copyFile(mock.fixture, a.destinationPath); return { filePath: a.destinationPath }; } }));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-refmod-mock-"));
vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_EXPERIMENTS_ROOT", root); vi.stubEnv("OTG_DATA_DIR", path.join(root, "data"));
const { replacementGet, replacementPost } = await import("@/lib/refmodLab/server");
const { reserveAsset, finishAsset, withLab } = await import("@/lib/experiments/store");
const { buildReplacementGraph } = await import("@/lib/refmodLab/graph");
const { REPLACEMENT_DEFAULTS } = await import("@/lib/refmodLab/contract");
const req = (data?: unknown) => new NextRequest("http://test.local/api/experiments/refmod-replacement", data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {});
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
it("finishes one mocked C job, remuxes real CPU-fixture audio and saves owner-scoped output/evaluation without GPU inference", async () => {
  mock.fixture = path.join(root, "mock-source.mp4");
  execFileSync("/usr/bin/ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-shortest", mock.fixture], { stdio: "ignore" });
  const owner = "mock-admin", init = await (await replacementPost(req({ action: "init" }), owner)).json(), session = init.workspace.session.id;
  const pending = reserveAsset(owner, session, "mock.mp4", "video/mp4", "source"); await fs.copyFile(mock.fixture, pending.file); const size = (await fs.stat(pending.file)).size; finishAsset(owner, pending.id, size, "f".repeat(64));
  const settings = { ...REPLACEMENT_DEFAULTS, workflow: "C", sourceId: pending.id, refMod: "characters/mock", subject: "the foreground runner", seconds: 2 };
  const graph = buildReplacementGraph(settings as typeof REPLACEMENT_DEFAULTS, { video: "source.mp4", refKind: "video", portrait: false, prefix: "lab/mock" }).graph;
  const info = Object.fromEntries(Object.values(graph).map(n => [n.class_type, { input: { required: {} } }]));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { if (String(url).endsWith("/object_info")) return Response.json(info); throw Error("Unexpected network operation: " + url); }));
  const response = await replacementPost(req({ action: "generate", settings, requestId: "mock-request-unique" }), owner); expect(response.status).toBe(202);
  let state: any;
  for (let i = 0; i < 200; i++) { const value = await (await replacementGet(req(), owner)).json(); state = value.runs[0]; if (["completed", "failed", "needs-review"].includes(state.state)) break; await new Promise(r => setTimeout(r, 20)); }
  expect(state.state, state.message).toBe("completed"); expect(state.outputId).toBeTruthy(); expect(state.maskOutputId).toBeTruthy(); expect(state.audio).toContain("directly remuxed"); expect(mock.submissions).toBe(1);
  expect((await replacementPost(req({ action: "generate", settings, requestId: "mock-request-unique" }), owner)).status).toBe(202); expect(mock.submissions).toBe(1);
  expect((await replacementPost(req({ action: "evaluate", id: state.id, evaluation: { scores: { identity: 4, motion: 3 }, notes: "CPU/mock path only, no quality inference." } }), owner)).status).toBe(200);
  const row = withLab(db => db.prepare("SELECT body FROM replacement_runs WHERE owner=?").get(owner)) as { body: string };
  expect(JSON.parse(row.body).evaluation.scores.identity).toBe(4);
}, 20000);
