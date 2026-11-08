import path from "node:path";
import {randomInt} from "node:crypto";
import sharp from "sharp";
import {check3060Gate,local3060Enabled,LOCAL_COMFY,localJson} from "@/lib/workers/local3060";
import {enqueueComfyMedia,getMediaQueueJob,cancelQueuedMediaJob} from "@/lib/workers/mediaGpuQueue";
import {getStoryMedia,updateStoryMedia,type StoryMediaRecord} from "./mediaStore";
import {retrieveRemoteComfyMedia} from "./remoteComfyMedia";
import graphTemplate from "./zImage3060.json";
import editTemplate from "./flux2Edit3060.json";

export const story3060ImageEnabled=()=>local3060Enabled()&&process.env.OTG_STORY_IMAGE_3060==="1";
export const story3060ImageProfile="z-image-turbo-3060" as const;
export const story3060EditProfile="flux2-klein-edit-3060" as const;
export const story3060EditEnabled=()=>local3060Enabled()&&process.env.OTG_STORY_EDIT_3060==="1";
export const isStory3060Visual=(profile:StoryMediaRecord["profile"])=>profile===story3060ImageProfile||profile===story3060EditProfile;

export function story3060ImageGraph(record:StoryMediaRecord) {
  if(record.profile!==story3060ImageProfile||record.command.operation!=="image"||record.command.sourceId)throw Error("This request does not have the qualified RTX 3060 image profile.");
  const graph=structuredClone(graphTemplate);
  graph["27"].inputs.text=record.command.prompt;
  graph["3"].inputs.seed=randomInt(0,2**32);
  graph["9"].inputs.filename_prefix="story-3060/"+record.id;
  return graph;
}
async function editGraph(record:StoryMediaRecord,source:string) {
  const bytes=await sharp(source,{limitInputPixels:32_000_000}).rotate().resize({
    width:768,height:768,fit:"inside",withoutEnlargement:true,
  }).png().toBuffer();
  const name=record.id+".png", form=new FormData();
  form.set("image",new Blob([new Uint8Array(bytes)],{type:"image/png"}),name);
  form.set("subfolder","story-3060-input");
  form.set("type","input");
  form.set("overwrite","true");
  const uploaded=await localJson(LOCAL_COMFY+"/upload/image",{method:"POST",body:form});
  if(uploaded.name!==name||uploaded.subfolder!=="story-3060-input"||uploaded.type!=="input")
    throw Error("The RTX 3060 worker did not confirm the bound source image.");
  const graph=structuredClone(editTemplate);
  graph["76"].inputs.image=uploaded.subfolder+"/"+uploaded.name;
  graph["74"].inputs.text=record.command.prompt;
  graph["73"].inputs.noise_seed=randomInt(0,2**32);
  graph["9"].inputs.filename_prefix="story-3060/"+record.id;
  return graph;
}

export async function submitStory3060Image(record:StoryMediaRecord,source?:string){
  const editing=record.profile===story3060EditProfile;
  if(editing?(!story3060EditEnabled()||record.command.operation!=="edit"||!source||!record.command.sourceId):!story3060ImageEnabled())
    throw Error("This RTX 3060 Story image profile is unavailable. No substitute was started.");
  await check3060Gate();
  const graph=editing?await editGraph(record,source!):story3060ImageGraph(record);
  await enqueueComfyMedia({baseUrl:LOCAL_COMFY,workerId:"story-3060-image",body:{prompt:graph,client_id:"story-3060-"+record.id},producer:{kind:"story-3060-image",ownerKey:record.ownerKey,id:record.id,projectId:record.projectId}},id=>{
    const current=getStoryMedia(record.ownerKey,record.projectId,record.id);
    if(current.status!=="submitting")throw Error("The Story request changed before submission.");
    updateStoryMedia(current,{status:"running",backendJob:{promptId:id,comfyBaseUrl:LOCAL_COMFY,outputNodeId:"9",gpu:"rtx3060",engine:record.profile}});
  });
}
export async function collectStory3060Image(record:StoryMediaRecord,root:string){
  const id=String(record.backendJob?.promptId||""),job=getMediaQueueJob(id);
  if(!job||job.kind!=="comfy"||job.gpu!=="rtx3060")throw Error("The original 3060 image job is not available; no duplicate was submitted.");
  if(job.status==="unknown")return {error:"The original 3060 request is unconfirmed. No duplicate was submitted.",unknown:true};
  if(job.status==="failed"||job.status==="canceled")return {error:job.error||"The original 3060 image did not complete."};
  if(job.status!=="completed")return {};
  const history=await localJson(LOCAL_COMFY+"/history/"+encodeURIComponent(id));
  return readStory3060Image(record,root,history[id]);
}
export async function readStory3060Image(record:StoryMediaRecord,root:string,receipt:any){
  const images=receipt?.outputs?.["9"]?.images;
  if(!Array.isArray(images)||images.length!==1||images[0].type!=="output"||images[0].subfolder!=="story-3060"||!String(images[0].filename||"").startsWith(record.id+"_"))
    return {error:"The qualified worker did not return the owned image output."};
  const file=await retrieveRemoteComfyMedia({baseUrl:LOCAL_COMFY,trustedBaseUrls:[LOCAL_COMFY],file:images[0],storageRoot:root,destinationPath:path.join(root,"result.png"),kind:"image"});
  return {filePath:file.filePath};
}
export function cancelStory3060Image(record:StoryMediaRecord){
  const id=String(record.backendJob?.promptId||"");
  if(cancelQueuedMediaJob(id,LOCAL_COMFY))return updateStoryMedia(record,{status:"canceled",error:null});
  const job=getMediaQueueJob(id);
  if(!job||job.gpu!=="rtx3060"||job.kind!=="comfy")throw Error("The original image request could not be verified.");
  return updateStoryMedia(record,{cancelRequested:true});
}
