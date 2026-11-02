// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import H3NsfwStudio from "@/app/app/components/H3NsfwStudio";
import {DEFAULT_LAB_SETTINGS,EXPERIMENTS} from "@/lib/experiments/catalog";
import {readNsfwDraft} from "@/lib/client/h3NsfwDraft";
let session:any,jobs:any[],server:ReturnType<typeof vi.fn>;
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const posts=(action:string)=>server.mock.calls.filter(([,o])=>o?.body&&JSON.parse(o.body).action===action);
beforeEach(()=>{
 vi.stubGlobal("React",React);localStorage.clear();let counter=0;vi.stubGlobal("crypto",{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(++counter);return bytes;}});
 session={id:"saved-draft",experiment:"prism-pika",title:"Draft",notes:"",archived:false,revision:1,created:"2026-11-02",updated:"2026-11-02",assets:[],settings:{...DEFAULT_LAB_SETTINGS,mode:"text",prompt:"A paper boat.",selectedSources:[]}};jobs=[];
 server=vi.fn(async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;
  if(String(url).includes("?jobs="))return response({session,jobs});
  if(body?.action==="update"){session={...body,revision:session.revision+1};return response({session});}
  if(body?.action==="create")return response({session});
  if(body?.action==="generate")return response({job:{id:body.requestId,model:session.experiment,state:"queued",created:Date.now()/1000,stage:"Queued"}});
  if(String(url).includes("/nsfw/prompt"))return response(body?{id:body.requestId,status:"queued"}:{status:"completed",prompt:"A paper boat in cinematic light."});
  if(url==="/api/openai-ai/h3-director")return response({prompt:"An illustrated paper boat.",reply:"Kept your controls.",conversationId:"director-memory"});
  return response({catalog:EXPERIMENTS.filter(e=>e.kind==="h3-admin"),sessions:[session],capabilities:EXPERIMENTS.filter(e=>e.kind==="h3-admin").map(e=>({model:e.id,modes:["text","image","reference","edit","edit-image"],recipe:{steps:8}})),loras:[{id:"style-3d",displayName:"3D style",minStrength:0,maxStrength:1,defaultStrength:.6,triggerWords:["3dsrx"],models:["prism-pika"]}]});
 });vi.stubGlobal("fetch",server);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function setup(ownerKey="account-a"){const view=render(<H3NsfwStudio ownerKey={ownerKey}/>);await screen.findByLabelText("Your scene");return view;}
