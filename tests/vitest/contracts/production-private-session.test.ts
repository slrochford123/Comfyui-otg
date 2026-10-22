import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({authenticated:false,list:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/ownerKey",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("@/lib/ownerKey")>();
  return {...actual,getOwnerContext:async()=>{
    if(!state.authenticated)throw new actual.SessionInvalidError();
    return {ownerKey:"qa_signed_owner",scope:"user",username:"qa_signed_owner"};
  }};
});
vi.mock("@/lib/production/featureGate",()=>({isProductionFeatureEnabled:()=>true}));
vi.mock("@/lib/production/store",()=>({
  listProductions:state.list,saveProduction:state.save,
  getActiveProduction:vi.fn(),loadProduction:vi.fn(),deleteProduction:vi.fn(),summarizeProduction:()=>({}),
}));
beforeEach(()=>{state.authenticated=false;vi.clearAllMocks();state.list.mockReturnValue([]);state.save.mockReturnValue({id:"qa_new"});});
describe("Legacy Production requires a signed private owner",()=>{
  it("rejects unauthenticated list requests even with a supplied owner device label",async()=>{
    const {GET}=await import("@/app/api/production/route");
    const r=await GET(new NextRequest("http://localhost/api/production",{headers:{"x-otg-device-id":"qa_signed_owner"}}));
    expect(r.status).toBe(401);expect(state.list).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated mutations before parsing or touching storage",async()=>{
    const {POST}=await import("@/app/api/production/route");
    const r=await POST(new NextRequest("http://localhost/api/production",{method:"POST",body:"invalid-json"}));
    expect(r.status).toBe(401);expect(state.save).not.toHaveBeenCalled();
  });
  it("lists only the signed owner, ignoring conflicting client labels",async()=>{
    state.authenticated=true;const {GET}=await import("@/app/api/production/route");
    const r=await GET(new NextRequest("http://localhost/api/production?ownerKey=qa_foreign",{headers:{"x-otg-device-id":"qa_foreign"}}));
    expect(r.status).toBe(200);expect(state.list).toHaveBeenCalledWith("qa_signed_owner");
  });
  it("uses the signed owner for saves rather than the request payload owner",async()=>{
    state.authenticated=true;const {POST}=await import("@/app/api/production/route");
    const production={id:"qa_new",ownerKey:"qa_foreign",scenes:[]};
    const r=await POST(new NextRequest("http://localhost/api/production",{method:"POST",body:JSON.stringify({action:"save",production})}));
    expect(r.status).toBe(200);expect(state.save).toHaveBeenCalledWith("qa_signed_owner",production);
  });
});
