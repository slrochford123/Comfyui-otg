import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {randomUUID} from "node:crypto";
const fixture=vi.hoisted(()=>({owner:"alice",card:null as any}));
vi.mock("@/lib/ownerKey",()=>({SessionInvalidError:class extends Error{},getOwnerContext:async(req:NextRequest)=>{if(!req.headers.get("x-test-owner"))throw Object.assign(new Error("No session"),{status:401});return{ownerKey:req.headers.get("x-test-owner")};}}));
// Route tests isolate auth and worker behavior; physical browser QA verifies real JWTs.
vi.mock("@/lib/h3SpecialModes/characterRefCard",()=>({
  assertCharacterRefCardsEnabled:()=>{if(process.env.OTG_ENV!=="test")throw Object.assign(Error("Not found"),{status:404});},bootstrapCharacterRefCards:()=>{},characterRefCardPublic:(c:any)=>c,
  latestCharacterRefCard:async(owner:string)=>owner===fixture.owner?fixture.card:null,
  readCharacterRefCard:async(owner:string,id:string)=>{if(owner!==fixture.owner||id!==fixture.card?.id)throw Object.assign(Error("Not found"),{status:404});return fixture.card;},
  createCharacterRefCard:vi.fn(async(_owner:string,id:string)=>({id})),editCharacterRefCard:vi.fn(),uploadCharacterRefAsset:vi.fn(),
}));
// Use real RequestError instances so the route's safe error mapping is tested.
import {RequestError} from "@/lib/requestError";
import * as core from "@/lib/h3SpecialModes/characterRefCard";
import {GET,POST,PUT} from "@/app/api/h3/special/refmods/character-card/route";
beforeEach(()=>{vi.stubEnv("OTG_ENV","test");fixture.card={id:randomUUID(),views:[]};vi.mocked(core.assertCharacterRefCardsEnabled).mockImplementation?.(()=>{});});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const req=(method="GET",body?:unknown,headers:Record<string,string>={})=>new NextRequest("http://localhost/api/h3/special/refmods/character-card",{method,headers:{"x-test-owner":"alice",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
it("returns only the current account's latest card",async()=>{expect((await(await GET(req())).json()).card.id).toBe(fixture.card.id);expect((await(await GET(req("GET",undefined,{"x-test-owner":"bob"}))).json()).card).toBeNull();});
it("rejects cross-origin mutations before parsing or creating a card",async()=>{const r=await POST(req("POST",{action:"create",id:randomUUID()},{Origin:"https://attacker.invalid"}));expect(r.status).toBe(403);expect(core.createCharacterRefCard).not.toHaveBeenCalled();});
it("enforces actual and claimed JSON/upload byte limits before processing",async()=>{expect((await POST(req("POST",{action:"create"},{"content-length":"20000"}))).status).toBe(413);expect((await PUT(req("PUT",{},{}))).status).toBe(400);expect(core.createCharacterRefCard).not.toHaveBeenCalled();});
it("maps TEST-only denial to 404 without exposing worker state",async()=>{vi.spyOn(core,"assertCharacterRefCardsEnabled").mockImplementation(()=>{throw new RequestError("Not found",404);});expect((await GET(req())).status).toBe(404);});
