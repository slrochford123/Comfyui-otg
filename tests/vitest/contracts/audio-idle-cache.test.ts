import { afterEach, describe, expect, it, vi } from "vitest";
import { audioMinimumVramMiB, prepareAudioGpuMemory } from "@/lib/audioEditing/gpuMemory";
afterEach(() => vi.unstubAllEnvs());
describe("admitted audio GPU memory preparation", () => {
  function fixture() {
    let free = 3000, busy = false, name = "NVIDIA GeForce RTX 5060 Ti";
    const assertOwned = vi.fn(async () => {});
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/queue")) return Response.json({queue_running: busy ? [[1,"user-job"]] : [], queue_pending: []});
      if (url.endsWith("/free")) { expect(JSON.parse(String(init?.body))).toEqual({unload_models:true,free_memory:true}); free=15000; return Response.json({}); }
      return Response.json({devices:[{name,type:"cuda",vram_free:free*1048576}]});
    });
    return { assertOwned, fetcher, setFree:(n:number)=>free=n, setBusy:()=>busy=true, setWrongGpu:()=>name="RTX 3090" };
  }
  it("never unloads caches when adequate memory is already available", async () => {
    const f=fixture();f.setFree(15000);await prepareAudioGpuMemory("rtx5060ti",12000,f.assertOwned,f.fetcher as typeof fetch);
    expect(f.fetcher.mock.calls.some(([u])=>u.endsWith("/free"))).toBe(false);
  });
  it("reclaims only idle caches under a verified grant and confirms memory recovery", async () => {
    const f=fixture();await prepareAudioGpuMemory("rtx5060ti",12000,f.assertOwned,f.fetcher as typeof fetch);
    expect(f.fetcher.mock.calls.filter(([u])=>u.endsWith("/free"))).toHaveLength(1);
    expect(f.assertOwned).toHaveBeenCalledTimes(3);
  });
  it.each(["busy","lost","wrong-gpu","unreachable"])("does not free anything when %s", async kind => {
    const f=fixture();if(kind==="busy")f.setBusy();if(kind==="wrong-gpu")f.setWrongGpu();
    if(kind==="lost")f.assertOwned.mockRejectedValue(Error("lost"));
    if(kind==="unreachable")f.fetcher.mockRejectedValue(Error("unreachable"));
    await expect(prepareAudioGpuMemory("rtx5060ti",12000,f.assertOwned,f.fetcher as typeof fetch)).rejects.toThrow();
    expect(f.fetcher.mock.calls.some(([u])=>u.endsWith("/free"))).toBe(false);
  });
  it("uses both 3090 worker queues and refuses if either has work", async () => {
    const fetcher=vi.fn(async (u:string)=>u.includes(":8189")?Response.json({queue_running:[[1]],queue_pending:[]}):u.endsWith("/queue")?Response.json({queue_running:[],queue_pending:[]}):Response.json({devices:[{name:"RTX 3090",type:"cuda",vram_free:1}]}));
    await expect(prepareAudioGpuMemory("rtx3090",12000,async()=>{},fetcher as typeof fetch)).rejects.toThrow(/active/);
    expect(fetcher.mock.calls.some(([u])=>u.endsWith("/free"))).toBe(false);
  });
  it("matches existing engine memory guards and leaves CPU mixing alone", () => {
    expect(audioMinimumVramMiB("speech",{})).toBe(12000);
    expect(audioMinimumVramMiB("speech",{},false)).toBe(18000);
    expect(audioMinimumVramMiB("music",{})).toBe(8000);
    expect(audioMinimumVramMiB("effects",{})).toBe(5500);
    expect(audioMinimumVramMiB("mix",{})).toBe(0);
  });
});