it("saves edits immediately before autosave, restores controls and references, and never renders on resume",async()=>{
 session.settings.mode="reference";session.settings.selectedSources=["source-one"];session.assets=[{id:"source-one",name:"boat.png",mime:"image/png",role:"source"}];
 let view=await setup();fireEvent.change(screen.getByLabelText("Your scene"),{target:{value:"My last keystroke before the call"}});fireEvent.click(screen.getByText("H3 Prompter · Style & camera"));fireEvent.change(screen.getByLabelText("H3 visual style"),{target:{value:"anime"}});fireEvent.change(screen.getByLabelText("Duration in seconds"),{target:{value:"9"}});fireEvent.click(screen.getByText("H3 LoRAs"));fireEvent.change(screen.getByLabelText("Add H3 LoRA"),{target:{value:"style-3d"}});view.unmount();
 expect(readNsfwDraft("account-a")?.editor.settings.prompt).toBe("My last keystroke before the call");view=await setup();
 expect(screen.getByLabelText("Your scene")).toHaveValue("My last keystroke before the call");expect(screen.getByLabelText("H3 visual style")).toHaveValue("anime");expect(screen.getByLabelText("Duration in seconds")).toHaveValue("9");expect(screen.getByRole("article",{name:"Reference boat.png"})).toBeVisible();expect(screen.getByLabelText("Strength 3D style")).toHaveValue("0.6");expect(posts("generate")).toHaveLength(0);
});
it("never reads another account's recovered draft",async()=>{
 const view=await setup();fireEvent.change(screen.getByLabelText("Your scene"),{target:{value:"Account A private words"}});view.unmount();await setup("account-b");expect(screen.getByLabelText("Your scene")).toHaveValue("A paper boat.");
});
it("does not mistake server-reordered settings for a newer conflicting draft",async()=>{
 const view=await setup();fireEvent.change(screen.getByLabelText("Your scene"),{target:{value:"Saved boat"}});await waitFor(()=>expect(session.settings.prompt).toBe("Saved boat"));view.unmount();session.settings=Object.fromEntries(Object.entries(session.settings).reverse());await setup();expect(screen.queryByText(/A newer server draft exists/)).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Reset options"})).toBeEnabled();
});
it("Clear video dismisses only the current display, survives reload, and retains all media and prompts",async()=>{
 session.assets=[{id:"output",role:"generated",mime:"video/mp4",name:"saved.mp4"}];jobs=[{id:"job-one",model:"prism-pika",state:"completed",stage:"Video complete",created:1,output:"output",cleanedUp:true,totalSeconds:12}];
 let view=await setup();await screen.findByRole("button",{name:"Clear video"});fireEvent.click(screen.getByRole("button",{name:"Clear video"}));expect(screen.queryByLabelText("Latest result")).not.toBeInTheDocument();expect(screen.getByLabelText("Your scene")).toHaveValue("A paper boat.");expect(session.assets).toHaveLength(1);view.unmount();view=await setup();expect(screen.queryByLabelText("Latest result")).not.toBeInTheDocument();expect(posts("delete")).toHaveLength(0);
});
it("Reset restores defaults, detaches inputs, keeps the finished result and never resubmits",async()=>{
 session.settings={...session.settings,mode:"reference",seconds:12,resolution:"1",orientation:"portrait",seedLocked:true,stylePresetId:"anime",selectedSources:["source"]};session.assets=[{id:"source",role:"source",mime:"image/png",name:"source.png"},{id:"output",role:"generated",mime:"video/mp4",name:"saved.mp4"}];jobs=[{id:"job-one",model:"prism-pika",state:"completed",stage:"Video complete",created:1,output:"output",cleanedUp:true}];
 await setup();await screen.findByRole("button",{name:"Clear video"});fireEvent.click(screen.getByRole("button",{name:"Reset options"}));await waitFor(()=>expect(session.settings.prompt).toBe(""));expect(session.settings).toMatchObject({mode:"text",seconds:5,resolution:"0.2",orientation:"landscape",seedLocked:false,selectedSources:[],loras:[],stylePresetId:"none"});expect(session.assets).toHaveLength(2);expect(screen.getByRole("button",{name:"Clear video"})).toBeInTheDocument();expect(posts("generate")).toHaveLength(0);
});
it("restores an uncertain render's UUID and seed across a closed/reopened component",async()=>{
 const original=server.getMockImplementation()!;let count=0;server.mockImplementation((url,o)=>{if(o?.body&&JSON.parse(o.body).action==="generate"&&count++===0)return Promise.reject(new TypeError("Lost generation reply"));return original(url,o);});
 let view=await setup();fireEvent.click(screen.getByRole("button",{name:"Create video"}));await screen.findByText("Lost generation reply");const seed=session.settings.seed;view.unmount();view=await setup();fireEvent.click(screen.getByRole("button",{name:"Create video"}));await waitFor(()=>expect(posts("generate")).toHaveLength(2));expect(posts("generate").map(([,o])=>JSON.parse(o.body).requestId)[0]).toBe(posts("generate").map(([,o])=>JSON.parse(o.body).requestId)[1]);expect(session.settings.seed).toBe(seed);
});
it("shows real step progress, elapsed time and a job-bound live preview",async()=>{
 jobs=[{id:"job-one",model:"prism-pika",state:"running",created:Date.now()/1000-50,started:Date.now()/1000-20,stage:"Sampling",progressPercent:35,progress:{step:2,total:8,samplingRemainingSeconds:60},previewVersion:123}];await setup();await screen.findByLabelText("Live generation preview");expect(screen.getByLabelText("Generation progress")).toHaveAttribute("value","35");expect(screen.getByLabelText("Live generation preview")).toHaveAttribute("src","/api/h3/nsfw/preview?jobId=job-one&v=123");expect(screen.getByText(/Elapsed · 0m/)).toBeInTheDocument();expect(screen.getByText(/Sampling · about 1m/)).toBeInTheDocument();
});
it("offers editable local/OpenAI suggestions without overwriting the scene or starting generation",async()=>{
 await setup();fireEvent.click(screen.getByText("OpenAI Prompt Generator"));fireEvent.change(screen.getByLabelText("OpenAI H3 direction"),{target:{value:"Make it illustrated"}});fireEvent.click(screen.getByRole("button",{name:"Generate prompt",exact:true}));await screen.findByLabelText("Prompt suggestion");expect(screen.getByLabelText("Your scene")).toHaveValue("A paper boat.");expect(readNsfwDraft("account-a")?.ui.directorId).toBe("director-memory");fireEvent.click(screen.getByRole("button",{name:"Use prompt"}));expect(screen.getByLabelText("Your scene")).toHaveValue("An illustrated paper boat.");fireEvent.click(screen.getByText("H3 Prompter · Style & camera"));fireEvent.click(screen.getByRole("button",{name:"Build H3 prompt"}));await waitFor(()=>expect(screen.getByLabelText("Prompt suggestion")).toHaveValue("A paper boat in cinematic light."));expect(posts("generate")).toHaveLength(0);
});
it("keeps more than 12 uploads and exposes older saved media without overfilling active render inputs",async()=>{
 session.settings.mode="reference";session.assets=Array.from({length:40},(_,i)=>({id:"source-"+i,name:"source-"+i+".png",mime:"image/png",role:"source"}));session.settings.selectedSources=session.assets.slice(0,9).map((a:any)=>a.id);
 await setup();expect(screen.getAllByRole("article")).toHaveLength(9);fireEvent.click(screen.getByText("Saved uploads · 31"));expect(screen.getByRole("button",{name:"Add back source-9.png"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Show more saved uploads"}));expect(screen.getByRole("button",{name:"Add back source-39.png"})).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Remove source-0.png"}));expect(screen.getByRole("button",{name:"Add back source-9.png"})).toBeEnabled();fireEvent.click(screen.getByRole("button",{name:"Add back source-9.png"}));expect(screen.getAllByRole("article")).toHaveLength(9);expect(session.assets).toHaveLength(40);
});
it("shows older results in increments without deleting or capping retained history",async()=>{
 jobs=Array.from({length:61},(_,i)=>({id:"old-"+i,model:"prism-pika",state:"completed",cleanedUp:true,created:100-i,stage:"Completed"}));await setup();fireEvent.click(screen.getByText("History & saved drafts"));await waitFor(()=>expect(screen.getAllByText("Technical receipt")).toHaveLength(20));
 fireEvent.click(screen.getByRole("button",{name:"Show older results"}));expect(screen.getAllByText("Technical receipt")).toHaveLength(40);fireEvent.click(screen.getByRole("button",{name:"Show older results"}));fireEvent.click(screen.getByRole("button",{name:"Show older results"}));expect(screen.getAllByText("Technical receipt")).toHaveLength(61);expect(screen.queryByRole("button",{name:"Show older results"})).not.toBeInTheDocument();expect(posts("delete")).toHaveLength(0);
});
