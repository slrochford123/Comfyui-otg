// @vitest-environment jsdom
import React from "react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import Panel from "@/app/app/components/AdminGallerySourcesPanel";
beforeEach(()=>vi.stubGlobal("React",React));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const item=(i:number,kind="image")=>({id:String(i),name:`item-${i}.${kind==="audio"?"flac":"png"}`,rel:`nested/item-${i}.png`,source:"comfy-3090",sourceLabel:"3090",kind,bytes:3,mtimeMs:1000-i,url:"/api/admin/gallery-file?source=comfy-3090&rel="+i});
describe("Admin Gallery viewer and complete paging",()=>{
  it("Next in the viewer fetches the next page and retains a direct download",async()=>{
    const fetch=vi.fn(async(url:string)=>{const u=new URL(url,"http://localhost");const offset=Number(u.searchParams.get("offset"));return Response.json({ok:true,items:offset?[item(48)]:Array.from({length:48},(_,i)=>item(i)),statuses:[{id:"comfy-3090",ok:true,label:"3090",count:49}],hasMore:offset===0,nextOffset:offset?49:48,snapshotId:"stable-fixture"});});vi.stubGlobal("fetch",fetch);
    render(<Panel/>);await screen.findByText("item-47.png");fireEvent.click(screen.getByText("item-47.png"));expect(screen.getByText("48 of 49")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Next",exact:true}));await screen.findByText("49 of 49");
    expect(fetch.mock.calls.some(([url])=>String(url).includes("offset=48")&&String(url).includes("snapshot=stable-fixture"))).toBe(true);
    expect(screen.getAllByRole("link",{name:"Download"}).every(a=>a.getAttribute("href")?.includes("download=1"))).toBe(true);
  });
  it("offers audio and other files without pretending they are image previews",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,items:[item(1,"audio"),{...item(2,"other"),name:"workflow.json"}],statuses:[],hasMore:false,nextOffset:2,snapshotId:"audio"})));
    render(<Panel/>);await screen.findByText("workflow.json");expect(screen.getByRole("option",{name:"Audio"})).toBeTruthy();expect(screen.getByRole("option",{name:"Other files"})).toBeTruthy();
    fireEvent.click(screen.getByText("workflow.json"));expect(screen.getByText(/Preview unavailable/)).toBeTruthy();
  });
});
