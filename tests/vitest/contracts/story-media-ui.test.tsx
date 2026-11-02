// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {StoryMediaCards} from "@/app/app/components/storyCreatorV2/StoryMediaCards";
let records:any[],server:ReturnType<typeof vi.fn>;
const posts=()=>server.mock.calls.filter(([,o])=>o?.method==="POST").map(([,o])=>JSON.parse(o.body));
beforeEach(()=>{
  vi.stubGlobal("React",React);let random=0;vi.stubGlobal("crypto",{getRandomValues:(bytes:Uint8Array)=>bytes.fill(++random)});
  records=[{id:"one",status:"needs_name",command:{name:"",subject:"character",operation:"image"},engine:"Krea 2 Turbo",url:null}];
  server=vi.fn(async(_url,o)=>{
    if(o?.method==="POST") {
      const body=JSON.parse(o.body);if(body.action==="name")records[0]={...records[0],command:{...records[0].command,name:body.name},status:"queued"};
      if(body.action==="save-character")records[0]={...records[0],characterId:"saved-buzzy"};
      return Response.json({ok:true,media:records[0]});
    }
    return Response.json({enabled:true,media:records,characters:[]});
  });vi.stubGlobal("fetch",server);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("does not create on mount or focus and asks for a name",async()=>{
  render(<StoryMediaCards projectId="project"/>);await screen.findByLabelText("Character name");expect(posts()).toEqual([]);
  expect(screen.getByRole("button",{name:"Name & Create"})).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Character name"),{target:{value:"Buzzy"}});fireEvent.click(screen.getByRole("button",{name:"Name & Create"}));
  await screen.findByText("Waiting for a free GPU…");expect(posts()).toEqual([{projectId:"project",id:"one",action:"name",name:"Buzzy"}]);
  fireEvent(window,new Event("focus"));await waitFor(()=>expect(server.mock.calls.length).toBeGreaterThan(2));expect(posts()).toHaveLength(1);
});
it("shows a full result and saves a character without any voice fields",async()=>{
  records[0]={...records[0],status:"ready",url:"/api/story-creator/media/file?id=one",command:{...records[0].command,name:"Buzzy"}};
  render(<StoryMediaCards projectId="project"/>);await screen.findByRole("img",{name:"Buzzy"});
  fireEvent.click(screen.getByRole("button",{name:"Save to Characters"}));await screen.findByRole("button",{name:"Saved to Characters"});
  expect(posts()[0]).toEqual({projectId:"project",id:"one",action:"save-character"});
  expect(screen.getByRole("link",{name:"Download"})).toHaveAttribute("href","/api/story-creator/media/file?id=one&download=1");
});
it("uses the original media ID and the same replay key after a lost response",async()=>{
  records[0]={...records[0],status:"ready",url:"/api/story-creator/media/file?id=one",command:{...records[0].command,name:"Buzzy"}};
  const original=server.getMockImplementation()!;let attempts=0;
  server.mockImplementation(async(url,o)=>{if(o?.method==="POST"&&attempts++===0)throw Error("Connection lost");return original(url,o);});
  render(<StoryMediaCards projectId="project"/>);await screen.findByRole("img",{name:"Buzzy"});
  fireEvent.click(screen.getByRole("button",{name:"Edit",exact:true}));fireEvent.change(screen.getByLabelText("What should change?"),{target:{value:"Make the sky blue."}});
  const create=screen.getByRole("button",{name:"Create",exact:true});fireEvent.click(create);fireEvent.click(create);await screen.findByText("Connection lost");expect(posts()).toHaveLength(1);
  fireEvent.click(create);await waitFor(()=>expect(posts()).toHaveLength(2));expect(posts()[0].requestKey).toBe(posts()[1].requestKey);expect(posts()[0]).toMatchObject({sourceId:"one",operation:"edit"});
});
