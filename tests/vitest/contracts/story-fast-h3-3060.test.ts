import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {StoryMediaRecord} from "@/lib/storyCreator/mediaStore";
const mocks=vi.hoisted(()=>({queue:vi.fn(),local:vi.fn(),gate:vi.fn(),update:vi.fn(),record:{} as StoryMediaRecord}));
vi.mock("@/lib/workers/mediaGpuQueue",()=>({enqueueComfyMedia:mocks.queue,getMediaQueueJob:vi.fn()}));
vi.mock("@/lib/workers/local3060",()=>({local3060Enabled:()=>true,LOCAL_COMFY:"http://127.0.0.1:8190",localJson:mocks.local,check3060Gate:mocks.gate}));
vi.mock("@/lib/storyCreator/mediaStore",()=>({getStoryMedia:()=>mocks.record,updateStoryMedia:mocks.update}));
import {story3060VideoGraph,submitStory3060Video,readStory3060Video} from "@/lib/storyCreator/mediaVideo3060";
beforeEach(()=>{vi.clearAllMocks();mocks.record={id:"clip",ownerKey:"alice",projectId:"story",status:"submitting",profile:"fasth3-3060",command:{operation:"video",subject:"scene",name:"Temple",prompt:"Slow camera movement.",sourceId:"",text:"",evidence:"Animate",durationSeconds:10}} as StoryMediaRecord;});
afterEach(()=>vi.unstubAllGlobals());
it.each(["text","first-frame","reference"])("uses the qualified %s graph at 0.4 MP with 10-second alignment",mode=>{
  if(mode!=="text")Object.assign(mocks.record.command,{sourceId:"image-id",videoMode:mode});
  const graph=story3060VideoGraph(mocks.record,mode==="text"?undefined:"owned/input.png");
  const nodes=Object.values(graph),type=(name:string)=>nodes.filter(n=>n.class_type===name);
  expect(type("PrimitiveFloat")[0].inputs.value).toBe(10);
  expect(type("BasicScheduler")[0].inputs.steps).toBe(8);
  expect(type("ResolutionSelector").concat(type("ImageScaleToTotalPixels"))[0].inputs.megapixels).toBe(.4);
  expect(type("UNETLoader")[0].inputs.unet_name).toBe(mode==="reference"?"fasth3_omniref_8step_pruned_int8_convrot.safetensors":"fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors");
  expect(type("LoadImage").length).toBe(mode==="text"?0:1);
  expect(type("SaveVideo")[0].inputs.filename_prefix).toBe("story-3060-video/clip");
  expect(type("ComfyMathExpression")[0].inputs.expression).toContain("% 17");
});
it("rejects a missing bound reference and excessive duration",()=>{
  mocks.record.command.sourceId="image";expect(()=>story3060VideoGraph(mocks.record)).toThrow(/reference/);
  mocks.record.command.sourceId="";mocks.record.command.durationSeconds=20;expect(()=>story3060VideoGraph(mocks.record)).toThrow(/1–10/);
});
it("binds the owning record before the durable 3060 queue can dispatch",async()=>{
  const graph=story3060VideoGraph(mocks.record),schema:Record<string,any>={};
  for(const node of Object.values(graph)){const required:Record<string,any>={};for(const key of ["unet_name","clip_name","vae_name"])if(node.inputs[key])required[key]=[[node.inputs[key]]];schema[node.class_type]={input:{required:{...schema[node.class_type]?.input.required,...required}}};}
  // Both VAE filenames belong in the same loader inventory.
  schema.VAELoader.input.required.vae_name=[Object.values(graph).filter(n=>n.class_type==="VAELoader").map(n=>n.inputs.vae_name)];
  mocks.local.mockResolvedValue(schema);mocks.queue.mockImplementation(async(payload,bind)=>{bind("prompt-id");expect(mocks.update).toHaveBeenCalledWith(mocks.record,expect.objectContaining({status:"running",backendJob:expect.objectContaining({gpu:"rtx3060",promptId:"prompt-id"})}));return payload;});
  await submitStory3060Video(mocks.record);
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({baseUrl:"http://127.0.0.1:8190",workerId:"story-3060-video",producer:{kind:"story-3060-video",ownerKey:"alice",projectId:"story",id:"clip"}}),expect.any(Function));
});
it("does not submit when the target worker lacks its model",async()=>{
  mocks.local.mockResolvedValue({});await expect(submitStory3060Video(mocks.record)).rejects.toThrow(/missing/);expect(mocks.queue).not.toHaveBeenCalled();
});
it("rejects another request's output before downloading",async()=>{
  expect(await readStory3060Video(mocks.record,"/unused",{outputs:{92:{images:[{type:"output",subfolder:"story-3060-video",filename:"someone-else_0001.mp4"}]}}})).toMatchObject({error:expect.stringContaining("owned output")});
});
