import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {createHash} from "node:crypto";
const state=vi.hoisted(()=>({sidecar:null as any,character:null as any,entries:[] as any[]}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:vi.fn(async()=>({ownerKey:"test-owner"}))}));
vi.mock("@/lib/production/h3Workflows",()=>({H3_BACKEND_PROFILES:{rtx5060ti:{baseUrl:"http://qualified-worker.invalid"}}}));
vi.mock("@/lib/h3SpecialModes/refModCreation",()=>({readH3RefModSidecar:vi.fn(()=>state.sidecar)}));
vi.mock("@/lib/h3SpecialModes/characterRefCardAvailability",()=>({characterRefCardsEnabled:()=>true}));
vi.mock("@/lib/h3SpecialModes/refModTrash",()=>({refModIsDeleted:()=>false}));
vi.mock("@/lib/characters/store",()=>({loadCharacter:vi.fn(()=>state.character)}));
import {GET} from "@/app/api/h3/special/refmods/library/route";
import {loadCharacter} from "@/lib/characters/store";
const ownerHash=createHash("sha256").update("test-owner").digest("hex").slice(0,24);
const prefix="characters/slr-test-cards/"+ownerHash+"/";
const workspace="718a20ce-05cd-4b1f-9988-e04420281a65";
async function get(){const response=await GET(new NextRequest("http://localhost/api/h3/special/refmods/library?backend=rtx5060ti"));expect(response.status).toBe(200);return response.json();}
describe("Extracted character RefMod library links",()=>{
 beforeEach(()=>{vi.clearAllMocks();state.sidecar={ownerKey:"test-owner",jobId:"encoder-job",characterId:"character-id",name:"Firefighter Tiger",sourceAssets:[{path:"/owned/source.png"}]};state.character={id:"character-id",imagePath:"/owned/front.png",characterCardPath:"/owned/five-view card.png"};state.entries=[{name:prefix+"extracted-"+workspace+"/bundle",kind:"video",shape:[5,64,36],tokens:2880}];vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(state.entries),{status:200})));});
 afterEach(()=>vi.unstubAllGlobals());
 it("links the approved durable sheet through the existing owned-file route",async()=>{const body=await get();expect(body.entries).toHaveLength(1);const entry=body.entries[0];expect(entry.characterId).toBe("character-id");expect(entry.previewPath).toBe("/api/file?path="+encodeURIComponent("/owned/five-view card.png"));expect(entry.editableCardId).toBeUndefined();expect(loadCharacter).toHaveBeenCalledWith("test-owner","character-id");});
 it("uses the current saved character name after a rename",async()=>{state.character.name="John – Young";const body=await get();expect(body.entries[0].displayName).toBe("John – Young");expect(body.entries[0].characterId).toBe("character-id");});
 it("uses the character image when no stitched sheet is present",async()=>{state.character.characterCardPath=undefined;const body=await get();expect(body.entries[0].previewPath).toBe("/api/file?path="+encodeURIComponent("/owned/front.png"));});
 it("retains owned source evidence if the character record is unavailable",async()=>{state.character=null;const body=await get();expect(body.entries[0].previewPath).toBe("/api/file?path="+encodeURIComponent("/owned/source.png"));expect(body.entries[0].editableCardId).toBeUndefined();});
 it("keeps the existing independent RefMod-card editor and preview route",async()=>{state.entries[0].name=prefix+workspace+"/bundle";const body=await get();expect(body.entries[0].editableCardId).toBe("encoder-job");expect(body.entries[0].previewPath).toBe("/api/h3/special/refmods/character-card?id=encoder-job&preview=1");expect(loadCharacter).not.toHaveBeenCalled();});
 it("does not expose another owner's private RefMod",async()=>{state.entries[0].name="characters/slr-test-cards/another-owner/extracted-"+workspace+"/bundle";const body=await get();expect(body.entries).toEqual([]);expect(loadCharacter).not.toHaveBeenCalled();});
});
