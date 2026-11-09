// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {StoryMediaCards} from "@/app/app/components/storyCreatorV2/StoryMediaCards";
import SavedCharacterVoicePicker from "@/app/app/components/SavedCharacterVoicePicker";
vi.mock("@/app/app/components/storyCreatorV2/StoryPreview",()=>({StoryImagePreview:({src,alt}:any)=><img src={src} alt={alt}/>,StoryMediaPreview:({src,title}:any)=><audio src={src} aria-label={title}/>}));
let record:any,characters:any[],server:ReturnType<typeof vi.fn>;
const posts=()=>server.mock.calls.filter(([,o])=>o?.method==="POST").map(([,o])=>JSON.parse(o.body));
beforeEach(()=>{
 vi.stubGlobal("React",React);
 characters=[{id:"saved-helena",name:"Helena",hasVoice:false}];
 record={id:"voice",status:"ready",characterId:null,voiceId:"approved",command:{operation:"voice",subject:"character",name:"Helena",sourceId:"image"},engine:"ElevenLabs",url:"/api/story-creator/media/file?id=voice",characterTarget:{id:"saved-helena",name:"Helena"},characterImageId:"image",characterImageName:"Helena",characterVoiceSaved:false};
 server=vi.fn(async(url,o)=>{
  if(o?.method==="POST"){
   const body=JSON.parse(o.body);
   if(body.action==="save-character-voice"||body.action==="save-voice"&&body.characterId)record={...record,characterId:"saved-helena",characterTarget:{id:"saved-helena",name:"Helena"},characterVoiceSaved:true};
   return Response.json({ok:true,media:record});
  }
  if(String(url).includes("/api/voices/library"))return Response.json({ok:true,voices:[{voiceId:"alice__voice",name:"Helena voice",refAudioUrl:"/api/file?path=voice"}]});
  return Response.json({ok:true,enabled:true,chatMedia:true,media:[record],characters});
 });vi.stubGlobal("fetch",server);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("offers the linked character for an already approved library voice and shows the saved association",async()=>{
 render(<StoryMediaCards projectId="p" removedMessages={new Set()}/>);
 const select=await screen.findByLabelText("Save voice with");expect(select).toHaveValue("saved-helena");
 expect(posts()).toHaveLength(0);fireEvent.click(screen.getByRole("button",{name:"Save Voice to Helena"}));
 await screen.findByText("Voice saved with Helena. Play it from Characters.");
 expect(posts()).toEqual([{projectId:"p",id:"voice",action:"save-voice",characterId:"saved-helena",candidate:0}]);
 expect(screen.getByRole("button",{name:"Character & Voice Saved"})).toBeDisabled();
});
it("offers one action to save the unsaved portrait and its voice",async()=>{
 record={...record,characterTarget:null};characters=[];
 render(<StoryMediaCards projectId="p" removedMessages={new Set()}/>);
 expect(await screen.findByLabelText("Save voice with")).toHaveValue("image:image");
 fireEvent.click(screen.getByRole("button",{name:"Save Character & Voice"}));
 await waitFor(()=>expect(posts()).toHaveLength(1));expect(posts()[0].action).toBe("save-character-voice");
});
it("respects an explicit Voice Library only selection without attaching a character",async()=>{
 render(<StoryMediaCards projectId="p" removedMessages={new Set()}/>);
 fireEvent.change(await screen.findByLabelText("Save voice with"),{target:{value:""}});
 fireEvent.click(screen.getByRole("button",{name:"Saved to Voice Library"}));
 await waitFor(()=>expect(posts()).toHaveLength(1));expect(posts()[0]).toMatchObject({action:"save-voice",characterId:""});
 expect(screen.getByLabelText("Save voice with")).toHaveValue("");
});
it("offers image-only saving even when an approved related voice exists",async()=>{
 record={...record,id:"image",command:{operation:"image",subject:"character",name:"Helena"},characterTarget:null,voiceId:null,approvedVoiceMediaId:"voice"};characters=[];
 render(<StoryMediaCards projectId="p" removedMessages={new Set()}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Save Image Only"}));
 await waitFor(()=>expect(posts()).toHaveLength(1));expect(posts()[0]).toEqual({projectId:"p",id:"image",action:"save-character"});
});
it("loads the voice library only on request, previews it, and explicitly attaches the chosen voice",async()=>{
 const saved=vi.fn();render(<SavedCharacterVoicePicker characterId="saved-helena" name="Helena" hasVoice={false} onSaved={saved}/>);
 expect(server).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Attach Voice"}));
 fireEvent.change(await screen.findByLabelText("Saved voice for Helena"),{target:{value:"alice__voice"}});
 expect(screen.getByLabelText("Preview selected voice for Helena")).toHaveAttribute("src","/api/file?path=voice");
 fireEvent.click(screen.getByRole("button",{name:"Save Voice to Character"}));
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce());expect(posts()[0]).toEqual({action:"attach_saved_voice",id:"saved-helena",voiceId:"alice__voice"});
});
