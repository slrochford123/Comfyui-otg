"use client";

import {useEffect,useRef,useState} from "react";

export type SavedUploadPreview = {id:string;name:string;kind:"image"|"video"|"audio";url?:string;file?:File};
const button="min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400";

function Thumbnail({item}:{item:SavedUploadPreview}) {
  const element=useRef<HTMLImageElement|HTMLVideoElement|null>(null);
  useEffect(()=>{
    if (!item.file) return;
    const url=URL.createObjectURL(item.file);if(element.current)element.current.src=url;
    return ()=>URL.revokeObjectURL(url);
  },[item.file]);
  const src=item.url;
  return <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/40">
    {/* Owner-authenticated URL or a device-local Blob; no third-party preview service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {item.kind==="image"&&(src||item.file) ? <img ref={node=>{element.current=node;}} src={src} className="h-full w-full object-cover" width={56} height={56} alt={`Preview of ${item.name}`} loading="lazy" decoding="async"/>
      :item.kind==="video"&&(src||item.file) ? <video ref={node=>{element.current=node;}} src={src} className="h-full w-full object-cover" preload="metadata" muted playsInline aria-label={`Video preview of ${item.name}`}/>
      :<span className="text-xs text-white/70">{item.kind==="audio"?"Audio":"Preview"}</span>}
  </div>;
}

export default function H3SavedUploads({items,disabled=false,canAdd,onAdd,onRemove,note,children}:{
  items:SavedUploadPreview[];disabled?:boolean;canAdd:(item:SavedUploadPreview)=>boolean;
  onAdd:(id:string)=>void;onRemove:(id:string)=>void;note?:string;children?:React.ReactNode;
}) {
  const [limit,setLimit]=useState(20);
  if (!items.length) return null;
  return <details className="min-w-0" data-otg="h3-saved-uploads">
    <summary className="min-h-11 cursor-pointer py-2 text-sm">Saved uploads · {items.length}</summary>
    {note&&<p className="mb-2 text-xs text-white/60">{note}</p>}
    {children}
    <ul className="space-y-2">{items.slice(0,limit).map(item=><li className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-white/10 p-2" key={item.id}>
      <Thumbnail item={item}/><span className="min-w-0 flex-1 break-words text-sm" title={item.name}>{item.name}</span>
      <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
        <button type="button" className={button} disabled={disabled||!canAdd(item)} aria-label={`Add back ${item.name}`} onClick={()=>onAdd(item.id)}>Add back</button>
        <button type="button" className={button} disabled={disabled} aria-label={`Remove saved upload ${item.name}`} onClick={()=>onRemove(item.id)}>Remove</button>
      </div>
    </li>)}</ul>
    {items.length>limit&&<button type="button" className={`${button} mt-2`} onClick={()=>setLimit(n=>n+20)}>Show more saved uploads</button>}
  </details>;
}
