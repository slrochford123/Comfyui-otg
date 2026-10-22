import {describe,it,expect,vi} from "vitest";
import {with3090QueueStatus} from "@/lib/workers/maintenanceStatus";
const status=()=>({services:{comfy8188:{state:"active",http:"ready"},h38189:{state:"active",http:"ready"}}});
describe("Admin readiness includes actual fixed-worker queues",()=>{
 it("reports busy only for the worker with queued or running execution",async()=>{
  const fetcher=vi.fn(async(url:string|URL|Request)=>Response.json(String(url).includes(":8189")?{queue_running:[[1,"qa-job"]],queue_pending:[]}:{queue_running:[],queue_pending:[]}));
  const result=await with3090QueueStatus(status(),fetcher);expect(result.services.h38189.http).toBe("busy");expect(result.services.comfy8188.http).toBe("ready");
 });
 it("never reports readiness for an unreadable queue",async()=>{
  const result=await with3090QueueStatus(status(),vi.fn(async()=>Response.json({})));expect(result.services.comfy8188.http).toBe("unverified");expect(result.services.h38189.http).toBe("unverified");
 });
 it("does not call other hosts or mutate the original status",async()=>{
  const original=status();const fetcher=vi.fn(async(_url:string|URL|Request)=>Response.json({queue_running:[],queue_pending:[]}));
  await with3090QueueStatus(original,fetcher);expect(fetcher.mock.calls.map(c=>String(c[0])).sort()).toEqual(["http://100.75.162.64:8188/queue","http://100.75.162.64:8189/queue"]);expect(original).toEqual(status());
 });
});
