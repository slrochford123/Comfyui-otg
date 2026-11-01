import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({root: `/tmp/h3-smart-route-${process.pid}-${Math.random().toString(36).slice(2)}`, staged: vi.fn(), create: vi.fn(), start: vi.fn()}));
vi.mock("@/lib/paths", async original => ({...await original<typeof import("@/lib/paths")>(), OTG_DATA_ROOT: m.root}));
vi.mock("@/lib/sessionUser", () => ({requireSessionUser: async () => ({username: "qa"})}));
vi.mock("@/lib/ownerKey", () => ({getOwnerContext: async () => ({ownerKey: "qa", username: "qa", deviceId: "qa", scope: "user"}), SessionInvalidError: class extends Error {}}));
vi.mock("@/lib/mediaGpuRoutingServer", () => ({requestedH3MediaGpu: async () => "rtx3090"}));
vi.mock("@/lib/h3StagedUploads", () => ({readCompletedH3StagedUpload: m.staged}));
vi.mock("@/lib/h3DirectJobs", () => ({createH3DirectJob: m.create, startH3DirectJob: m.start, validateH3DirectInput: (input: unknown) => input, h3DirectPublicStatus: (job: unknown) => job,
 cancelH3DirectJob: vi.fn(), ensureH3DirectJobRunner: vi.fn(), getH3DirectJob: vi.fn(), getLatestH3DirectJob: vi.fn(), recoverH3DirectBeforeRetry: vi.fn()}));
import { POST } from "@/app/api/h3/generation/route";
const post = (patch = {}) => POST(new NextRequest("http://test/api/h3/generation", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({config: {mode: "h3-reference-to-video", quality: "sh", orientation: "landscape", durationSeconds: 5, prompt: '  The girl lifts the cat. She says "Hello".  ', smartReferences: {useFirstFrame: true, refMods: [{name: "cat", sourceKind: "image"}]}}, staged: {firstImage: {id: "opening"}, referenceImages: [{id: "girl"}]}, ...patch})}));
beforeEach(async () => {
 vi.clearAllMocks(); await fs.mkdir(m.root, {recursive: true});
 await sharp({create: {width: 32, height: 32, channels: 3, background: "red"}}).png().toFile(path.join(m.root, "opening.png"));
 await sharp({create: {width: 32, height: 32, channels: 3, background: "blue"}}).png().toFile(path.join(m.root, "girl.png"));
 m.staged.mockImplementation(async (owner: string, input: {id: string}) => {if (owner !== "qa" || !["opening", "girl"].includes(input.id)) throw Error("Upload does not belong to owner");return {name: input.id + ".png", type: "image/png", path: path.join(m.root, input.id + ".png")};});
 m.create.mockImplementation(async (_owner, input) => ({id: "accepted", status: "queued", input}));
 vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/object_info") ? {MiniMaxH3ReferenceToVideo: {}, MiniMaxH3AddGuide: {}, PK_MiniMaxH3Combined: {}, MiniMaxH3RefModTextEncode: {}, MiniMaxH3RefModsLoader: {input: {required: {mod_1: []}}}} : [{name: "cat", kind: "image", tokens: 100}])));
});
afterAll(async () => {vi.unstubAllGlobals();await fs.rm(m.root, {recursive: true, force: true});});
describe("owned staged Smart Reference request serialization", () => {
 it("accepts distinct first-frame and ordinary-image bytes, a saved RefMod and the untouched user prompt", async () => {
  const response = await post();expect(response.status).toBe(202);
  const input = m.create.mock.calls[0][1];
  expect(input.firstImage.path).not.toBe(input.images[0].path);
  expect(await fs.readFile(input.firstImage.path)).not.toEqual(await fs.readFile(input.images[0].path));
  expect(input.smartReferences.originalPrompt).toBe('  The girl lifts the cat. She says "Hello".  ');
  expect(input.smartReferences.referenceMap.map((r: {tag: string}) => r.tag)).toEqual(["<Picture 1>", "<Picture 2>"]);
  expect(m.start).toHaveBeenCalledOnce();
  expect(m.staged).toHaveBeenCalledWith("qa", {id: "opening"}, "image");
 });
 it("refuses a foreign staged source before creating or starting a job", async () => {
  const response = await post({staged: {firstImage: {id: "foreign"}, referenceImages: [{id: "girl"}]}});
  expect(response.status).toBe(400);expect(m.create).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
 });
 it("rejects oversubscribed expanded image references before creating a job", async () => {
  const response = await post({staged: {firstImage: {id: "opening"}, referenceImages: Array.from({length: 9}, () => ({id: "girl"}))}});
  expect(response.status).toBe(400);expect(m.create).not.toHaveBeenCalled();
 });
});
