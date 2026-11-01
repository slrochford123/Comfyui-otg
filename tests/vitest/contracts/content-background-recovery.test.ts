import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ direct: vi.fn(), reconcile: vi.fn(), directGallery: vi.fn(), refmods: vi.fn(), realism: vi.fn(), swap: vi.fn(), specialGallery: vi.fn(), native: vi.fn(), sync: vi.fn(), queue: vi.fn(),cancelQueued:vi.fn() }));
vi.mock("@/lib/h3DirectJobs", () => ({ ensureH3DirectJobRunner: m.direct, reconcileH3StudioSubmission: m.reconcile, saveH3DirectJobToGallery: m.directGallery }));
vi.mock("@/lib/h3SpecialModes/refModsJobs", () => ({ ensureH3RefModsJobRunner: m.refmods, saveH3RefModsJobToGallery: m.specialGallery }));
vi.mock("@/lib/h3SpecialModes/realismJobs", () => ({ ensureH3RealismJobRunner: m.realism, saveH3RealismJobToGallery: m.specialGallery }));
vi.mock("@/lib/h3SpecialModes/bodySwapJobs", () => ({ ensureH3BodySwapJobRunner: m.swap, saveH3BodySwapJobToGallery: m.specialGallery }));
vi.mock("@/lib/images/nativeImageJobs", () => ({ reconcileNativeImageJob: m.native }));
vi.mock("@/lib/comfyGallerySync", () => ({ syncPromptOutputsForOwner: m.sync }));
vi.mock("@/lib/workers/mediaGpuQueue", () => ({ getMediaQueueJob: m.queue,cancelQueuedMediaJob:m.cancelQueued }));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-background-content-"));
vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_ENV", "test");
const recovery = await import("@/lib/workers/contentCreationRecovery");
async function record(relative: string, value: unknown) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(value)); }
const job = (ownerKey = "alice", gpu = "rtx3090") => ({ id: "h3-direct-" + randomUUID(), ownerKey, status: "running", promptId: randomUUID(), backend: gpu, input: {targetBackend: gpu} });
beforeEach(async () => { recovery.closeContentCreationRecoveryForTests(); vi.clearAllMocks(); m.queue.mockReset(); vi.stubEnv("OTG_ENV", "test"); await fs.rm(root, {recursive:true,force:true}); await fs.mkdir(root); m.sync.mockResolvedValue({status:"synced"}); });
afterAll(async () => { recovery.closeContentCreationRecoveryForTests(); vi.unstubAllEnvs(); await fs.rm(root, {recursive:true,force:true}); });
describe("server-owned completion without any browser status request", () => {
  it.each(["rtx3090", "rtx5060ti"])("resumes the exact accepted %s job and owner after server startup", async gpu => {
    const saved = job("alice", gpu); await record(`h3-direct/alice/jobs/${saved.id}.json`, saved);
    await recovery.tickContentCreationRecovery(); expect(m.direct).toHaveBeenCalledWith(saved);
  });
  it("repairs pending Gallery publication without submitting another render", async () => {
    const saved = {...job(),status:"completed",galleryStatus:"saving",outputPath:"/owned/result.mp4"}; await record(`h3-direct/alice/jobs/${saved.id}.json`,saved);
    await recovery.tickContentCreationRecovery(); expect(m.direct).not.toHaveBeenCalled(); expect(m.directGallery).toHaveBeenCalledWith(saved);
  });
  it.each(["queued","unknown","running"])("reconciles a failed parent with a legacy %s queue row without dropping accepted GPU ownership",async status=>{
    const saved={...job(),status:"failed",clientId:"original-client"};await record(`h3-direct/alice/jobs/${saved.id}.json`,saved);
    m.queue.mockReturnValue({id:saved.promptId,kind:"comfy",gpu:"rtx3090",status,payload:{baseUrl:"http://100.75.162.64:8189",workerId:"h3-direct",body:{client_id:saved.clientId}}});
    await recovery.tickContentCreationRecovery();expect(m.cancelQueued).toHaveBeenCalledTimes(status==="queued"?1:0);expect(m.direct).not.toHaveBeenCalled();
  });
  it.each([["refmods-generation","refmods"],["realism","realism"],["body-swap","swap"]] as const)("resumes accepted %s videos", async (directory, key) => {
    const saved = job(); await record(`h3-special/${directory}/alice/jobs/${saved.id}.json`, saved);
    await recovery.tickContentCreationRecovery(); expect(m[key]).toHaveBeenCalledWith(saved);
  });
  it("does not resubmit ambiguous special-mode preparation", async () => {
    const saved = {...job(),status:"preparing",promptId:null}; await record(`h3-special/refmods-generation/alice/jobs/${saved.id}.json`, saved);
    await recovery.tickContentCreationRecovery(); expect(m.refmods).not.toHaveBeenCalled();
  });
  it("reconciles an uncertain direct acceptance before starting a collector", async () => {
    const saved = {...job(),status:"failed",promptId:null,studioSubmissionState:"unknown"}; const accepted={...saved,status:"submitted",promptId:randomUUID()};m.reconcile.mockResolvedValue(accepted);
    await record(`h3-direct/alice/jobs/${saved.id}.json`,saved);await recovery.tickContentCreationRecovery();expect(m.reconcile).toHaveBeenCalledWith("alice",saved.id);expect(m.direct).toHaveBeenCalledWith(accepted);
  });
  it("collects an image and retries its requested Gallery save without a GET", async () => {
    const id=randomUUID();await record(`native-image-jobs/alice/${id}.json`,{id,promptId:randomUUID(),status:"queued"});await recovery.tickContentCreationRecovery();expect(m.native).toHaveBeenCalledWith("alice",id);
  });
  it("saves Generate outputs using their recorded worker and owner", async () => {
    const promptId=randomUUID();const meta={ownerKey:"alice",promptId,comfyBaseUrl:"http://100.98.212.116:8188",username:"alice",deviceId:"phone",backgroundSync:"pending"};await record(`prompt_request_meta/alice/${promptId}.json`,meta);await recovery.tickContentCreationRecovery();expect(m.sync).toHaveBeenCalledWith(expect.objectContaining({ownerKey:"alice",promptId,comfyBaseUrl:meta.comfyBaseUrl}));expect(JSON.parse(await fs.readFile(path.join(root,`prompt_request_meta/alice/${promptId}.json`),"utf8")).backgroundSync).toBe("synced");
  });
  it("does not import another owner's record, completed history, or native private previews", async () => {
    const saved=job("bob");await record(`h3-direct/alice/jobs/${saved.id}.json`,saved);
    for(const patch of [{ownerKey:"bob",backgroundSync:"pending"},{ownerKey:"alice",backgroundSync:"synced"},{ownerKey:"alice",requestKind:"native-image",backgroundSync:"pending"}]){const promptId=randomUUID();await record(`prompt_request_meta/alice/${promptId}.json`,{promptId,comfyBaseUrl:"http://100.75.162.64:8189",...patch});}
    await recovery.tickContentCreationRecovery();expect(m.direct).not.toHaveBeenCalled();expect(m.sync).not.toHaveBeenCalled();
  });
  it("ignores symlinks, corrupt records and filename/identity mismatches", async () => {
    const saved=job();await record(`outside/${saved.id}.json`,saved);await fs.mkdir(path.join(root,"h3-direct/alice/jobs"),{recursive:true});await fs.symlink(path.join(root,`outside/${saved.id}.json`),path.join(root,`h3-direct/alice/jobs/${saved.id}.json`));await record("h3-direct/alice/jobs/mismatch.json",job());await recovery.tickContentCreationRecovery();expect(m.direct).not.toHaveBeenCalled();
  });
  it("starts once per Node process and does not require an open page", async () => {
    const saved=job();await record(`h3-direct/alice/jobs/${saved.id}.json`,saved);recovery.bootstrapContentCreationRecovery();recovery.bootstrapContentCreationRecovery();await vi.waitFor(()=>expect(m.direct).toHaveBeenCalledTimes(1));
  });
});
