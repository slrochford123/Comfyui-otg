export const ACE_MODELS = {turbo:"acestep-v15-xl-turbo",base:"acestep-v15-xl-base",sft:"acestep-v15-xl-sft"} as const;
export type AcePreset = keyof typeof ACE_MODELS;
export function aceModelName(value: unknown) {
  const key = String(value || "turbo").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ACE_MODELS,key)) throw new Error("Choose a supported ACE-Step model.");
  return ACE_MODELS[key as AcePreset];
}
export function aceModelSettings(value:unknown){
  const name=aceModelName(value);const turbo=name===ACE_MODELS.turbo;
  return {name,inferenceSteps:turbo?8:50,guidanceScale:turbo?1:7};
}
export async function aceStepReadiness(base: string) {
  const [healthResponse,inventoryResponse,statsResponse] = await Promise.all([
    fetch(`${base}/health`,{cache:"no-store",signal:AbortSignal.timeout(5000)}),
    fetch(`${base}/v1/model_inventory`,{cache:"no-store",signal:AbortSignal.timeout(5000)}),
    fetch(`${base}/v1/stats`,{cache:"no-store",signal:AbortSignal.timeout(5000)}),
  ]);
  if(!healthResponse.ok||!inventoryResponse.ok||!statsResponse.ok) throw Error("ACE-Step is unavailable.");
  const rawHealth=await healthResponse.json();const rawInventory=await inventoryResponse.json();
  const health=rawHealth.data||rawHealth,inventory=rawInventory.data||rawInventory;
  const rawStats=await statsResponse.json();const stats=rawStats.data||rawStats;
  if(!Number.isFinite(stats.queue_size)||!Number.isFinite(stats.jobs?.running)||!Number.isFinite(stats.jobs?.queued))throw Error("ACE-Step queue readiness is unavailable.");
  const busy=stats.queue_size>0||stats.jobs.running>0||stats.jobs.queued>0;
  const models=Array.isArray(inventory.models)?inventory.models:[];
  const initialized=health.models_initialized===true;
  return {reachable:true,initialized,busy,presets:Object.fromEntries(Object.entries(ACE_MODELS).map(([key,name])=>{
    const model=models.find((x:any)=>x.name===name);
    return [key,{name,installed:!!model,ready:initialized&&!busy&&model?.is_loaded===true}];
  })) as Record<AcePreset,{name:string;installed:boolean;ready:boolean}>};
}
