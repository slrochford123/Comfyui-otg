import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"story-character-save-"));vi.stubEnv("OTG_DATA_ROOT",root);vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_ENV","test");vi.resetModules();});
afterEach(()=>{vi.resetModules();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
async function setup(ownerKey="alice"){
 const store=await import("@/lib/storyCreator/store"),media=await import("@/lib/storyCreator/mediaStore"),execution=await import("@/lib/storyCreator/mediaExecution"),characters=await import("@/lib/characters/store");
 const project=store.createStoryCreatorProject({ownerKey,title:"Character saving"});
 async function make(operation:"image"|"voice",sourceId="",name="Helena"){
  const message=store.addStoryCreatorMessage({ownerKey,projectId:project.id,role:"user",content:"Create "+name});
  const record=media.createStoryMedia({ownerKey,projectId:project.id,sourceMessageId:message.id,command:{operation,subject:"character",name,prompt:"A calm voice and portrait",sourceId,text:operation==="voice"?"Welcome.":"",evidence:message.content}}).record;
  const dir=execution.storyMediaRoot(record);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,operation==="voice"?"result.wav":"result.png");fs.writeFileSync(file,Buffer.from("fixture bytes"));
  return media.updateStoryMedia(record,{status:"ready",filePath:file});
 }
 return {ownerKey,project,media,execution,characters,make};
}
it("keeps image-only saving intact and attaches an approved voice after saving the image",async()=>{
 const s=await setup(),image=await s.make("image"),saved=s.execution.saveStoryCharacter(image),voice=await s.make("voice",image.id);
 expect(s.characters.loadCharacter("alice",saved.characterId!)?.referenceAudioPath).toBeFalsy();
 const assigned=await s.execution.saveStoryCharacterVoice(voice,0),character=s.characters.loadCharacter("alice",saved.characterId!)!;
 expect(assigned.characterId).toBe(saved.characterId);expect(character.voiceStatus).toBe("ready");expect(character.hasCustomVoice).toBe(true);expect(fs.readFileSync(character.referenceAudioPath!,"utf8")).toBe("fixture bytes");
 expect(character.voiceSettings?.audioUrl).toContain("/api/file?path=");
 const hints=s.execution.storyCharacterSaveHints(s.media.listStoryMedia("alice",s.project.id));
 expect(hints.get(image.id)).toMatchObject({characterVoiceSaved:true,approvedVoiceMediaId:voice.id});
 await s.execution.saveStoryCharacterVoice(assigned,0);
 expect(s.characters.listCharacters("alice")).toHaveLength(1);
});
it("saves the character and voice when the voice was approved before the image was saved",async()=>{
 const s=await setup(),image=await s.make("image"),voice=await s.make("voice",image.id),approved=s.execution.saveStoryVoice(voice);
 const before=s.execution.storyCharacterSaveHints(s.media.listStoryMedia("alice",s.project.id));
 expect(before.get(voice.id)).toMatchObject({characterTarget:null,characterImageId:image.id});
 const saved=s.execution.saveStoryCharacter(image,approved.id);
 expect(s.characters.loadCharacter("alice",saved.characterId!)?.metadata?.storyVoiceId).toBe(approved.voiceId);
 expect(s.execution.saveStoryCharacter(image,approved.id).characterId).toBe(saved.characterId);
});
it("follows explicit image provenance through additional dialogue and never assigns by name alone",async()=>{
 const s=await setup(),image=await s.make("image"),first=await s.make("voice",image.id),second=await s.make("voice",first.id);
 const assigned=await s.execution.saveStoryCharacterVoice(second,0);
 expect(s.media.getStoryMedia("alice",s.project.id,image.id).characterId).toBe(assigned.characterId);
 const independent=await s.make("voice");expect(s.execution.storyCharacterSaveHints([independent]).get(independent.id)?.characterTarget).toBeNull();
 await expect(s.execution.saveStoryCharacterVoice(independent,0)).rejects.toThrow("Choose a saved character");
});
it("rejects unapproved, unrelated and cross-account attachments before changing a character",async()=>{
 const s=await setup(),image=await s.make("image"),voice=await s.make("voice",image.id);
 expect(()=>s.execution.saveStoryCharacter(image,voice.id)).toThrow("approved voice");expect(s.characters.listCharacters("alice")).toHaveLength(0);
 const other=await s.make("image","","Other"),approved=s.execution.saveStoryVoice(voice);
 expect(()=>s.execution.saveStoryCharacter(other,approved.id)).toThrow("approved voice");
 const b=await setup("bob"),bobImage=await b.make("image"),bob=b.execution.saveStoryCharacter(bobImage);
 expect(()=>s.execution.saveStoryVoice(voice,bob.characterId!)).toThrow("not found for this account");
 expect(b.characters.loadCharacter("bob",bob.characterId!)?.referenceAudioPath).toBeFalsy();
});
it("attaches an existing library voice without generating speech and denies foreign voices or symlink namespaces",async()=>{
 const s=await setup(),image=await s.make("image"),character=s.execution.saveStoryCharacter(image),voice=s.execution.saveStoryVoice(await s.make("voice"));
 const {attachSavedCharacterVoice}=await import("@/lib/characters/savedVoice");
 expect(attachSavedCharacterVoice("alice",character.characterId!,voice.voiceId!)?.metadata?.storyVoiceId).toBe(voice.voiceId);
 const b=await setup("bob"),foreign=b.execution.saveStoryVoice(await b.make("voice"));
 expect(()=>attachSavedCharacterVoice("alice",character.characterId!,foreign.voiceId!)).toThrow("not found for this account");
 const library=await import("@/lib/voicesStudio");const id="alice__escaped";const target=library.voicesSamplesDir(foreign.voiceId!);fs.symlinkSync(target,path.join(library.voicesRoot(),"samples",id));
 library.upsertVoice("alice",{voiceId:id,name:"Escape",tags:[],type:"created",refText:"",refAudioRel:`samples/${id}/ref.wav`,createdAt:"",updatedAt:""});
 expect(()=>attachSavedCharacterVoice("alice",character.characterId!,id)).toThrow("unavailable");
});
