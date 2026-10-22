import {afterEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({release:vi.fn()}));
vi.mock("@/lib/workers/clusterGpu",()=>({acquireClusterGpuLease:()=>({ok:true,lease:{lockId:"gpu:slr-5060",ownerId:"qa",fencingToken:"qa"}}),releaseClusterGpuLease:state.release,detectShawnExternalOccupancy:async()=>({available:false}),SLR_GPU_LOCK_ID:"gpu:slr-5060",SHAWN_GPU_LOCK_ID:"gpu:shawn-3090",SLR_QWEN_URL:"http://qa-ollama",SHAWN_QWEN_URL:"http://qa-shawn-ollama",SLR_COMFY_URL:"http://qa-comfy",SHAWN_COMFY_URL:"http://qa-shawn-comfy"}));
afterEach(()=>{vi.unstubAllGlobals();state.release.mockClear();});
describe("Qwen durable pre-execution boundary",()=>{
 it("keeps a Comfy-busy refusal before durable Running and releases its unused GPU lease",async()=>{
  const running=vi.fn();const request=vi.fn(async()=>Response.json({queue_running:[[0,"another-job"]],queue_pending:[]}));vi.stubGlobal("fetch",request);
  const {qwenClusterFetch}=await import("@/lib/workers/qwenClusterRouter");
  await expect(qwenClusterFetch("/api/generate",{prompt:"QA"},{allowedNodes:["slr"],waitMs:0,keepAlive:0,onRouteAcquired:running})).rejects.toThrow("currently running or queued");
  expect(running).not.toHaveBeenCalled();expect(state.release).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();
 });
 it("commits Running immediately before the actual inference request",async()=>{
  const order:string[]=[];vi.stubGlobal("fetch",vi.fn(async(url:string)=>{if(url.endsWith("/queue"))return Response.json({queue_running:[],queue_pending:[]});if(url.endsWith("/free"))return Response.json({});order.push("ollama");return Response.json({response:"QA"});}));
  const {qwenClusterFetch}=await import("@/lib/workers/qwenClusterRouter");
  const r=await qwenClusterFetch("/api/generate",{prompt:"QA"},{allowedNodes:["slr"],waitMs:0,keepAlive:0,onRouteAcquired:()=>{order.push("running");}});
  expect(r.status).toBe(200);expect(order).toEqual(["ollama","running","ollama","ollama"]);expect(state.release).toHaveBeenCalledOnce();
 });
});
