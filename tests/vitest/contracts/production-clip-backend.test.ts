import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({inspect:vi.fn(),prefer:vi.fn()}));
vi.mock("@/lib/h3SmartReferencesServer",()=>({inspectH3SmartReferences:m.inspect,ownedH3SmartCapabilities:(c:unknown)=>c}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({preferMediaGpu:m.prefer}));
import {selectClipReferenceBackend} from "@/lib/productionStudio/clipReferenceBackend";
const cap=(gpu:string,mixed:boolean)=>({backend:gpu,available:true,firstFrame:true,mixedReferences:mixed,maxImages:9,maxVideos:3,maxAudios:3,maxTotalReferenceMedia:12,maxRefModSlots:8,referenceTokenBudget:null,refMods:[{name:"Ava",kind:"bundle",members:[{kind:"video",tokens:100},{kind:"audio",tokens:20}]}]});
const selection={useFirstFrame:false,refMods:[{name:"Ava",strength:1,components:"All",visualStrength:1,audioStrength:1,copies:1}]};
beforeEach(()=>{vi.clearAllMocks();m.inspect.mockImplementation(async gpu=>cap(gpu,gpu==="rtx3090"));m.prefer.mockImplementation(async g=>g[0]||null);});
describe("Clip reference compatibility before GPU preference",()=>{
 it("queues the compatible 3090 for mixed images/RefMods instead of choosing an incompatible idle 5060 Ti",async()=>{expect(await selectClipReferenceBackend(selection,[{name:"Bathroom",description:"Location"}],0,0,false,"owner")).toBe("rtx3090");expect(m.prefer).toHaveBeenCalledWith(["rtx3090"]);});
 it("allows compatible 5060 Ti fallback for a RefMod-only clip",async()=>{m.prefer.mockImplementation(async g=>g.includes("rtx5060ti")?"rtx5060ti":g[0]);expect(await selectClipReferenceBackend(selection,[],0,0,false,"owner")).toBe("rtx5060ti");expect(m.prefer).toHaveBeenCalledWith(["rtx3090","rtx5060ti"]);});
 it("rejects unsupported RefMod/video mixtures without selecting or substituting a worker",async()=>{await expect(selectClipReferenceBackend(selection,[],1,0,false,"owner")).rejects.toThrow("No worker qualifies");expect(m.prefer).toHaveBeenCalledWith([]);});
 it("rejects missing guide nodes for actual first-frame requests",async()=>{m.inspect.mockImplementation(async gpu=>({...cap(gpu,true),firstFrame:false}));await expect(selectClipReferenceBackend({...selection,useFirstFrame:true},[],0,0,true,"owner")).rejects.toThrow("First Frame");});
});
