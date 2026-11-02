"use client";
import {useState} from "react";
import type {NsfwAccess} from "@/lib/experiments/nsfwAccess";
export default function H3NsfwUserControl({userId,username,access,onChange}:{userId:string;username:string;access:NsfwAccess;onChange:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function change(enabled:boolean){setBusy(true);setError('');try{const r=await fetch('/api/admin/h3-nsfw-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,enabled,version:access.version})});const b=await r.json();if(!r.ok)throw Error(b.error);onChange();}catch(e){setError(e instanceof Error?e.message:'Access update failed.');}finally{setBusy(false);}}
  return <div className="my-2 text-sm"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" role="switch" aria-label={`H3 NSFW access for ${username}`} checked={access.enabled} disabled={busy||access.admin} onChange={e=>void change(e.target.checked)}/>H3 NSFW · {access.admin?'Always enabled':access.enabled?'Enabled':'Disabled'}</label>
    {access.status==='pending'&&<div><p className="text-amber-300">Approval requested{access.requestedAt?' · '+new Date(access.requestedAt).toLocaleString():''}</p><button type="button" disabled={busy} className="min-h-11 underline" onClick={()=>void change(false)}>Decline request</button></div>}
    {access.updatedAt&&<p className="text-xs opacity-70">Updated {new Date(access.updatedAt).toLocaleString()}</p>}{error&&<p role="alert" className="text-red-300">{error}</p>}
  </div>;
}
