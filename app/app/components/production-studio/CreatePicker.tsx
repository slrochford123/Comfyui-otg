"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated owner media. */
import { useEffect,useState } from "react";
import type { Asset } from "@/lib/productionStudio/model";
import type { RequirementKind } from "@/lib/productionStudio/createTypes";
import { groupedAssets } from "@/lib/productionStudio/assetGroups";
import type { useStudio } from "./useStudio";
import { Button,inputClass } from "./Controls";
import AssetPreview from "./AssetPreview";
type Catalog={characters:{id:string;name:string;hasVoice:boolean;hasRefMod:boolean}[];locations:{id:string;name:string}[];props:{id:string;name:string}[];voices:{id:string;name:string}[];audio:{id:string;name:string}[];productions:(Asset&{productionName:string})[]};
export default function CreatePicker({s,kind,onPick}:{s:ReturnType<typeof useStudio>;kind:RequirementKind|"voice"|"image-reference";onPick:(asset:Asset)=>Promise<void>}){
  const [catalog,setCatalog]=useState<Catalog|null>(null),[search,setSearch]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[gallery,setGallery]=useState<{name:string;url:string;source:string}[]|null>(null);
  const request=s.request,url=s.url;
  useEffect(()=>{const controller=new AbortController();void request(url+"/catalog",{signal:controller.signal}).then(setCatalog).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[url,request]);
  const audio=["voice","music","sfx","ambience"].includes(kind),match=(name:string)=>name.toLowerCase().includes(search.trim().toLowerCase()),suitable=(a:Asset)=>audio?a.kind==="audio":a.mime.startsWith("image/");
  const local=groupedAssets(s.assets).filter(suitable).filter(a=>match(a.name));
  const entries=catalog?(kind==="image-reference"?[...catalog.characters.map(c=>({...c,kind:"character"})),...catalog.locations.map(c=>({...c,kind:"location"})),...catalog.props.map(c=>({...c,kind:"prop"}))]:kind==="character"?catalog.characters.map(c=>({...c,kind:"character"})):kind==="environment"?catalog.locations.map(c=>({...c,kind:"location"})):kind==="voice"?catalog.voices.map(c=>({...c,kind:"voice"})):audio?catalog.audio.map(c=>({...c,kind:"audio"})):catalog.props.map(c=>({...c,kind:"prop"}))):[];
  const choose=async(fn:()=>Promise<Asset>)=>{setBusy(true);setError("");try{await onPick(await fn());}catch(e){setError(e instanceof Error?e.message:"Could not pin this asset.");}finally{setBusy(false);}};
  return <div className="space-y-3 rounded-xl border border-purple-400/20 p-3"><label className="block text-sm">Search saved assets<input aria-label="Search saved assets" className={inputClass} value={search} onChange={e=>setSearch(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}
    <div className="max-h-80 overflow-y-auto space-y-2" aria-label="Saved asset choices">
      {local.map(a=><div key={a.id} className="flex items-center gap-2 rounded-lg bg-white/5 p-2 min-w-0"><div className={audio?"min-w-0 flex-1":"shrink-0"}><AssetPreview asset={a} compact/></div><div className="min-w-0 flex-1"><p className="text-sm break-words">{a.name}</p>{a.kind==="character"&&<p className="text-xs text-white/60">Grouped character reference views</p>}<Button disabled={busy} onClick={()=>void choose(async()=>a)}>Choose</Button></div></div>)}
      {entries.filter(a=>match(a.name)).map(a=><div key={a.kind+a.id} className="flex gap-2 items-center justify-between rounded-lg bg-white/5 p-2"><p className="text-sm break-words">{a.name}</p><Button disabled={busy} onClick={()=>void choose(async()=>{const data=await s.action("/catalog",{kind:a.kind,sourceId:a.id});return data.asset;})}>Preview & Pin</Button></div>)}
      {catalog?.productions.filter(suitable).filter(a=>match(a.name)||match(a.productionName)).map(a=><div key={a.id} className="flex gap-2 items-center rounded-lg bg-white/5 p-2"><div className={audio?"min-w-0 flex-1":"shrink-0"}><AssetPreview asset={a} compact/></div><div className="min-w-0 flex-1"><p className="text-sm break-words">{a.name} · {a.productionName}</p><Button disabled={busy} onClick={()=>void choose(async()=>{const data=await s.action("/catalog",{kind:"production",sourceProject:a.projectId,sourceId:a.id});return data.asset;})}>Use Copy</Button></div></div>)}
      {catalog&&!local.length&&!entries.length&&!catalog.productions.some(suitable)&&<p className="text-sm text-white/60">No saved matches yet. Upload a reference or create one.</p>}
    </div>
    {!audio&&<details onToggle={e=>{if(e.currentTarget.open&&!gallery)void s.request("/api/gallery?media=image&per=60").then(d=>setGallery(d.items)).catch(e=>setError(e.message));}}><summary className="cursor-pointer text-sm">Image Gallery</summary><div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-80 overflow-y-auto mt-2">{gallery?.filter(a=>match(a.name)).map(a=><GalleryChoice key={a.source+a.name} item={a} busy={busy} choose={()=>void choose(async()=>{const data=await s.action("/catalog",{kind:"gallery",sourceId:a.name,scope:a.source});return data.asset;})}/>)}</div><p className="text-xs text-white/60">Latest 60 images. Other saved assets remain in their libraries.</p></details>}
  </div>;
}
function GalleryChoice({item,busy,choose}:{item:{url:string;name:string};busy:boolean;choose:()=>void}){const[failed,setFailed]=useState(false);return <div className="min-w-0">{failed?<p className="text-xs">Image unavailable</p>:<img src={item.url} alt={item.name} loading="lazy" className="h-20 w-full object-contain" onError={()=>setFailed(true)}/>}<Button disabled={busy||failed} onClick={choose}>Choose Image</Button></div>;}
