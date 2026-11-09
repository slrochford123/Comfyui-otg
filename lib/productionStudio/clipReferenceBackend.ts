import {inspectH3SmartReferences,ownedH3SmartCapabilities} from "@/lib/h3SmartReferencesServer";
import {checkH3SmartReferences} from "@/lib/h3SmartReferences";
import {preferMediaGpu} from "@/lib/workers/mediaGpuQueue";
/** Qualify the whole reference layout before choosing a worker; a busy compatible GPU queues. */
export async function selectClipReferenceBackend(selection:unknown,images:{name:string;description:string}[],videos:number,audios:number,first:boolean,owner:string){
 const choices=await Promise.all((["rtx3090","rtx5060ti"] as const).map(async gpu=>{
  try{const cap=ownedH3SmartCapabilities(await inspectH3SmartReferences(gpu,true),owner);checkH3SmartReferences(cap,selection as Parameters<typeof checkH3SmartReferences>[1],images,videos,audios,first);return{gpu,error:""};}
  catch(e){return{gpu:null,error:`${gpu}: ${e instanceof Error?e.message:String(e)}`};}
 }));
 const selected=await preferMediaGpu(choices.flatMap(c=>c.gpu?[c.gpu]:[]));
 if(!selected)throw Error("No worker qualifies these reference inputs. "+choices.map(c=>c.error).join("; "));
 return selected;
}
