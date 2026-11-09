"use client";
/* eslint-disable @next/next/no-img-element -- Private same-origin media, never shared optimizer caches. */
import { useState } from "react";
import type { Asset } from "@/lib/productionStudio/model";
import { Button,mediaUrl } from "./Controls";
export default function AssetPreview({asset,compact=false}:{asset:Asset;compact?:boolean}){
  const [error,setError]=useState(false),[retry,setRetry]=useState(0),[duration,setDuration]=useState(Number(asset.metadata.duration)||0);
  const url=mediaUrl(asset.projectId,asset.id)+(retry?`?retry=${retry}`:"");
  if(error)return <div role="alert" className="rounded-xl border border-amber-400/30 p-2 text-xs">{asset.kind==="audio"?"Audio unavailable or unsupported":"Image unavailable"}. It cannot be confirmed as a working reference.<Button onClick={()=>{setError(false);setRetry(n=>n+1);}}>Retry media</Button></div>;
  if(asset.kind==="audio")return <div className="min-w-0 space-y-1"><audio key={url} aria-label={asset.name} controls preload="metadata" src={url} className="w-full max-w-full h-10" onLoadedMetadata={e=>{const n=e.currentTarget.duration;if(Number.isFinite(n)&&n>0)setDuration(n);}} onError={()=>setError(true)}/><p className="text-xs text-white/60">{duration>0?`${duration.toFixed(1)} seconds` : "Loading audio metadata…"}</p></div>;
  if(!asset.mime.startsWith("image/"))return <span className="text-xs">{asset.kind==="refmod"?"RefMod bundle":"Saved media"}</span>;
  return <img key={url} alt={asset.name} src={url} loading="lazy" decoding="async" onError={()=>setError(true)} className={compact?"h-16 w-16 shrink-0 rounded-lg object-contain bg-black/20":"max-h-64 w-full rounded-xl object-contain bg-black/20"}/>;
}
