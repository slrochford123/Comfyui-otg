import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({target:{username:"qa-target"} as {username:string}|null,reset:vi.fn(()=>({status:"idle"}))}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:"qa-session"})})}));
vi.mock("@/lib/auth/jwt",()=>({verifySession:async()=>({email:"qa-admin@example.com",username:"qa-admin"})}));
vi.mock("@/lib/auth/db",()=>({ensureMigrations:()=>{},db:{prepare:()=>({get:()=>state.target})}}));
vi.mock("@/lib/contentState",()=>({resetState:state.reset}));
beforeAll(()=>vi.stubEnv("ADMIN_IDENTIFIERS","qa-admin@example.com"));afterAll(()=>vi.unstubAllEnvs());
beforeEach(()=>{state.target={username:"qa-target"};state.reset.mockClear();});
async function call(username:string){const {POST}=await import("@/app/api/admin/reset-state/route");return POST(new NextRequest("http://localhost/api/admin/reset-state",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:"qa-stable-id",username})}));}
describe("Admin reset resolves stable target before mutation",()=>{
 it("rejects a mismatched label instead of resetting a different user",async()=>{expect((await call("qa-other" )).status).toBe(400);expect(state.reset).not.toHaveBeenCalled();});
 it("rejects a missing stable ID",async()=>{state.target=null;expect((await call("qa-target")).status).toBe(404);expect(state.reset).not.toHaveBeenCalled();});
 it("resets the exact database-resolved user",async()=>{expect((await call("qa-target")).status).toBe(200);expect(state.reset).toHaveBeenCalledWith("qa-target");});
});
