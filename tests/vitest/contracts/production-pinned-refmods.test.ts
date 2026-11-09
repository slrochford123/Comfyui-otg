import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/h3DirectJobs", async original => ({
  ...await original<object>(), createH3DirectJob: mocks.create, startH3DirectJob: mocks.start,
}));
// No admission or inference in regression tests; keep actual reference validation.
vi.mock("@/lib/workers/mediaGpuQueue", () => ({ preferMediaGpu: async (gpus: string[]) => gpus[0] }));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-pinned-refmod-"));
vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_DATA_ROOT", root);
vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_STUDIO_WORKER_DISABLED", "1");
const { productionRefModName, productionRefModLocation, resolveProductionRefMod } = await import("@/lib/productionStudio/pinnedRefMods");
const { h3RefModSidecarPath, readH3RefModSidecar, writeH3RefModSidecar } = await import("@/lib/h3SpecialModes/refModCreation");
const { characterRefOwnerHash } = await import("@/lib/h3SpecialModes/characterRefCardAccess");
const { normalizeH3RefModSlots } = await import("@/lib/h3SpecialModes/refMods");
const { createStudioStore } = await import("@/lib/productionStudio/store");
const { snapshotFile } = await import("@/lib/productionStudio/media");
const { allShots, DEFAULT_SHOT } = await import("@/lib/productionStudio/model");
const { startVideo } = await import("@/lib/productionStudio/generation");
const store = createStudioStore(root + "/store");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(legacy = true) {
  const characterId = randomUUID(), name = `characters/slr-test-cards/${characterRefOwnerHash("owner")}/${characterId}/studio-fixture-${randomUUID()}`;
  const raw = name + (legacy ? ".safetensors" : ""), file = root + "/" + characterId + ".safetensors", voice = root + "/" + characterId + ".wav";
  fs.writeFileSync(file, "immutable bundle"); fs.writeFileSync(voice, "immutable voice");
  const sidecar = {
    version: 1 as const, ownerKey: "owner", libraryName: raw, name: "Ava", characterId,
    savedPath: file, category: "character" as const, subfolder: path.posix.dirname(name),
    sourceType: "otg-created" as const, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", jobId: "original-job", sourceAssets: [],
    voice: { id: "approved-voice", name: "Ava voice", path: voice, originalPath: voice, sha256: digest("immutable voice"), durationSeconds: 5 },
    members: [{ kind: "video" as const, tokens: 2304, shape: [1,24,4,64,36] }, { kind: "audio" as const, tokens: 192, shape: [1,32,2,96] }],
  };
  writeH3RefModSidecar(sidecar);
  return { name, raw, file, sidecar, pinned: { libraryName: raw, sha256: digest("immutable bundle"), characterId } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockImplementation(async (_owner, input) => ({ id: "fake-child", input })); });
