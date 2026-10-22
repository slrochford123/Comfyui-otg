// @vitest-environment jsdom
import React from "react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent,act,cleanup} from "@testing-library/react";
vi.mock("@/app/app/components/EditVideoRemoveMusicPanel",()=>({default:()=>null}));
vi.mock("@/app/app/components/EditVideoEditAnythingPanel",()=>({default:()=>null}));
vi.mock("@/app/app/components/EditVideoWooshPanel",()=>({default:()=>null}));
vi.mock("@/app/app/components/EditVideoVoiceDubbingPanel",()=>({default:()=>null}));
vi.mock("@/app/app/components/EditVideoExtractAudioPanel",()=>({default:()=>null}));
vi.mock("@/app/app/components/EditVideoSwapCharactersPanel",()=>({default:()=>null}));
vi.mock("@/app/app/components/LtxStudiosPanel",()=>({default:()=>null}));
import EditVideoPanel from "@/app/app/components/EditVideoPanel";
const status=(busy=false)=>({ok:true,reachable:true,initialized:true,busy,presets:{turbo:{installed:true,ready:!busy},base:{installed:false,ready:false},sft:{installed:false,ready:false}}});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
describe("ACE live readiness UI",()=>{
 it("clears stale Ready after an unavailable poll",async()=>{
  vi.useFakeTimers();let available=true;
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input)==="/api/edit-video/ace-music"?Response.json(available?status():{ok:false},{status:available?200:503}):Response.json({ok:true,items:[]}));
  render(<EditVideoPanel/>);await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Audio Editing"}));});
  expect(screen.getByText(/ACE-Step Ready/)).toBeTruthy();available=false;await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByText(/ACE-Step unavailable/)).toBeTruthy();
 });
 it("does not let an older slow Ready response overwrite a newer unavailable state",async()=>{
  let resolveOld!:(value:Response)=>void;let calls=0;
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{if(String(input)!=="/api/edit-video/ace-music")return Response.json({ok:true,items:[]});if(++calls===1)return new Promise<Response>(r=>{resolveOld=r;});return Response.json({ok:false},{status:503});});
  render(<EditVideoPanel/>);await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Audio Editing"}));});await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Refresh music service"}));});await act(async()=>{resolveOld(Response.json(status()));});expect(screen.queryByText(/ACE-Step Ready/)).toBeNull();
 });
 it("shows Busy and prevents another generation while the provider is busy",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>Response.json(String(input)==="/api/edit-video/ace-music"?status(true):{ok:true,items:[]}));
  render(<EditVideoPanel/>);await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Audio Editing"}));});expect(screen.getByText(/ACE-Step Busy/)).toBeTruthy();expect((screen.getByRole("button",{name:"Generate Music"}) as HTMLButtonElement).disabled).toBe(true);
 });
});
