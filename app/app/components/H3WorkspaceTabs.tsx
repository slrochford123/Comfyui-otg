"use client";
import React from "react";
export type H3WorkspaceTab={id:string;label:string;unavailable?:string};
/** Shared navigation for standard H3 and the permission-scoped NSFW profile. */
export default function H3WorkspaceTabs({label,value,items,onChange,disabled=false,className="",buttonClass="min-h-11 rounded-xl border border-white/15 px-3 py-2 font-medium",activeClass="bg-violet-600/50 border-violet-400/60"}:{label:string;value:string;items:H3WorkspaceTab[];onChange:(id:string)=>void;disabled?:boolean;className?:string;buttonClass?:string;activeClass?:string}) {
 return <div className={"flex flex-wrap gap-2 "+className} role="group" aria-label={label}>{items.map(item=><button key={item.id} type="button" className={buttonClass+" disabled:opacity-40 "+(value===item.id?activeClass:"")} disabled={disabled||!!item.unavailable} title={item.unavailable} aria-pressed={value===item.id} onClick={()=>onChange(item.id)}>{item.label}</button>)}</div>;
}
