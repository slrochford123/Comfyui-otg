"use client";
import {useState} from "react";
import {useH3NsfwAccess} from "@/lib/client/useH3NsfwAccess";
export default function H3NsfwAccessRequest(){
  const {access,setAccess}=useH3NsfwAccess(true);const [ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function request(){setBusy(true);setError('');try{const r=await fetch('/api/h3/nsfw/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({acknowledged:ack})});const b=await r.json();if(!r.ok)throw Error(b.error);setAccess(b.access);}catch(e){setError(e instanceof Error?e.message:'Could not request access.');}finally{setBusy(false);}}
  return <section aria-label="H3 NSFW access" className="rounded-xl border border-white/15 p-4 lg:col-span-2">
    <h2 className="text-lg font-semibold">H3 NSFW access</h2>
    <p className="my-2 text-sm text-white/70">Optional restricted H3 models. Access is disabled until an administrator approves your account. Normal H3 stays available.</p>
    <p role="status" className="text-sm">{!access?'Checking access…':access.admin?'Always enabled for administrators':access.enabled?'Enabled · open H3 → H3 NSFW':access.status==='pending'?'Pending administrator approval':'Disabled'}</p>
    {access&&!access.enabled&&access.status!=='pending'&&<><label className="my-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I am 18 or older and have permission to use my references. I understand that access does not permit prohibited or non-consensual content.</label><button type="button" disabled={busy||!ack} className="min-h-11 rounded-lg border border-violet-300/40 px-4 disabled:opacity-40" onClick={()=>void request()}>{busy?'Requesting…':'Request NSFW approval'}</button></>}
    {error&&<p role="alert" className="mt-2 text-red-300">{error}</p>}
  </section>;
}