afterAll(() => { store.db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Production pinned RefMod compatibility", () => {
  it("new pins separate the extensionless library key from the physical filename", () => {
    const location = productionRefModLocation("characters/example/original", "/models/characters/example/original.safetensors", "project-123");
    expect(location.pinnedName).toMatch(/^characters\/example\/studio-project--/);
    expect(path.basename(location.workerFile)).toBe(path.basename(location.pinnedName) + ".safetensors");
    expect(normalizeH3RefModSlots([{ name: location.pinnedName }])[0].name).toBe(location.pinnedName);
  });
  it.each(["../escape.safetensors", "/absolute/model.safetensors", "C:\\models\\asset.safetensors", "characters/../asset.safetensors", "characters//asset.safetensors", ".safetensors", "asset.safetensors.safetensors", ""]) ("rejects unsafe names without weakening H3: %s", value => {
    expect(() => productionRefModName(value)).toThrow("invalid library name");
  });
  it("the shared validator still rejects filename extensions", () => {
    expect(() => normalizeH3RefModSlots([{ name: "model.safetensors" }])).toThrow("without traversal or extension");
  });
  it("repairs a legacy alias additively, keeping immutable voice, layout, and original registry", async () => {
    const f = fixture(), before = fs.readFileSync(h3RefModSidecarPath(f.raw));
    expect(await resolveProductionRefMod("owner", f.pinned)).toBe(f.name);
    expect(readH3RefModSidecar(f.name)).toEqual({ ...f.sidecar, libraryName: f.name });
    expect(fs.readFileSync(h3RefModSidecarPath(f.raw))).toEqual(before);
    expect(fs.readFileSync(f.file, "utf8")).toBe("immutable bundle");
    expect(f.pinned.libraryName).toBe(f.raw);
    expect(fs.statSync(h3RefModSidecarPath(f.name)).mode & 0o777).toBe(0o600);
    await expect(resolveProductionRefMod("owner", f.pinned)).resolves.toBe(f.name);
  });
  it("parallel retries safely share one complete alias", async () => {
    const f = fixture();
    expect(await Promise.all(Array.from({ length: 5 }, () => resolveProductionRefMod("owner", f.pinned)))).toEqual(Array(5).fill(f.name));
    expect(readH3RefModSidecar(f.name)).toEqual({ ...f.sidecar, libraryName: f.name });
    expect(fs.readdirSync(path.dirname(h3RefModSidecarPath(f.name))).some(x => x.endsWith(".tmp"))).toBe(false);
  });
  it("canonical bundles need no registry writes", async () => {
    const f = fixture(false), before = fs.statSync(h3RefModSidecarPath(f.name)).mtimeMs;
    await expect(resolveProductionRefMod("owner", f.pinned)).resolves.toBe(f.name);
    expect(fs.statSync(h3RefModSidecarPath(f.name)).mtimeMs).toBe(before);
  });
  it("does not create aliases for changed, unavailable, foreign or mismatched bundles", async () => {
    const f = fixture();
    await expect(resolveProductionRefMod("other-owner", f.pinned)).rejects.toThrow("account");
    await expect(resolveProductionRefMod("owner", { ...f.pinned, characterId: "different" })).rejects.toThrow("identity");
    fs.writeFileSync(f.file, "changed");
    await expect(resolveProductionRefMod("owner", f.pinned)).rejects.toThrow("was changed");
    expect(fs.existsSync(h3RefModSidecarPath(f.name))).toBe(false);
    fs.unlinkSync(h3RefModSidecarPath(f.raw));
    await expect(resolveProductionRefMod("owner", f.pinned)).rejects.toThrow("not available");
  });
  it("never overwrites an existing conflicting or corrupt canonical registry", async () => {
    const f = fixture();
    writeH3RefModSidecar({ ...f.sidecar, libraryName: f.name, voice: { ...f.sidecar.voice, id: "different-voice" } });
    const target = h3RefModSidecarPath(f.name), before = fs.readFileSync(target);
    await expect(resolveProductionRefMod("owner", f.pinned)).rejects.toThrow("conflicts");
    expect(fs.readFileSync(target)).toEqual(before);
    fs.writeFileSync(target, "invalid json");
    await expect(resolveProductionRefMod("owner", f.pinned)).rejects.toThrow("conflicts");
    expect(fs.readFileSync(target, "utf8")).toBe("invalid json");
  });
  it.each(["preview", "regenerate"] as const)("%s uses real H3 validation for a legacy voiced bundle, without submitting GPU work", async kind => {
    const f = fixture(), p = store.create("owner", "Coffee shop"), shot = allShots(p)[0];
    shot.description = "Ava reacts at the counter"; shot.generationApproach = "reference-to-video";
    shot.plannedDurationSeconds = 6; shot.requestedDurationSeconds = 10;
    const image = root + "/image.png"; fs.writeFileSync(image, "pinned image fixture");
    const bundle = await snapshotFile(store, "owner", p.id, f.file, "Ava RefMod", "refmod", { libraryName: f.raw, characterId: f.sidecar.characterId });
    const character = await snapshotFile(store, "owner", p.id, image, "Ava", "character", { bundleId: bundle.id });
    p.shots[shot.id] = { ...DEFAULT_SHOT, referenceIds: [character.id], videoPromptOverride: "The approved full video prompt." };
    const info = { MiniMaxH3ReferenceToVideo: {}, MiniMaxH3AddGuide: {}, PK_MiniMaxH3Combined: {}, MiniMaxH3RefModTextEncode: {}, MiniMaxH3RefModsLoader: { input: { required: { mod_1: {}, mod_2: {} } } } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/object_info")) return Response.json(info);
      if (url.endsWith("/refmods/library")) return Response.json([{ name: f.name, kind: "bundle", tokens: 2496 }]);
      throw Error("Unexpected external request: " + url);
    }));
    const job = store.enqueue("owner", p.id, kind, { snapshot: p, shotId: shot.id }, randomUUID());
    await startVideo(store, "owner", job);
    const input = mocks.create.mock.calls[0][1];
    expect(input.smartReferences.refMods[0].name).toBe(f.name);
    expect(input.smartReferences.refMods[0].components).toBe("All");
    expect(input.smartReferences.referenceMap).toHaveLength(2);
    expect(input.smartReferences.referenceMap.find((item: {kind: string}) => item.kind === "audio")).toMatchObject({ characterKey: f.sidecar.characterId, voiceId: f.sidecar.voice.id });
    expect(input.prompt).toBe("The approved full video prompt.");
    expect(input.durationSeconds).toBe(10); expect(input.targetBackend).toBe("rtx3090");
    expect(input.quality).toBe(kind === "preview" ? "sh" : "hq");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(store.asset("owner", p.id, bundle.id).asset.metadata.libraryName).toBe(f.raw);
    expect(shot.takes).toEqual([]);
    fs.writeFileSync(f.sidecar.voice.path, "changed voice");
    await expect(startVideo(store, "owner", job)).rejects.toThrow();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
