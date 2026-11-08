import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({session: vi.fn(), staged: vi.fn()}));
vi.mock("@/lib/sessionUser", () => ({requireSessionUser: mocks.session}));
vi.mock("@/lib/h3StagedUploads", () => ({readCompletedH3StagedUpload: mocks.staged}));
import { GET } from "@/app/api/h3/smart-references/route";
import { inspectH3SmartReferences, makeH3SmartReferenceInput, saveH3SmartReferenceImage } from "@/lib/h3SmartReferencesServer";
import { normalizeH3RefModSlots } from "@/lib/h3SpecialModes/refMods";
const slot = normalizeH3RefModSlots([{name: "cat", sourceKind: "image", category: "character"}])[0];
const info = {MiniMaxH3ReferenceToVideo: {input: {optional: {ref_images: ["COMFY_AUTOGROW_V3", {max: 7}], ref_videos: ["COMFY_AUTOGROW_V3", {max: 3}], ref_audios: ["COMFY_AUTOGROW_V3", {max: 3}]}}}, MiniMaxH3AddGuide: {}, PK_MiniMaxH3Combined: {}, MiniMaxH3RefModTextEncode: {}, MiniMaxH3RefModsLoader: {input: {required: {mod_1: [], mod_2: []}}}};
beforeEach(() => {
 vi.clearAllMocks();mocks.session.mockResolvedValue({ownerKey: "qa"});
 vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/object_info") ? info : [{name: "cat", kind: "image", tokens: 50}])));
});
afterEach(() => vi.unstubAllGlobals());
describe("live selected-worker capability metadata and owned first-frame resolution", () => {
 it("denies anonymous capability probing before contacting a worker", async () => {
  mocks.session.mockRejectedValue(Error("Unauthorized"));expect((await GET(new NextRequest("http://test/api/h3/smart-references?backend=rtx3090"))).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
 });
 it("does not turn arbitrary backend query text into a worker URL", async () => {
  expect((await GET(new NextRequest("http://test/api/h3/smart-references?backend=http://foreign"))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
 });
 it("derives slot/image limits from installed schema and reports the disabled token budget truthfully", async () => {
  const cap = await inspectH3SmartReferences("rtx3090", true);
  expect(cap).toMatchObject({backend: "rtx3090", maxImages: 7, maxRefModSlots: 2, maxTotalReferenceMedia: 12, firstFrameConsumesReferenceAllowance: false, referenceTokenBudget: null});
  expect(cap.refMods).toEqual([{name: "cat", kind: "image", tokens: 50}]);
 });
 it("binds the selected 5060 worker and fails closed if its combined node is absent", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/object_info") ? {...info, PK_MiniMaxH3Combined: undefined} : [{name: "cat", kind: "image", tokens: 50}])));
  const cap = await inspectH3SmartReferences("rtx5060ti", true);expect(cap.mixedReferences).toBe(false);
  expect(fetch).toHaveBeenCalledWith("http://100.98.212.116:8188/object_info", expect.anything());
  await expect(makeH3SmartReferenceInput({useFirstFrame: false, refMods: [slot]}, "rtx5060ti", [{path: "/owned/girl", name: "girl", description: ""}], null, 0, 0, undefined, "qa")).rejects.toThrow("not installed");
 });
 it("reads actual library kind instead of trusting the client’s source-kind label", async () => {
  const value = await makeH3SmartReferenceInput({useFirstFrame: false, refMods: [{...slot, sourceKind: "audio"}]}, "rtx3090", [], null, 0, 0, undefined, "qa");
  expect(value?.referenceMap[0]).toMatchObject({kind: "image", tag: "<Picture 1>"});
 });
 it("refuses another owner’s staged image before any file read, decode, or GPU request", async () => {
  mocks.staged.mockRejectedValue(Error("Upload does not belong to owner"));
  await expect(saveH3SmartReferenceImage("alice", {id: "bob-upload", path: "/etc/passwd"})).rejects.toThrow("does not belong");
  expect(mocks.staged).toHaveBeenCalledWith("alice", {id: "bob-upload", path: "/etc/passwd"}, "image");expect(fetch).not.toHaveBeenCalled();
 });
 it("does no new capability or upload work for a legacy request with the new feature absent", async () => {
  expect(await makeH3SmartReferenceInput(undefined, "rtx3090", [], null)).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
 });
});
