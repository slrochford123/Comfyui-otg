import fs from "node:fs";
import path from "node:path";
import {randomInt} from "node:crypto";
import sharp from "sharp";
import {check3060Gate,local3060Enabled,LOCAL_COMFY,localJson} from "@/lib/workers/local3060";
import {enqueueComfyMedia,getMediaQueueJob} from "@/lib/workers/mediaGpuQueue";
import {getStoryMedia,updateStoryMedia,type StoryMediaRecord} from "./mediaStore";
import {retrieveRemoteComfyMedia} from "./remoteComfyMedia";
import {finalizeStoryPreview,storyVideoPrompt} from "./mediaVideo";
import textTemplate from "./fastH3-t2v-3060.json";
import imageTemplate from "./fastH3-i2v-3060.json";
import referenceTemplate from "./fastH3-r2v-3060.json";

export const story3060VideoProfile="fasth3-3060" as const;
export const story3060VideoEnabled=()=>local3060Enabled();
type Graph=Record<string,{class_type:string;inputs:Record<string,any>}>;

/** Qualified official eight-step Fast H3 templates. Never substitute a render GPU. */
export function story3060VideoGraph(record:StoryMediaRecord,image?:string) {
  if(record.profile!==story3060VideoProfile||record.command.operation!=="video")throw Error("Choose the RTX 3060 Fast H3 video profile.");
  const seconds=record.command.durationSeconds||5;
  if(!Number.isFinite(seconds)||seconds<1||seconds>10)throw Error("Fast H3 Story clips support 1–10 seconds.");
  if(Boolean(record.command.sourceId)!==Boolean(image))throw Error("The selected video reference is missing.");
  const mode=image?(record.command.videoMode==="first-frame"?"first-frame":"reference"):"text";
  const native=seconds<=5?5:10;
  const graph:Graph=structuredClone(mode==="text"?textTemplate:mode==="first-frame"?imageTemplate:referenceTemplate);
  const prompt=storyVideoPrompt(record.command.prompt,mode,seconds,record.command.name,native);
  for(const node of Object.values(graph)) {
    if(node.class_type==="PrimitiveFloat")node.inputs.value=native;
    if(node.class_type==="MiniMaxH3ImageToVideo")node.inputs.prompt=prompt;
    if(node.class_type==="PrimitiveStringMultiline")node.inputs.value=prompt;
    if(node.class_type==="LoadImage")node.inputs.image=image;
    if(node.class_type==="ResolutionSelector"){node.inputs.aspect_ratio="16:9 (Widescreen)";node.inputs.megapixels=.4;}
    if(node.class_type==="RandomNoise")node.inputs.noise_seed=randomInt(0,2**32);
    if(node.class_type==="SaveVideo")node.inputs.filename_prefix="story-3060-video/"+record.id;
  }
  return graph;
}

export async function submitStory3060Video(record:StoryMediaRecord,source?:string) {
  if(!story3060VideoEnabled())throw Error("The RTX 3060 video worker is unavailable. No substitute was started.");
  await check3060Gate();
  let image:string|undefined;
  if(source){
    const bytes=await sharp(source,{limitInputPixels:32_000_000}).rotate().png().toBuffer();
    const name=record.id+".png",form=new FormData();
    form.set("image",new Blob([new Uint8Array(bytes)],{type:"image/png"}),name);
    form.set("subfolder","story-3060-video-input");form.set("type","input");form.set("overwrite","true");
    const upload=await localJson(LOCAL_COMFY+"/upload/image",{method:"POST",body:form});
    if(upload.name!==name||upload.subfolder!=="story-3060-video-input"||upload.type!=="input")throw Error("The video reference upload could not be verified.");
    image=upload.subfolder+"/"+upload.name;
  }
  const graph=story3060VideoGraph(record,image);
  // Check this worker's actual model and node inventory before admitting a job.
  const schema=await localJson(LOCAL_COMFY+"/object_info");
  for(const node of Object.values(graph)){
    const spec=schema[node.class_type];if(!spec)throw Error(`The RTX 3060 video worker is missing ${node.class_type}.`);
    for(const key of ["unet_name","clip_name","vae_name"]){
      if(node.inputs[key]&&!spec.input?.required?.[key]?.[0]?.includes(node.inputs[key]))throw Error(`The RTX 3060 video worker is missing ${node.inputs[key]}.`);
    }
  }
  await enqueueComfyMedia({baseUrl:LOCAL_COMFY,workerId:"story-3060-video",body:{prompt:graph,client_id:"story-3060-video-"+record.id},producer:{kind:"story-3060-video",ownerKey:record.ownerKey,id:record.id,projectId:record.projectId}},id=>{
    const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
    if(current.status!=="submitting")throw Error("The Story video changed before submission.");
    updateStoryMedia(current,{status:"running",backendJob:{promptId:id,comfyBaseUrl:LOCAL_COMFY,outputNodeId:"92",gpu:"rtx3060",engine:story3060VideoProfile},stage:"Waiting for RTX 3060"});
  });
}

export async function readStory3060Video(record:StoryMediaRecord,root:string,receipt:any) {
  const outputs=receipt?.outputs?.["92"],files=outputs?.images||outputs?.videos||outputs?.gifs;
  if(!Array.isArray(files)||files.length!==1||files[0].type!=="output"||files[0].subfolder!=="story-3060-video"||!String(files[0].filename||"").startsWith(record.id+"_")||!String(files[0].filename).endsWith(".mp4"))
    return {error:"The video worker did not return this request's owned output."};
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const native=await retrieveRemoteComfyMedia({baseUrl:LOCAL_COMFY,trustedBaseUrls:[LOCAL_COMFY],file:files[0],storageRoot:root,destinationPath:path.join(root,"native.mp4"),kind:"video"});
  // Preserve the full native generation; only the derived preview is trimmed.
  const file=await finalizeStoryPreview(native.filePath,path.join(root,"preview.mp4"),record.command.durationSeconds||5);
  return {filePath:file};
}

export function story3060VideoProgress(record:StoryMediaRecord) {
  const job=getMediaQueueJob(String(record.backendJob?.promptId||""));
  if(!job||job.gpu!=="rtx3060")throw Error("The original video request cannot be verified. No duplicate was submitted.");
  if(job.status==="failed"||job.status==="canceled")return updateStoryMedia(record,{status:job.status,error:job.error});
  return updateStoryMedia(record,{stage:job.status==="queued"?"Waiting for RTX 3060":job.status==="unknown"?"Checking the original RTX 3060 video job":"Creating Fast H3 video on RTX 3060"});
}
