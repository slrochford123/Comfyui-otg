import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const state=vi.hoisted(()=>({target:{id:"qa-admin-id",email:"qa-admin@example.com",username:"qa-admin"},run:vi.fn(()=>({changes:1}))}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:"qa-session"})})}));
vi.mock("@/lib/auth/jwt",()=>({verifySession:async()=>({email:"qa-admin@example.com",username:"qa-admin"})}));
vi.mock("@/lib/auth/db",()=>({ensureMigrations:()=>{},db:{prepare:()=>({get:()=>state.target,all:()=>[state.target],run:state.run})}}));
beforeAll(()=>vi.stubEnv("ADMIN_IDENTIFIERS","qa-admin@example.com"));
afterAll(()=>vi.unstubAllEnvs());
describe("Administrator deletion lockout protection",()=>{
 it("marks the configured Admin protected in the account list",async()=>{
   const {GET}=await import("@/app/api/admin/users/route");const response=await GET(new NextRequest("http://localhost/api/admin/users"));
   expect((await response.json()).users[0].protected).toBe(true);
 });
 it("refuses current configured Admin deletion before any SQL mutation",async()=>{
   const {DELETE}=await import("@/app/api/admin/users/route");const response=await DELETE(new NextRequest("http://localhost/api/admin/users",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id:state.target.id})}));
   expect(response.status).toBe(400);expect(state.run).not.toHaveBeenCalled();
 });
});
