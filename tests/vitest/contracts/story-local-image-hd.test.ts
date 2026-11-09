import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {afterEach,expect,it,vi} from "vitest";
const worker=vi.hoisted(()=>({enqueue:vi.fn(),json:vi.fn()}));
vi.mock("@/lib/workers/local3060",()=>({check3060Gate:async()=>({}),local3060Enabled:()=>true,LOCAL_COMFY:"http://127.0.0.1:8190",localJson:worker.json}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({enqueueComfyMedia:worker.enqueue,getMediaQueueJob:vi.fn(),cancelQueuedMediaJob:vi.fn()}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("keeps native 720p framing through the installed binary-megapixel edit node",async()=>{
  vi.stubEnv("OTG_STORY_EDIT_3060","1");
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"story-edit-hd-"));
  try{
    const file=path.join(root,"wide.png");await sharp({create:{width:800,height:450,channels:3,background:"blue"}}).png().toFile(file);
    worker.json.mockResolvedValue({name:"bound.png",subfolder:"story-3060-input",type:"input"});
    const {submitStory3060Image}=await import("@/lib/storyCreator/media3060");
    await submitStory3060Image({id:"bound",profile:"flux2-klein-edit-3060",command:{operation:"edit",sourceId:"source",prompt:"Warm light"}} as any,file);
    const graph=worker.enqueue.mock.calls[0][0].body.prompt;
    expect(graph["80"].inputs.megapixels*1024*1024).toBe(1280*720);
    const upload=worker.json.mock.calls[0][1].body.get("image");
    expect(await sharp(Buffer.from(await upload.arrayBuffer())).metadata()).toMatchObject({width:1280,height:720});
    expect(graph["66"].inputs.width).toEqual(["99",0]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
