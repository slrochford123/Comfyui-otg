import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {it,expect} from "vitest";
import {finalizeStoryPreview} from "@/lib/storyCreator/mediaVideo";

it.each([true,false])("trims aligned H3 frames to exactly five seconds, audio=%s",async audio=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"story-preview-"));
  try {
    const source=path.join(root,"source.mp4"),output=path.join(root,"preview.mp4");
    execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=160x96:rate=24",...(audio?["-f","lavfi","-i","sine=frequency=440:sample_rate=24000"]:[]),"-t","5.167","-c:v","libx264","-threads","1",...(audio?["-c:a","aac"]:[]),source]);
    const before=fs.readFileSync(source);
    await finalizeStoryPreview(source,output);
    const streams=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-of","json",output],{encoding:"utf8"})).streams;
    expect(streams.find((s:any)=>s.codec_type==="video")).toMatchObject({nb_frames:"120",duration:"5.000000",avg_frame_rate:"24/1",width:160,height:96});
    expect(streams.some((s:any)=>s.codec_type==="audio")).toBe(audio);
    expect(fs.readFileSync(source)).toEqual(before);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
},20_000);
it("rejects an incomplete video instead of padding or freezing it",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"story-preview-"));
  try {
    const source=path.join(root,"short.mp4");
    execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=160x96:rate=24","-t","1","-c:v","libx264","-threads","1",source]);
    await expect(finalizeStoryPreview(source,path.join(root,"out.mp4"))).rejects.toThrow("incomplete preview");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

it("preserves the difference between H3 identity references and first-frame conditioning",async()=>{
  const {storyVideoPrompt}=await import("@/lib/storyCreator/mediaVideo");
  expect(storyVideoPrompt("Helena does a backflip.","reference",5,"Helena",5)).toContain("subject_definitions:");
  expect(storyVideoPrompt("Helena does a backflip.","reference",5,"Helena",5)).not.toContain("actual first frame");
  expect(storyVideoPrompt("Helena does a backflip.","first-frame",6,"Helena",10)).toContain("actual first frame");
  expect(storyVideoPrompt("Helena does a backflip.","first-frame",6,"Helena",10)).toContain("by 6 seconds");
});
