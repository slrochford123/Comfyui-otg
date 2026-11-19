import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {createSession,updateSession,validateSettings} from "@/lib/experiments/store";
import {labFinalPrompt} from "@/lib/experiments/creative";
import {DEFAULT_LAB_SETTINGS} from "@/lib/experiments/catalog";
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"nsfw-preferences-"));fs.chmodSync(root,0o700);vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_EXPERIMENTS_ROOT",root);});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
describe("NSFW shared workflow preferences",()=>{
 it("keeps native audio as the implicit default for old drafts",()=>{const settings=validateSettings(DEFAULT_LAB_SETTINGS);expect(settings.experimentalAudioReferences).toBeUndefined();});
 it("persists Manual and the explicit audio experiment after reopening",()=>{const original=createSession("owner","eros-beta7");const result=updateSession("owner",original.id,{...original,settings:{...original.settings,manualPrompt:true,experimentalAudioReferences:true}});expect(result.settings).toMatchObject({manualPrompt:true,experimentalAudioReferences:true});});
 it("does not prepend Director styling to an exact Manual prompt",()=>{const prompt="subject_definitions:\n<Subject 1> uses <Picture 1>.\n\nsummary:\n[reference generation]";expect(labFinalPrompt({...DEFAULT_LAB_SETTINGS,prompt,manualPrompt:true,visualStyle:"Cartoon",cameraFeel:"Handheld"})).toBe(prompt);});
 it("retains character bindings by stable asset UUID through reordering",()=>{const a=crypto.randomUUID(),b=crypto.randomUUID(),binding={characterId:"character-1",imageId:"front",version:"version-1"};const settings=validateSettings({...DEFAULT_LAB_SETTINGS,mode:"reference",selectedSources:[b,a],referenceCharacters:{[a]:binding}});expect(settings.referenceCharacters?.[a]).toEqual(binding);expect(settings.selectedSources).toEqual([b,a]);});
 it.each(["yes",1,null,{}])("rejects an invalid audio opt-in %j",value=>{expect(()=>validateSettings({...DEFAULT_LAB_SETTINGS,experimentalAudioReferences:value})).toThrow(/preference/);});
 it("rejects forged reference keys instead of interpreting them as paths",()=>{expect(()=>validateSettings({...DEFAULT_LAB_SETTINGS,referenceCharacters:{"../../another-owner":{characterId:"c",imageId:"i",version:"v"}}})).toThrow(/identifier/);});
});
