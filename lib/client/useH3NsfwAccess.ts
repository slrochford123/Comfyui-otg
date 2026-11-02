"use client";
import { useEffect, useState } from "react";
import type { NsfwAccess } from "@/lib/experiments/nsfwAccess";
export function useH3NsfwAccess(enabled:boolean) {
  const [access,setAccess]=useState<NsfwAccess|null>(null);
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();let loading=false;
    async function refresh(){
      if(loading||document.visibilityState==="hidden")return;loading=true;
      try{const r=await fetch('/api/h3/nsfw/access',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const body=await r.json();if(!controller.signal.aborted)setAccess(body.access);}
      catch{if(!controller.signal.aborted)setAccess(null);}finally{loading=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[enabled]);
  return {access:enabled?access:null,setAccess};
}
