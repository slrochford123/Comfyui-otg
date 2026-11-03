// @vitest-environment jsdom
import React from "react";
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import EditVideoVoiceDubbingPanel,{type VoiceModel} from "@/app/app/components/EditVideoVoiceDubbingPanel";
import CharacterRefVoiceControls from "@/app/app/components/CharacterRefVoiceControls";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const target:VoiceModel={id:"refmod:one",name:"Bunny · saved RefMod voice",engine:"seed-vc",path:"/owned/immutable.wav",samplePath:"/owned/immutable.wav",displayPath:"Saved",usable:true};
it("previews, selects and removes the saved recording without making generation calls",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({voices:[{id:"library:one",name:"Bunny"}]})));
  const onChoose=vi.fn(),onRemove=vi.fn();render(<CharacterRefVoiceControls voice={{id:"one",name:"Bunny",url:"/owned/voice",durationSeconds:3}} disabled={false} onChoose={onChoose} onRemove={onRemove} onUpload={()=>{}}/>);
  await screen.findByRole("option",{name:"Bunny"});fireEvent.change(screen.getByRole("combobox"),{target:{value:"library:one"}});expect(onChoose).toHaveBeenCalledWith("library:one");fireEvent.click(screen.getByRole("button",{name:"Remove voice"}));expect(onRemove).toHaveBeenCalledOnce();expect(document.querySelector("audio")?.src).toContain("/owned/voice");expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([1,2])("requires explicit speaker assignment for %i lanes and sends the pinned voice to Seed-VC, never auto fallback",async(count)=>{
  const sent:Record<string,any>[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith("/models"))return Response.json({ok:true,items:[]});
    if(url.endsWith("/analyze-clip"))return Response.json({ok:true,sourcePath:"/owned/video.mp4",sourceFileName:"video.mp4",durationSeconds:3,voices:Array.from({length:count},(_,i)=>({id:"lane"+i,label:"Speaker "+(i+1),segments:[{start:i,end:i+1}],segmentCount:1,totalSpeechSeconds:1}))});
    if(url.endsWith("/dub-preview")){sent.push(JSON.parse(String(init?.body)));return Response.json({ok:true,previewVideoUrl:"/owned/corrected.mp4"});}
    throw Error("Unexpected call "+url);
  }));
  render(<EditVideoVoiceDubbingPanel initialSource={{path:"/owned/video.mp4",name:"video.mp4",url:"/owned/video"}} characterVoiceTargets={[target]}/>);
  await waitFor(()=>expect(fetch).toHaveBeenCalled());fireEvent.click(screen.getByRole("button",{name:"Analyze Speech"}));
  const picker=await screen.findByRole("combobox",{name:"Target voice for Speaker 1"});
  expect((picker as HTMLSelectElement).value).toBe(count===1?target.id:"");
  if(count===2)for(let i=0;i<count;i++)fireEvent.change(screen.getByRole("combobox",{name:"Target voice for Speaker "+(i+1)}),{target:{value:target.id}});
  const button=screen.getByRole("button",{name:/Convert.*Voice/i});fireEvent.click(button);
  await waitFor(()=>expect(sent).toHaveLength(1));expect(sent[0].voiceMappings).toHaveLength(count);
  for(const mapping of sent[0].voiceMappings)expect(mapping).toMatchObject({engine:"seed-vc",samplePath:target.path,voicePath:target.path,dubMode:"preserve_performance"});
});
