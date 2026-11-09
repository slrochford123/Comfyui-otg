import {afterAll,describe,it,expect} from "vitest";
import fs from "node:fs";import path from "node:path";import os from "node:os";import {execFileSync} from "node:child_process";
import {finishingGeometry,transformFinishVideo,verifyFinishedVideo} from "@/lib/productionStudio/finishing";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"shot-finish-"));afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
describe("Real FFmpeg finishing adapters with synthetic VSR output, no GPU",()=>{
 for(const [width,height]of[[608,352],[352,608],[320,320]])it(`preserves ${width}x${height} aspect, timing and audio at approximately 1 MP`,async()=>{
  const source=path.join(root,`${width}-${height}.mp4`),canvas=source+"-canvas.mp4",vsr=source+"-vsr.mp4",final=source+"-final.mp4",geometry=finishingGeometry(width,height);
  execFileSync("ffmpeg",["-v","error","-f","lavfi","-i",`testsrc2=size=${width}x${height}:rate=24`,"-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","0.5","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-c:a","aac",source]);
  await transformFinishVideo(source,canvas,geometry.prepare);await transformFinishVideo(canvas,vsr,"scale=1920:1080");await transformFinishVideo(vsr,final,geometry.finish);
  const result=await verifyFinishedVideo(source,final,geometry);expect(result.megapixels).toBeGreaterThan(.995);expect(result.megapixels).toBeLessThan(1.005);expect(Math.abs(result.width/result.height-width/height)).toBeLessThan(.004);expect(result.fps).toBe(24);expect(fs.existsSync(source)).toBe(true);
  await expect(verifyFinishedVideo(source,vsr,geometry)).rejects.toThrow("unexpected dimensions");
 },20000);
 it("rejects invalid geometry",()=>{expect(()=>finishingGeometry(0,352)).toThrow();expect(()=>finishingGeometry(NaN,352)).toThrow();});
});
