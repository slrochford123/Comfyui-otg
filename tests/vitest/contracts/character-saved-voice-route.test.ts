import {NextRequest} from "next/server";
import {expect,it,vi} from "vitest";
const attach=vi.hoisted(()=>vi.fn(()=>({id:"character"})));
vi.mock("@/lib/ownerKey",()=>({getOwnerContext:async()=>({ownerKey:"alice"}),SessionInvalidError:class extends Error{}}));
vi.mock("@/lib/characters/savedVoice",()=>({attachSavedCharacterVoice:attach}));
vi.mock("@/lib/characters/store",async original=>({...await original<typeof import("@/lib/characters/store")>(),listCharacters:()=>[]}));
import {POST} from "@/app/api/characters/route";
it("uses the incoming Host behind a proxy and rejects a different Origin",async()=>{
 const request=(origin:string)=>new NextRequest("http://0.0.0.0:3001/api/characters",{method:"POST",headers:{host:"test.example",origin,"content-type":"application/json"},body:JSON.stringify({action:"attach_saved_voice",id:"character",voiceId:"alice__voice"})});
 expect((await POST(request("https://test.example"))).status).toBe(200);
 expect(attach).toHaveBeenCalledExactlyOnceWith("alice","character","alice__voice");
 expect((await POST(request("https://other.example"))).status).toBe(403);expect(attach).toHaveBeenCalledTimes(1);
});
