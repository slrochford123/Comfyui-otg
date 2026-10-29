import {mediaGpuRoutingEnabled,requestedMediaGpu} from "@/lib/mediaGpuRoutingServer";
import {mediaGpuCandidates,type MediaGpu} from "@/lib/mediaGpuRouting";
import {preferMediaGpu} from "@/lib/workers/mediaGpuQueue";

/** Reuse each tool's exact model/node/LoRA validator, not a generic GPU-name substitution. */
export async function chooseMediaImageBackend(args:{primary3090:string;secondary5060:string;allow5060:boolean;
  validate:(base:string)=>Promise<{ok:boolean;reason:string}>}) {
  if(!mediaGpuRoutingEnabled())return null;
  const choice=await requestedMediaGpu();
  const urls={rtx3090:args.primary3090,rtx5060ti:args.secondary5060};
  const compatible:MediaGpu[]=[],reasons:string[]=[];
  for(const gpu of mediaGpuCandidates(choice,args.allow5060?["rtx3090","rtx5060ti"]:["rtx3090"])){
    const probe=await args.validate(urls[gpu]);
    if(probe.ok)compatible.push(gpu);else reasons.push(`${gpu}: ${probe.reason}`);
  }
  const gpu=await preferMediaGpu(compatible);
  if(!gpu)throw Error(`This image model is not available for ${choice}. No model or GPU was silently substituted. ${reasons.join("; ")}`);
  return {baseUrl:urls[gpu],label:gpu==="rtx3090"?"local-3090":"image-primary",fallbackUsed:gpu==="rtx5060ti"};
}
