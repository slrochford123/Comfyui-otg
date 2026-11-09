"use client";
/* eslint-disable @next/next/no-img-element -- Private owner-authenticated reference images. */
import { useEffect,useState } from "react";
import type { CharacterRefCardPublic } from "@/lib/h3SpecialModes/characterRefCardContract";
import type { CreateItem } from "@/lib/productionStudio/createTypes";
import type { useStudio } from "./useStudio";
import { Button } from "./Controls";
export default function CreateRefMod({s,item}:{s:ReturnType<typeof useStudio>;item:CreateItem}){
  const [card,setCard]=useState<CharacterRefCardPublic|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=s.request,url=s.url;
  useEffect(()=>{if(!item.refCardId)return;let alive=true;const refresh=()=>void request(url+"/creation?itemId="+item.id).then(d=>{if(alive)setCard(d.card);}).catch(e=>{if(alive)setError(e.message);});refresh();const timer=setInterval(refresh,3000);return()=>{alive=false;clearInterval(timer);};},[url,request,item.id,item.refCardId]);
  const act=async(action:string,asset?:string)=>{if(["generate","regenerate","encode"].includes(action)&&!confirm(action==="encode"?"Approve these reference views and encode the full RefMod bundle? This uses a GPU, but does not create video.":"Generate character reference views using the shared GPU queue? No video will be generated."))return;setBusy(true);setError("");try{const data=await s.action("/creation",{itemId:item.id,action,asset,cardRevision:card?.revision,approved:true});setCard(data.card);}catch(e){setError(e instanceof Error?e.message:"RefMod action failed.");}finally{setBusy(false);}};
  const running=card&&["generating","encoding"].includes(card.state);
  return <div className="space-y-3"><p className="text-sm">Will this character need to stay consistent across several shots? A RefMod keeps the actual reference bundle; it is optional.</p>{error&&<p role="alert" className="text-amber-200">{error}</p>}
    {!item.refCardId?<Button disabled={busy||!s.saved} onClick={()=>void act("prepare-refmod")}>Create RefMod</Button>:<><p role="status" className="text-sm">{card?.message||"Loading saved RefMod preparation…"}</p>{card?.error&&<p role="alert">{card.error}</p>}
      {!!card?.views.length&&<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{card.views.map(v=><div key={v.id} className="text-xs space-y-1">{v.url?<img src={v.url} alt={v.label} className="h-28 w-full object-contain rounded-lg"/>:<p>{v.label} · {v.state}</p>}<p>{v.label}</p>{v.error&&<p>{v.error}</p>}{v.angle&&!running&&<Button disabled={busy} onClick={()=>void act("regenerate",v.id)}>Try View Again</Button>}</div>)}</div>}
      {card&&!running&&!card.views.length&&<Button disabled={busy} onClick={()=>void act("generate")}>Generate Four Views</Button>}
      {card&&!running&&card.state!=="completed"&&card.views.length>=4&&card.views.every(v=>v.state==="ready")&&<Button disabled={busy} onClick={()=>void act("encode")}>Approve Views & Create Bundle</Button>}
      {card?.state==="attention"&&<Button disabled={busy} onClick={()=>void act("resume")}>Check & Resume RefMod</Button>}
      {card?.state==="completed"&&<Button disabled={busy} onClick={()=>void act("pin-refmod")}>Use Completed RefMod</Button>}
    </>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy||!!running} onClick={()=>void s.commit({type:"create.refmod",itemId:item.id}).catch(e=>setError(e.message))}>Use Character Image Only</Button><Button disabled={busy||!!running} onClick={()=>void s.commit({type:"create.refmod",itemId:item.id}).catch(e=>setError(e.message))}>Skip for Now</Button></div>
  </div>;
}
