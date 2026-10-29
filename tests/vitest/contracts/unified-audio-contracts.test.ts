import { describe, expect, it } from "vitest";
import { activeStems, applyEnhancedTrack, aukInstruction, defaultTracks, normalizeEdit, numberWithin, requiresSeparation, STEMS, type AudioSession } from "@/lib/audioEditing/contracts";

function session():AudioSession {return {version:1,id:"abc",title:"test",createdAt:"",updatedAt:"",revision:1,assets:[
  {id:"audio",name:"test",kind:"audio",file:"",origin:"test",duration:5}],stems:{},tracks:defaultTracks(),clips:[],ducking:false,completedJobs:[]};}
describe("Unified Audio Editing behavior",()=>{
  it.each([0,"0",0.0])("honors explicit zero gain %s",value=>expect(numberWithin(value,1,0,2)).toBe(0));
  it("defaults only missing or invalid numeric values",()=>{
    expect(numberWithin(null,.25,0,2)).toBe(.25);expect(numberWithin("bad",.25,0,2)).toBe(.25);
    expect(numberWithin(8,1,0,2)).toBe(2);
  });
  for(let mask=0;mask<8;mask++)it(`supports independent keep/remove combination ${mask}`,()=>{
    const tracks=defaultTracks();STEMS.forEach((s,i)=>tracks[s].keep=!!(mask&(1<<i)));
    expect(activeStems(tracks)).toEqual(STEMS.filter((_,i)=>mask&(1<<i)));
    expect(requiresSeparation({...session(),tracks})).toBe(mask!==0&&mask!==7);
  });
  it("solo does not silently override a muted track",()=>{
    const tracks=defaultTracks();tracks.music.solo=true;tracks.music.keep=false;
    expect(activeStems(tracks)).toEqual([]);
  });
  it("edited gains need stems but original passthrough and full mute do not",()=>{
    const value=session();value.tracks.speech.gain=.5;expect(requiresSeparation(value)).toBe(true);
    STEMS.forEach(s=>value.tracks[s].keep=false);expect(requiresSeparation(value)).toBe(false);
  });
  it("validates all timeline assets against the current session",()=>{
    expect(()=>normalizeEdit({clips:[{id:"x",assetId:"other-owner"}]},session())).toThrow("this session");
  });
  it("clamps dangerous numbers and preserves zero in timeline edits",()=>{
    const edit=normalizeEdit({clips:[{id:"x",assetId:"audio",start:-8,trimStart:0,length:5,gain:0,fadeIn:99,fadeOut:0}]},session());
    expect(edit.clips[0]).toMatchObject({start:0,gain:0,fadeIn:2.5});
  });
  it("uses actual AuK dialogue instructions, not a duration-only gen_text substitute",()=>{
    expect(aukInstruction("Hello","deep voice",false)).toBe('Based on the following description: "deep voice", generate speech content "Hello".');
    expect(aukInstruction("Hello","",true)).toBe('Say the following with the same voice: "Hello"');
    expect(()=>aukInstruction("","",true)).toThrow();
  });
  it("only replaces the matching source stem with its enhancement",()=>{
    const value=session();value.stems.speech="original-speech";value.stems.music="original-music";
    applyEnhancedTrack(value,"unrelated-generated-speech",{speech:"enhanced-generated"});
    expect(value.tracks.speech.enhanced).toBeUndefined();
    applyEnhancedTrack(value,"original-speech",{speech:"enhanced-source",music:"wrong-target"});
    expect(value.tracks.speech.enhanced).toBe("enhanced-source");expect(value.tracks.music.enhanced).toBeUndefined();
    applyEnhancedTrack(value,"enhanced-source",{speech:"enhanced-twice"});expect(value.tracks.speech.enhanced).toBe("enhanced-twice");
  });
  it("never interprets an absent enhancement source as a matching absent stem",()=>{
    const value=session();applyEnhancedTrack(value,undefined,{speech:"generated"});
    expect(value.tracks.speech.enhanced).toBeUndefined();
  });
});
