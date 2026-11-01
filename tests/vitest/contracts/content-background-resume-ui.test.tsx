// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3VideoEditPanel from "@/app/app/components/H3VideoEditPanel";
import NativeImagePanel from "@/app/app/components/NativeImagePanel";
const m=vi.hoisted(()=>({resume:undefined as undefined|(()=>void|Promise<void>),fetch:vi.fn()}));
vi.mock("@/lib/client/useH3Resume",()=>({useH3Resume:(callback:()=>void|Promise<void>)=>{m.resume=callback;}}));
vi.mock("@/app/app/components/ExpandedMediaViewer",()=>({ExpandableVideo:({url}:{url:string})=><video aria-label="Finished video" src={url}/>,ExpandableImage:({url}:{url:string})=><img alt="Finished image" src={url}/>}));
const complete={id:"h3-direct-finished",status:"completed",statusMessage:"Video complete and saved to Gallery",galleryStatus:"saved",videoUrl:"/api/h3/generation/media?jobId=h3-direct-finished",durationSeconds:5};
beforeEach(()=>{localStorage.clear();m.fetch.mockReset();m.resume=undefined;vi.stubGlobal("fetch",m.fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("returning to creation screens without a duplicate submission",()=>{
 it("restores the completed Edit Video after the browser was closed",async()=>{
  localStorage.setItem("otg:h3:edit-video:alice:v1",complete.id);m.fetch.mockResolvedValue(Response.json({job:complete}));
  render(<H3VideoEditPanel authenticatedOwnerKey="alice" onBack={()=>{}}/>);
  await screen.findByRole("link",{name:"Download Video"});expect(m.fetch.mock.calls[0][0]).toContain("view=edit-video&jobId="+complete.id);expect(m.fetch.mock.calls.every(([,init])=>!init?.method||init.method==="GET")).toBe(true);
 });
 it("finds an accepted server job when Android closed before its acknowledgement arrived",async()=>{
  m.fetch.mockResolvedValue(Response.json({job:complete}));render(<H3VideoEditPanel authenticatedOwnerKey="alice" onBack={()=>{}}/>);await screen.findByRole("link",{name:"Download Video"});expect(m.fetch.mock.calls[0][0]).toBe("/api/h3/generation?view=edit-video");expect(localStorage.getItem("otg:h3:edit-video:alice:v1")).toBe(complete.id);
 });
 it("restores the latest owned edit when the saved job no longer exists",async()=>{
  localStorage.setItem("otg:h3:edit-video:alice:v1","removed-job");
  m.fetch.mockResolvedValueOnce(Response.json({error:"Job not found"},{status:404})).mockResolvedValueOnce(Response.json({job:complete}));
  render(<H3VideoEditPanel authenticatedOwnerKey="alice" onBack={()=>{}}/>);
  await screen.findByRole("link",{name:"Download Video"});
  expect(m.fetch.mock.calls.map(([url])=>url)).toEqual(["/api/h3/generation?view=edit-video&jobId=removed-job","/api/h3/generation?view=edit-video"]);
  expect(localStorage.getItem("otg:h3:edit-video:alice:v1")).toBe(complete.id);
 });
 it("refreshes an active edit immediately on Android resume",async()=>{
  let done=false;m.fetch.mockImplementation(async()=>Response.json({job:done?complete:{...complete,status:"running",statusMessage:"Generating in ComfyUI"}}));render(<H3VideoEditPanel authenticatedOwnerKey="alice" onBack={()=>{}}/>);await screen.findByText("Generating in ComfyUI");done=true;await m.resume?.();await screen.findByRole("link",{name:"Download Video"});expect(m.fetch.mock.calls.every(([,init])=>!init?.method||init.method==="GET")).toBe(true);
 });
 it("does not re-enable an in-flight Gallery save when Android resumes",async()=>{
  m.fetch.mockResolvedValueOnce(Response.json({job:{...complete,galleryStatus:"failed"}}));
  m.fetch.mockImplementation(()=>new Promise<Response>(()=>{}));
  render(<H3VideoEditPanel authenticatedOwnerKey="alice" onBack={()=>{}}/>);
  const save=await screen.findByRole("button",{name:"Save to Gallery"});fireEvent.click(save);
  await m.resume?.();
  expect(save).toHaveProperty("disabled",true);
  expect(m.fetch.mock.calls.filter(([,options])=>!options?.method||options.method==="GET")).toHaveLength(1);
  expect(m.fetch.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(1);
 });
 it("ignores a delayed previous-account response",async()=>{
  let resolve!:(response:Response)=>void;m.fetch.mockReturnValueOnce(new Promise<Response>(r=>{resolve=r;}));m.fetch.mockResolvedValue(Response.json({job:{...complete,id:"bob-job",videoUrl:"/api/bob-output"}}));const view=render(<H3VideoEditPanel authenticatedOwnerKey="alice" onBack={()=>{}}/>);view.rerender(<H3VideoEditPanel authenticatedOwnerKey="bob" onBack={()=>{}}/>);await screen.findByRole("link",{name:"Download Video"});resolve(Response.json({job:complete}));await waitFor(()=>expect(screen.getByRole("link",{name:"Download Video"}).getAttribute("href")).toContain("/api/bob-output"));
 });
 it("keeps a completed native image pointer and restores its preview on reopening",async()=>{
  const id="c2cad236-a948-4154-973b-eb5cccb07893";localStorage.setItem("otg:native-image:alice:v1",id);m.fetch.mockImplementation(async()=>Response.json({jobId:id,promptId:"accepted",status:"completed",model:"minimax-h3-image",imageUrl:"/api/owned-image",serverPath:"/owned/image.png",width:1024,height:1024,seed:1}));const first=render(<NativeImagePanel ownerKey="alice" h3Only/>);await screen.findByAltText("Finished image");expect(localStorage.getItem("otg:native-image:alice:v1")).toBe(id);first.unmount();render(<NativeImagePanel ownerKey="alice" h3Only/>);await screen.findByAltText("Finished image");expect(m.fetch.mock.calls.every(([,init])=>!init?.method||init.method==="GET")).toBe(true);
 });
});
