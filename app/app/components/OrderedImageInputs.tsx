"use client";
import React, {useEffect, useState} from "react";
import {assertReferenceCapacity} from "@/lib/imageReferenceLimits";

export default function OrderedImageInputs({files, maximum, disabled, onChange, onGallery}: {
  files: File[]; maximum: number; disabled?: boolean; onChange: (files: File[]) => void; onGallery?: () => void;
}) {
  const [previews, setPreviews] = useState<string[]>([]), [error, setError] = useState("");
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file)); setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  const button = "min-h-11 rounded-xl border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
  return <section className="space-y-3" aria-label="Ordered image inputs">
    <div className="flex flex-wrap items-center gap-2">
      <label className={`${button} cursor-pointer`}>Add Images<input type="file" multiple accept="image/*" hidden aria-label="Add edit images" data-max-files={Math.max(0,maximum-files.length)} disabled={disabled || files.length >= maximum} onChange={event => {
        const added = Array.from(event.target.files || []); event.currentTarget.value = "";
        try {assertReferenceCapacity(files.length, added.length, maximum); setError(""); onChange([...files, ...added]);}
        catch (e) {setError((e as Error).message);}
      }} /></label>
      {onGallery && <button type="button" className={button} disabled={disabled || files.length >= maximum} onClick={onGallery}>App Gallery</button>}
      <span className="text-sm text-white/60">{files.length}/{maximum} images</span>
    </div>
    <p className="text-xs text-white/60">Image 1 is the original. Put references in the order you want to use them.</p>
    {maximum>4&&files.length>3&&<p className="text-xs text-white/50">Large reference sets are fitted for GPU memory. Your original files stay unchanged.</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {files.map((file, index) => <article key={`${index}:${file.name}:${file.lastModified}`} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-white/10 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={previews[index]} alt={`Image ${index+1}: ${file.name}`} className="h-16 w-16 rounded-lg object-contain" />
      <span className="min-w-0 flex-1 break-words text-sm">{index+1}. {file.name}</span>
      {([-1,1] as const).map(direction => <button key={direction} type="button" className={button} aria-label={`Move image ${index+1} ${direction<0?'earlier':'later'}`} disabled={disabled || index+direction<0 || index+direction>=files.length} onClick={() => {const next=[...files]; [next[index],next[index+direction]]=[next[index+direction],next[index]]; onChange(next);}}>{direction<0?'Up':'Down'}</button>)}
      <button type="button" className={button} disabled={disabled} aria-label={`Remove image ${index+1}`} onClick={() => onChange(files.filter((_,i)=>i!==index))}>Remove</button>
    </article>)}
  </section>;
}
