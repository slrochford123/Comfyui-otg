import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {NextRequest} from "next/server";
import {QWEN21_IMAGE_EDIT_WORKFLOW_ID} from "@/lib/imageGenerateWorkflows";
import {IMAGE_UPLOAD_FIELDS} from "@/lib/imageReferenceLimits";
import {updateStoryMedia,type StoryMediaRecord} from "@/lib/storyCreator/mediaStore";
import {assertAssetIntact} from "./media";
import type {StudioStore} from "./store";
import type {Project} from "./model";
import type {prepareShotImage} from "./shotPreparation";
export type StoryboardPreparation=ReturnType<typeof prepareShotImage>;
export async function submitQwenStoryboard(s:StudioStore,owner:string,p:Project,record:StoryMediaRecord,cookie:string,prepared:StoryboardPreparation){
 const form=new FormData();form.set("workflowId",QWEN21_IMAGE_EDIT_WORKFLOW_ID);form.set("requestKind","generate-qwen21-image-edit");form.set("sourceType","image-edit");form.set("prompt",prepared.prompt);form.set("positivePrompt",prepared.prompt);form.set("saveToGallery","false");form.set("orientation",p.brief.aspect);
 for(const [i,id]of prepared.referenceIds.entries()){
  const a=await assertAssetIntact(s,owner,p.id,id);
  if(a.asset.bytes>20*1024*1024)throw Error("Choose reference images no larger than 20 MB each.");
  const canvas=p.brief.aspect==="portrait"?{width:720,height:1280}:p.brief.aspect==="square"?{width:1024,height:1024}:{width:1280,height:720};
  const image=sharp(await fs.readFile(a.path),{limitInputPixels:268_402_689,animated:false}).rotate();
  // Only inference copies are fitted. The first image establishes the requested
  // canvas without cropping an approved identity or stretching the set.
  const bytes=await(i===0?image.resize({...canvas,fit:"contain",background:"#808080"}):image.resize({width:1536,height:1536,fit:"inside",withoutEnlargement:true})).png().toBuffer();
  form.set(IMAGE_UPLOAD_FIELDS[i],new File([new Uint8Array(bytes)],`studio-${record.id}-${i+1}.png`,{type:"image/png"}));
 }
 const {POST}=await import("@/app/api/comfy/route");
 const host=new URL(process.env.OTG_MEDIA_3090_IMAGE_URL||"http://100.75.162.64:8188").hostname;
 const response=await POST(new NextRequest(`http://${host}:3001/api/comfy`,{method:"POST",headers:{cookie},body:form})),data=await response.json();
 if(!response.ok||data.ok===false)return updateStoryMedia(record,{status:response.status<500?"failed":"unknown",error:String(data.error||"Qwen storyboard submission could not be confirmed.")});
 const promptId=String(data.prompt_id||data.promptId||"");
 if(!promptId)return updateStoryMedia(record,{status:"unknown",error:"Qwen did not confirm a prompt ID. Check the original job before retrying."});
 return updateStoryMedia(record,{status:"running",backendJob:{promptId,comfyBaseUrl:data.qwenTurbo?.comfyBaseUrl,outputNodeId:"461",engine:"qwen-image-edit-2.1-turbo",seed:data.qwenTurbo?.seed}});
}
export async function refreshQwenStoryboard(s:StudioStore,owner:string,project:string,record:StoryMediaRecord){
 if(record.status!=="running"||!record.backendJob?.promptId)return record;
 const {ownedPromptMeta}=await import("@/lib/comfyMediaAccess"),{resolveComfyPromptImageStatus,candidateComfyImageBaseUrls}=await import("@/lib/comfyImageOutputLookup"),{getMediaQueueJob}=await import("@/lib/workers/mediaGpuQueue");
 const id=String(record.backendJob.promptId),queue=getMediaQueueJob(id);
 if(queue&&["failed","canceled","unknown"].includes(queue.status))return updateStoryMedia(record,{status:queue.status as "failed"|"canceled"|"unknown",error:queue.error||"Qwen queue needs attention."});
 const meta=ownedPromptMeta(owner,id),result=await resolveComfyPromptImageStatus({promptId:id,preferredBaseUrl:meta.comfyBaseUrl||record.backendJob.comfyBaseUrl,strictPreferred:true,filters:{nodeId:"461"}});
 if(["failed","missing_output"].includes(result.status))return updateStoryMedia(record,{status:"failed",error:result.error||"Qwen finished without an image."});
 if(result.status==="completed"&&result.image){
  s.get(owner,project);
  const {retrieveRemoteComfyMedia}=await import("@/lib/storyCreator/remoteComfyMedia"),{storyMediaRoot}=await import("@/lib/storyCreator/mediaExecution"),root=storyMediaRoot(record);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const saved=await retrieveRemoteComfyMedia({baseUrl:result.baseUrl,trustedBaseUrls:candidateComfyImageBaseUrls(),file:result.image,storageRoot:root,destinationPath:path.join(root,`${record.id}-qwen.png`),kind:"image"});
  return updateStoryMedia(record,{status:"ready",filePath:saved.filePath});
 }
 return record;
}
