import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({authenticated:false}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:async()=>{const {getOwnerContext}=await import("@/lib/ownerKey");return getOwnerContext({} as NextRequest);}}));
vi.mock("@/lib/ownerKey",()=>{class SessionInvalidError extends Error{};return {SessionInvalidError,getOwnerContext:async()=>{if(!state.authenticated)throw new SessionInvalidError();return {ownerKey:"qa-owner"};}}});
vi.mock("@/app/api/file/route",()=>({GET:async(req:Request)=>{if(!state.authenticated)return Response.json({ok:false,error:"Unauthorized"},{status:401});return Response.json({ok:false,error:"Not found"},{status:404});}}));
beforeEach(()=>{state.authenticated=false;});
describe("Character voice endpoint authorization",()=>{
 it("denies unauthenticated Voice FX before parsing paths or spawning a worker",async()=>{const {POST}=await import("@/app/api/characters/voice-fx/route");const r=await POST(new NextRequest("http://localhost/api/characters/voice-fx",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inputPath:"/qa/private.wav"})}));expect(r.status).toBe(401);});
 it("denies an authenticated but unowned source without disclosing its path",async()=>{state.authenticated=true;const {POST}=await import("@/app/api/characters/voice-fx/route");const r=await POST(new NextRequest("http://localhost/api/characters/voice-fx",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inputPath:"/qa/another-owner/private.wav",deviceId:"another-owner"})}));expect(r.status).toBe(404);expect(await r.text()).not.toContain("another-owner");});
 it("requires authentication on the legacy voice-file URL",async()=>{const {GET}=await import("@/app/api/characters/voice-file/route");expect((await GET(new NextRequest("http://localhost/api/characters/voice-file?path=uploads/voices/qa.wav"))).status).toBe(401);});
});
