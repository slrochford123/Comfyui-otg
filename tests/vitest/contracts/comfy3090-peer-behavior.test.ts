import {describe,it,expect,vi} from "vitest";
import {releaseIdle3090Peer} from "@/lib/workers/comfy3090Peer";
describe("Shared 3090 peer cache safety",()=>{
  it("only unloads an idle fixed peer and confirms reclaimed allocator state",async()=>{
    const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith("/queue")?{queue_running:[],queue_pending:[]}:url.endsWith("/system_stats")?{devices:[{type:"cuda",torch_vram_total:100663296}]}:{}));
    await releaseIdle3090Peer("http://100.75.162.64:8189",fetcher);
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(["http://100.75.162.64:8188/queue","http://100.75.162.64:8188/free","http://100.75.162.64:8188/system_stats"]);
  });
  it("never frees or interrupts a busy peer",async()=>{
    const fetcher=vi.fn(async()=>Response.json({queue_running:[[1,"another-job"]],queue_pending:[]}));
    await expect(releaseIdle3090Peer("http://100.75.162.64:8188",fetcher)).rejects.toThrow("busy");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fails closed on unreadable queues",async()=>{
    const fetcher=vi.fn(async()=>Response.json({}));
    await expect(releaseIdle3090Peer("http://100.75.162.64:8189",fetcher)).rejects.toThrow("Cannot verify");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never applies the 3090 peer mapping to the 5060",async()=>{
    const fetcher=vi.fn();await releaseIdle3090Peer("http://100.98.212.116:8188",fetcher);expect(fetcher).not.toHaveBeenCalled();
  });
});
