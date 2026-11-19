"use client";
import React from "react";
export default function H3EnhanceButtons({disabled,busy,selected,onEnhance,buttonClass="min-h-11 rounded-xl border border-white/20 px-3 py-2 disabled:opacity-40"}:{disabled:boolean;busy?:string|null;selected?:"short"|"medium"|"long";onEnhance:(level:"short"|"medium"|"long")=>void;buttonClass?:string}) {
 return <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Enhance"><span className="text-sm font-semibold">Enhance</span>{(["short","medium","long"] as const).map(level=><button type="button" key={level} className={buttonClass} disabled={disabled||!!busy} aria-pressed={selected?selected===level:undefined} onClick={()=>onEnhance(level)}>{busy===level?"Enhancing…":level[0].toUpperCase()+level.slice(1)}</button>)}</div>;
}
