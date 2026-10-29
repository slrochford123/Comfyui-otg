import fs from "node:fs";
import path from "node:path";
import {afterAll,describe,expect,it,vi} from "vitest";
const {root,voices}=vi.hoisted(()=>({root:require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(),"slr-audio-library-test-")),voices:[] as Array<{voiceId:string;name:string;refAudioRel:string}>}));
vi.mock("@/lib/paths",()=>({OTG_DATA_ROOT:root,safeSegment:(s:string)=>s}));
vi.mock("@/lib/voicesStudio",()=>({loadVoicesLibrary:()=>({voices}),voicesRoot:()=>path.join(root,"voices"),resolveVoicesFile:(s:string)=>{if(s.includes(".."))throw Error("escape");return path.join(root,"voices",s);}}));
import {audioLibrary} from "@/lib/audioEditing/library";
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
describe("Audio library ownership and metadata",()=>{
  it("retains generation lane and license across save and reimport",()=>{
    const dir=path.join(root,"edit_video/music/owner-a/library");fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,"effect.wav"),"fixture");fs.writeFileSync(path.join(dir,"effect.wav.json"),JSON.stringify({suggestedLane:"effects",license:"CC-BY-NC-4.0"}));
    expect(audioLibrary("owner-a")[0]).toMatchObject({suggestedLane:"effects",license:"CC-BY-NC-4.0"});
    expect(audioLibrary("owner-b")).toEqual([]);
  });
  it("rejects cross-owner, escaping and invalid voice references without hiding other items",()=>{
    const dir=path.join(root,"voices/samples/owner-a__qa");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"ref.wav"),"fixture");
    voices.push({voiceId:"owner-a__qa",name:"Original QA",refAudioRel:"samples/owner-a__qa/ref.wav"},
      {voiceId:"owner-b__qa",name:"Other",refAudioRel:"samples/owner-a__qa/ref.wav"},
      {voiceId:"owner-a__bad",name:"Invalid",refAudioRel:"../outside.wav"});
    const items=audioLibrary("owner-a");expect(items.filter(a=>a.origin==="Voice Library")).toHaveLength(1);
    expect(items.find(a=>a.origin==="Voice Library")).toMatchObject({name:"Original QA",suggestedLane:"speech"});
    expect(items).toHaveLength(2);
  });
});
