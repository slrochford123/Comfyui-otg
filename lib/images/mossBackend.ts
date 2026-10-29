import { mossBackend, mossSupport, type MossTarget } from "./mossImage";

export async function routeMossTarget(target: MossTarget): Promise<MossTarget> {
  const {mediaGpuRoutingEnabled}=await import("@/lib/mediaGpuRoutingServer");
  if(mediaGpuRoutingEnabled()) {
    const {chooseMediaImageBackend}=await import("./mediaGpuBackend");
    const selected=await chooseMediaImageBackend({primary3090:mossBackend("3090"),secondary5060:mossBackend("5060ti"),allow5060:true,
      validate:async base=>{
        try {
          const response=await fetch(base+"/object_info",{cache:"no-store",signal:AbortSignal.timeout(12000)});
          if(!response.ok)return {ok:false,reason:`Worker unavailable (${response.status}).`};
          const reason=mossSupport(await response.json(),base===mossBackend("3090")?"3090":"5060ti");
          return {ok:!reason,reason:reason||""};
        }catch{return {ok:false,reason:"Worker readiness could not be verified."};}
      }});
    return selected?.baseUrl===mossBackend("3090")?"3090":"5060ti";
  }
  return target;
}
export async function chooseMossBackend(target: MossTarget) {
  const baseUrl = mossBackend(target);
  const response = await fetch(`${baseUrl}/object_info`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`MOSS worker unavailable (${response.status}).`);
  const missing = mossSupport(await response.json(), target);
  if (missing) throw new Error(`MOSS on RTX ${target === "3090" ? "3090" : "5060 Ti"}: ${missing}`);
  return { baseUrl, label: target === "3090" ? "local-3090" : "image-primary", fallbackUsed: false };
}
