import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {randomBytes} from "node:crypto";
import {NextRequest} from "next/server";
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{throw Error("Missing session");}}));
let credential="";
beforeAll(()=>{credential=randomBytes(32).toString("hex");vi.stubEnv("OTG_WORKER_TOKEN",credential);vi.stubEnv("OTG_WORKER_PREVIOUS_TOKEN_FILE","");});
afterAll(()=>vi.unstubAllEnvs());
const request=(token="",owner="qa_dataset_owner")=>{
  const form=new FormData();return new NextRequest("http://localhost/api/ollama-ai/transcribe",{method:"POST",headers:{"x-otg-owner-key":owner,...(token?{authorization:`Bearer ${token}`}:{})},body:form});
};
describe("Dataset transcription accepts only authenticated workers or browser sessions",()=>{
  it("denies an anonymous owner header without leaking server details",async()=>{
    const {POST}=await import("@/app/api/ollama-ai/transcribe/route");const r=await POST(request());expect(r.status).toBe(401);expect(await r.json()).toEqual({ok:false,error:"Unauthorized"});
  });
  it("denies an invalid worker credential",async()=>{
    const {POST}=await import("@/app/api/ollama-ai/transcribe/route");expect((await POST(request("invalid"))).status).toBe(401);
  });
  it("requires an explicit safe worker owner",async()=>{
    const {POST}=await import("@/app/api/ollama-ai/transcribe/route");expect((await POST(request(credential,"../qa"))).status).toBe(400);
  });
  it("allows a valid internal worker through to normal audio validation",async()=>{
    const {POST}=await import("@/app/api/ollama-ai/transcribe/route");const r=await POST(request(credential));expect(r.status).toBe(400);expect(await r.json()).toEqual({ok:false,error:"Missing audio file"});
  });
});
