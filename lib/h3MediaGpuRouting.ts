import { MEDIA_GPUS, mediaGpuCandidates, type MediaGpu } from "./mediaGpuRouting";
import { requestedMediaGpu, mediaGpuRoutingEnabled } from "./mediaGpuRoutingServer";
import { preferMediaGpu } from "./workers/mediaGpuQueue";
import { compileH3StudioPlan } from "./h3StudioCompiler";
import { studioBoundCompilerInput, type StudioMediaSet } from "./h3StudioMedia";
import { inspectH3StudioInventory, readH3StudioEvidence } from "./h3StudioRegistry";
import type { H3StudioPlan } from "./h3StudioPlan";

/** Resolve BEFORE creating a review; never mutate a signed/executing plan. */
export async function routeH3MediaPlan(plan: H3StudioPlan, media: StudioMediaSet, owner: string) {
  if (!mediaGpuRoutingEnabled()) return plan;
  const choice=await requestedMediaGpu();
  const compatible:MediaGpu[]=[];
  const reasons:string[]=[];
  for (const backend of mediaGpuCandidates(choice,MEDIA_GPUS)) {
    try {
      const candidate={...plan,backend};
      const built=compileH3StudioPlan(candidate,studioBoundCompilerInput(candidate,media),
        await inspectH3StudioInventory(undefined,backend),readH3StudioEvidence(backend),{ownerKey:owner});
      if(built.manifest.executable)compatible.push(backend);
      else reasons.push(`${backend}: ${built.manifest.blockedReasons.join("; ")}`);
    }catch(error){reasons.push(`${backend}: ${error instanceof Error?error.message:"Configuration unavailable"}`);}
  }
  const backend=await preferMediaGpu(compatible);
  if(!backend)throw Error(`No compatible H3 configuration for ${choice}. ${reasons.join(" | ")}`);
  return {...plan,backend};
}
