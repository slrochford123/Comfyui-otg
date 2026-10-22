import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({job:{id:"qa-job",ownerKey:"qa",productionId:"qa-production",sceneId:"qa-scene",backend:"rtx3090",comfyPromptId:"qa-prompt",status:"running"},cancel:vi.fn(),terminal:vi.fn()}));
vi.mock("@/lib/ownerKey",()=>({getOwnerContext:async()=>({ownerKey:"qa"}),SessionInvalidError:class extends Error{}}));
vi.mock("@/lib/production/featureGate",()=>({isProductionFeatureEnabled:()=>true}));
vi.mock("@/lib/production/v2Store",()=>({productionV2Store:{load:()=>({id:"qa-production",status:"draft",scenes:[{id:"qa-scene"}]})}}));
vi.mock("@/lib/production/h3GenerationJobs",()=>({getProductionV2GenerationJob:()=>state.job,getLatestProductionV2SceneGeneration:()=>state.job}));
vi.mock("@/lib/production/h3GenerationScheduler",()=>({cancelProductionV2H3Generation:state.terminal,productionV2GenerationPublicStatus:(j:unknown)=>j}));
vi.mock("@/lib/comfySafeCancel",()=>({cancelComfyPrompt:state.cancel,ComfyCancelSafetyError:class extends Error{}}));
function request(){return new NextRequest("http://localhost:3001/api/production/v2/generation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cancel",productionId:"qa-production",sceneId:"qa-scene",jobId:"qa-job"})});}
beforeEach(()=>{state.job.sceneId="qa-scene";state.cancel.mockReset();state.terminal.mockReset();state.terminal.mockReturnValue({...state.job,status:"canceled"});});
describe("Production confirmed cancellation boundary",()=>{
 it("rejects a different scene's job before touching any worker",async()=>{state.job.sceneId="another-scene";const {POST}=await import("@/app/api/production/v2/generation/route");expect((await POST(request())).status).toBe(409);expect(state.cancel).not.toHaveBeenCalled();expect(state.terminal).not.toHaveBeenCalled();});
 it("does not mark terminal while the backend remains running",async()=>{state.cancel.mockResolvedValue({status:"canceling"});const {POST}=await import("@/app/api/production/v2/generation/route");const r=await POST(request());expect(r.status).toBe(202);expect((await r.json()).job.status).toBe("running");expect(state.terminal).not.toHaveBeenCalled();});
 it("marks canceled only after backend confirmation",async()=>{state.cancel.mockResolvedValue({status:"canceled"});const {POST}=await import("@/app/api/production/v2/generation/route");expect((await POST(request())).status).toBe(200);expect(state.cancel).toHaveBeenCalledWith(expect.stringContaining(":8189"),"qa-prompt");expect(state.terminal).toHaveBeenCalledOnce();});
});
