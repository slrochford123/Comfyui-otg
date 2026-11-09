// @vitest-environment jsdom
import React from "react";
import {afterEach,it,expect,vi} from "vitest";
import {act,renderHook,waitFor,cleanup} from "@testing-library/react";
import {useStudio} from "@/app/app/components/production-studio/useStudio";
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
it("does not let an older poll undo a save or send the next Director request with a stale revision",async()=>{
 vi.stubGlobal("React",React);const one={id:"project",revision:1,shots:{}},two={...one,revision:2};let gets=0,release:(r:Response)=>void=()=>{},post:any;
 vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==="PATCH")return Response.json({project:two});
  if(init?.method==="POST"){post=JSON.parse(String(init.body));return Response.json({ok:true});}
  gets++;if(gets===2)return new Promise<Response>(r=>{release=r;});
  return Response.json({project:gets===1?one:two,assets:[{id:"retained-reference"}],jobs:[]});
 }));
 const {result}=renderHook(()=>useStudio("owner","project"));await waitFor(()=>expect(result.current.saved).toBe(true));
 let pending:Promise<void>;act(()=>{pending=result.current.refresh();});
 await act(async()=>{await result.current.commit({type:"shot.settings",shotId:"clip",patch:{promptSource:"director"}});});
 expect(result.current.project?.revision).toBe(2);
 await act(async()=>{release(Response.json({project:one,assets:[],jobs:[{id:"stale-job",status:"running"}]}));await pending!;});
 expect(result.current.project?.revision).toBe(2);expect(result.current.assets.map(a=>a.id)).toEqual(["retained-reference"]);expect(result.current.jobs).toEqual([]);
 await act(async()=>{await result.current.job({kind:"assistant",shotId:"clip",directionMode:true,message:"Change the second cut"});});
 expect(post.revision).toBe(2);expect(post.message).toBe("Change the second cut");
});
