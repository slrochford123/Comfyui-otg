// @vitest-environment jsdom
import React from "react";
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import CharacterRefVoiceDesigner from "@/app/app/components/CharacterRefVoiceDesigner";
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
const engines=[{id:"qwen3",name:"Qwen3-TTS",available:true,detail:"Design"},{id:"cosy",name:"CosyVoice",available:true,detail:"Reference required"},{id:"h3",name:"H3 audio",available:false,detail:"Not qualified"}];
it("offers Qwen3 only even with stale engines; preview requires explicit approval",async()=>{
  const approve=vi.fn(),requests:Record<string,unknown>[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    if(init?.method==="POST"){const b=JSON.parse(init.body);requests.push(b);return Response.json({ok:true,audition:{job:"job1",status:"completed",message:"Ready",engine:"qwen3",description:b.description,text:b.text,audioUrl:"/owned/audition",progress:100,elapsedSeconds:2}});}
    return Response.json({ok:true,engines,audition:null});
  }));
  render(<CharacterRefVoiceDesigner cardId="card1" revision={7} disabled={false} onApprove={approve}/>);
  await waitFor(()=>expect(fetch).toHaveBeenCalled());expect(screen.getByText("Qwen3-TTS")).toBeTruthy();expect(requests).toHaveLength(0);
  expect(screen.queryByRole("combobox")).toBeNull();expect(screen.queryByText(/CosyVoice|H3 audio|AuK/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Describe the voice"),{target:{value:"Warm and kind"}});fireEvent.click(screen.getByRole("button",{name:"Generate voice"}));await screen.findByRole("button",{name:"Approve this voice"});
  expect(approve).not.toHaveBeenCalled();expect(requests[0]).toMatchObject({action:"generate",engine:"qwen3",revision:7});expect(document.querySelector("audio")?.src).toContain("/owned/audition");
  fireEvent.click(screen.getByRole("button",{name:"Approve this voice"}));expect(approve).toHaveBeenCalledWith("job1");expect(requests).toHaveLength(1);
  expect((screen.getByRole("button",{name:"Try another voice"}) as HTMLButtonElement).disabled).toBe(false);
});
it("restores an audition and description without starting another GPU job",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,engines,audition:{job:"saved",engine:"qwen3",description:"Low, warm voice",text:"Hello",status:"completed",message:"Ready",progress:100,elapsedSeconds:3,audioUrl:"/owned/saved"}})));
  localStorage.setItem("otg:refvoice:card2",JSON.stringify({engine:"cosy",description:"Low, warm voice",text:"Hello"}));
  render(<CharacterRefVoiceDesigner cardId="card2" revision={4} disabled={false} onApprove={()=>{}}/>);
  await waitFor(()=>expect(JSON.parse(localStorage.getItem("otg:refvoice:card2")!).engine).toBe("qwen3"));
  expect((screen.getByLabelText("Describe the voice") as HTMLTextAreaElement).value).toBe("Low, warm voice");
  expect(document.querySelector("audio")?.src).toContain("/owned/saved");
  expect(fetch).toHaveBeenCalledTimes(1);
});
