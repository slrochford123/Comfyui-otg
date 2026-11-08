import {afterEach,beforeEach,expect,it,vi} from "vitest";
const fake=vi.hoisted(()=>({choice:vi.fn(),enqueue:vi.fn(),assertDispatch:vi.fn()}));
vi.mock("@/lib/mediaGpuRoutingServer",()=>({requestedMediaGpu:fake.choice}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({mediaQueueEnabled:()=>true,enqueueComfyMedia:fake.enqueue,assertComfyMediaDispatch:fake.assertDispatch}));
import {submitComfyPromptWithGpuLease} from "@/lib/workers/comfyPromptLease";
beforeEach(()=>{fake.choice.mockReset().mockResolvedValue("auto");fake.enqueue.mockReset().mockResolvedValue(Response.json({prompt_id:"queued"},{status:202}));});
afterEach(()=>vi.restoreAllMocks());
const args=()=>({baseUrl:"http://100.75.162.64:8188",workerId:"api-comfy",init:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:{"1":{class_type:"EmptyImage",inputs:{}}}})}});
it("queues an eligible media request without blocking its HTTP response",async()=>{expect((await submitComfyPromptWithGpuLease(args())).status).toBe(202);expect(fake.enqueue).toHaveBeenCalledOnce();});
it("refuses a dispatcher bypass without a persisted physical reservation",async()=>{
  fake.assertDispatch.mockImplementationOnce(()=>{throw Error("Missing durable reservation");});
  await expect(submitComfyPromptWithGpuLease({...args(),queueDispatch:true})).rejects.toThrow("durable reservation");
  expect(fake.enqueue).not.toHaveBeenCalled();
});
it("refuses to send a pinned request to a different physical GPU",async()=>{fake.choice.mockResolvedValue("rtx5060ti");const result=await submitComfyPromptWithGpuLease(args());expect(result.status).toBe(422);expect(fake.enqueue).not.toHaveBeenCalled();});
it("does not lose credentials by persisting an unsupported authenticated transport",async()=>{const request=args();request.init.headers={"content-type":"application/json",authorization:"secret"} as typeof request.init.headers;await expect(submitComfyPromptWithGpuLease(request)).rejects.toThrow("non-persistable");expect(fake.enqueue).not.toHaveBeenCalled();});
it("includes the plural Assets media adapter in the queue scope",async()=>{const request=args();request.workerId="api-assets-create-image";expect((await submitComfyPromptWithGpuLease(request)).status).toBe(202);expect(fake.enqueue).toHaveBeenCalledOnce();});
it.each(["production-storyboard","production-h3","comfy-voices","rife-upscale"])("queues the previously bypassed %s adapter",async workerId=>{const request=args();request.workerId=workerId;expect((await submitComfyPromptWithGpuLease(request)).status).toBe(202);expect(fake.enqueue).toHaveBeenCalledOnce();expect(fake.choice).not.toHaveBeenCalled();});
