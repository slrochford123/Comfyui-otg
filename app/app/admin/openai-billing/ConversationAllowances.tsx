"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";

const endpoint="/api/admin/openai-billing";
const usd=(n:number)=>"$"+(n/1e9).toFixed(4);
type Account={id:string;username:string;email:string;admin:boolean;availableNanos:number|null;spentNanos:number;heldNanos:number;requested:boolean};
type Ledger={accounts:Account[];events:Array<{account:string;event_key:string;ts:number;kind:string;nanos:number;actor:string;note:string}>;
  unknown:Array<{account:string;reservation:string;model:string;reserved_nanos:number;provider_id:string|null}>};

export default function ConversationAllowances(){
  const [data,setData]=useState<Ledger|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [account,setAccount]=useState(""),[kind,setKind]=useState("complimentary"),[amount,setAmount]=useState(""),[note,setNote]=useState("");
  const [hold,setHold]=useState(""),[proof,setProof]=useState("");
  const key=useRef<{payload:string;key:string}|null>(null);
  const refresh=useCallback(async()=>{
    const res=await fetch(endpoint+"?view=allowances",{cache:"no-store"});
    const payload=await res.json();
    if(!res.ok)throw Error(payload.error||"Unable to load conversational credits.");
    if(Array.isArray(payload.accounts))setData(payload);
  },[]);
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[refresh]);
  if(!data)return error?<p role="alert">{error}</p>:null;
  async function submit(event:FormEvent,release=false){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try{
      const fields={accountId:account,kind,amountUsd:Number(amount),note};
      const serialized=JSON.stringify(fields);
      if(key.current?.payload!==serialized)key.current={payload:serialized,key:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join("")};
      const body=release?{action:"conversation-release-unbilled",reservation:hold,note:proof}
        :{action:"conversation-credit",...fields,key:key.current!.key};
      const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await res.json();
      if(!res.ok||!result.ok)throw Error(result.error||"Could not update credits.");
      key.current=null;
      if(release){setHold("");setProof("");}else{setAmount("");setNote("");}
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function reconcile(){
    if(busy||!hold)return;
    setBusy(true);setError("");
    try{
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"conversation-reconcile",reservation:hold})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(result.error||"No verified usage was available.");
      setHold("");setProof("");await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section className="my-5 space-y-3 rounded-lg border border-white/15 p-4">
    <h2 className="text-xl font-bold">Conversational Allowances</h2>
    <p className="text-sm">Account credits are separate from the OpenAI organization balance. Purchases are recorded after payment is confirmed.</p>
    <button type="button" className="otg-authShowBtn" onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh allowances</button>
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-left text-sm"><thead><tr><th>Account</th><th>Available</th><th>Actual used</th><th>Held</th></tr></thead><tbody>
        {data.accounts.map(a=><tr key={a.id}><td>{a.username||a.email}{a.requested?" · Requested credit":""}</td>
          <td>{a.admin?"Unlimited":usd(a.availableNanos||0)}{a.availableNanos===0?" · Depleted":""}</td><td>{usd(a.spentNanos)}</td><td>{usd(a.heldNanos)}</td></tr>)}
      </tbody></table>
    </div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
      <label>Account <select required value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>
        {data.accounts.filter(a=>!a.admin).map(a=><option key={a.id} value={a.id}>{a.username||a.email}</option>)}</select></label>
      <label>Type <select value={kind} onChange={e=>setKind(e.target.value)}><option value="complimentary">Complimentary</option>
        <option value="purchase">Confirmed purchase</option><option value="adjustment">Adjustment</option></select></label>
      <label>Amount (USD) <input required type="number" step="any" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
      <label>Reason <input required maxLength={500} value={note} onChange={e=>setNote(e.target.value)} /></label>
      <button className="otg-authShowBtn" disabled={busy}>Apply credit</button>
    </form>
    {data.unknown.length>0&&<form className="flex flex-wrap items-end gap-3" onSubmit={e=>void submit(e,true)}>
      <label>Uncertain request <select required value={hold} onChange={e=>setHold(e.target.value)}><option value="">Select hold</option>
        {data.unknown.map(r=><option key={r.reservation} value={r.reservation}>{r.model} · {usd(r.reserved_nanos)} · {r.provider_id||r.reservation}</option>)}</select></label>
      <label>Evidence that no usage was billed <input required maxLength={500} value={proof} onChange={e=>setProof(e.target.value)} /></label>
      <button className="otg-authShowBtn" disabled={busy}>Release confirmed unbilled hold</button>
      <button type="button" className="otg-authShowBtn" disabled={busy||!data.unknown.find(r=>r.reservation===hold)?.provider_id} onClick={()=>void reconcile()}>Check stored OpenAI usage</button>
    </form>}
    {error&&<p role="alert">{error}</p>}
    <details><summary>Credit adjustment history</summary><ul className="max-h-64 overflow-auto text-sm">
      {data.events.map(e=><li key={e.account+e.event_key}>{new Date(e.ts).toLocaleString()} · {data.accounts.find(a=>a.id===e.account)?.username||e.account}
        {" · "}{e.kind} · {usd(e.nanos)} · {e.note} · By {data.accounts.find(a=>a.id===e.actor)?.username||e.actor}</li>)}
    </ul></details>
  </section>;
}
