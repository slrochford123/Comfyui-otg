import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({session:vi.fn(),gallery:vi.fn(),create:vi.fn(),start:vi.fn(),trim:vi.fn()}));
vi.mock("@/lib/sessionUser",()=>({requireSessionUser:m.session}));
vi.mock("@/lib/gallery",async original=>({...await original<typeof import("@/lib/gallery")>(),getGallerySourcesForRequest:m.gallery}));
vi.mock("@/lib/h3DirectJobs",async original=>({...await original<typeof import("@/lib/h3DirectJobs")>(),createH3DirectJob:m.create,startH3DirectJob:m.start,h3DirectPublicStatus:(job:unknown)=>job}));
vi.mock("@/lib/h3ReferenceVideoClip",async original=>({...await original<typeof import("@/lib/h3ReferenceVideoClip")>(),trimH3ReferenceVideoClip:m.trim}));
vi.mock("@/lib/videoFrame",()=>({probeVideoInfo:async()=>({width:640,height:360,duration:10})}));
import { POST } from "@/app/api/edit-video/swap-characters/submit/route";
function request(target="rtx5060ti") {
 const form=new FormData();form.set("engine","minimax-h3");form.set("targetBackend",target);
 form.set("video_source","upload");form.set("video_name","owner.mp4");form.set("video_file",new File(["fixture"],"owner.mp4",{type:"video/mp4"}));
 form.set("swap_count","1");form.set("replacement_0_file",new File(["fixture"],"owner.png",{type:"image/png"}));
 return new NextRequest("http://localhost:3001/api/edit-video/swap-characters/submit",{method:"POST",body:form});
}
beforeEach(()=>{
 vi.clearAllMocks();
 m.session.mockResolvedValue({ownerKey:"isolated-swap-route-owner"});
 m.gallery.mockResolvedValue({owner:{ownerKey:"isolated-swap-route-owner",username:"isolated-swap-route-owner",scope:"user",deviceId:"qa"},sources:[]});
 m.trim.mockImplementation(async(input:{inputPath:string})=>({outputPath:input.inputPath,startSeconds:0,durationSeconds:5,sourceDurationSeconds:10}));
 m.create.mockImplementation(async(owner:string,input:unknown)=>({id:"mock-no-inference",ownerKey:owner,status:"queued",input}));
});
describe("Swap Characters POST retains selected GPU through actual route/media preparation",()=>{
 it.each(["rtx3090","rtx5060ti"])("queues only a %s-bound input in the mocked job boundary",async target=>{
  const response=await POST(request(target));expect(response.status).toBe(202);
  expect(m.create).toHaveBeenCalledOnce();expect(m.start).toHaveBeenCalledOnce();
  const [owner,input]=m.create.mock.calls[0];expect(owner).toBe("isolated-swap-route-owner");
  expect(input).toMatchObject({targetBackend:target,mode:"h3-reference-to-video",durationSeconds:5});
  expect(input.images).toHaveLength(1);expect(input.videos).toHaveLength(1);
  expect((await response.json()).plan.targetBackend).toBe(target);
 });
 it("rejects unknown endpoints before media storage/job creation",async()=>{
  expect((await POST(request("http://untrusted-worker"))).status).toBe(400);
  expect(m.gallery).not.toHaveBeenCalled();expect(m.trim).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
 it("requires owner authentication before media handling",async()=>{
  m.session.mockRejectedValue(new Error("unauthenticated fixture"));
  expect((await POST(request())).status).toBe(401);expect(m.gallery).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
 });
});
