"use client";
import {useCallback,useEffect,useState,useSyncExternalStore} from "react";

const ENABLED=process.env.NEXT_PUBLIC_OTG_LOCAL_AI_3060==="1";
const ALLOWANCE=process.env.NEXT_PUBLIC_OTG_OPENAI_CONVERSATION_CREDITS==="1";
const key=(scope:string)=>`otg:assistant-provider:${ALLOWANCE?"v2":"v1"}:${scope}`;
const defaultProvider=ALLOWANCE?"openai":"local3060";
const eventName="otg:assistant-provider";
const subscribe=(notify:()=>void)=>{
  window.addEventListener("storage",notify);
  window.addEventListener(eventName,notify);
  return()=>{window.removeEventListener("storage",notify);window.removeEventListener(eventName,notify);};
};
export function selectedAssistantProvider(scope:string){
  if(!ENABLED||typeof window==="undefined")return undefined;
  try{const value=localStorage.getItem(key(scope));return value==="openai"||value==="local3060"?value:defaultProvider;}catch{return defaultProvider;}
}
type Allowance={enabled:boolean;admin:boolean;openAIAvailable:boolean;availableNanos:number|null;requested:boolean;
  lastRoute:{provider:"openai"|"local3060";reason:string|null}|null};
export default function AssistantProviderPicker({scope,disabled,feature=scope.startsWith("production:")?"production-studio":scope.startsWith("story:")?"story-creator":"ai-assistants"}:{scope:string;disabled?:boolean;feature?:string}){
  const value=useSyncExternalStore(subscribe,()=>selectedAssistantProvider(scope),()=>ENABLED?defaultProvider:undefined);
  const [credit,setCredit]=useState<Allowance|null>(null);
  const [requesting,setRequesting]=useState(false);
  const [error,setError]=useState("");
  const url="/api/openai-ai/allowance?feature="+encodeURIComponent(feature);
  const refresh=useCallback(async()=>{
    try{const response=await fetch(url,{cache:"no-store"});if(response.ok){const info=await response.json();setCredit(info.enabled?info:null);}}
    catch{/* Conversation controls stay usable during a status refresh failure. */}
  },[url]);
  useEffect(()=>{
    if(!ALLOWANCE)return;
    void refresh();
    const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},15_000);
    window.addEventListener("focus",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[refresh,disabled]);
  async function requestCredit(){
    setRequesting(true);setError("");
    try{const response=await fetch(url,{method:"POST"});if(!response.ok)throw Error();
      setCredit(await response.json());
    }catch{setError("Could not request credit. Try again or contact the administrator.");}
    finally{setRequesting(false);}
  }
  if(!ENABLED)return null;
  const exhausted=credit?.availableNanos===0;
  const low=credit?.availableNanos!=null&&credit.availableNanos<=1e9;
  const active=value==="local3060"||exhausted?"Local RTX 3060":credit?.lastRoute?.provider==="local3060"?"Local RTX 3060":"OpenAI";
  return <div className="space-y-1 text-sm">
    <label className="flex flex-wrap items-center gap-2"><span>AI provider</span>
    <select value={value} disabled={disabled} className="rounded-lg border border-white/20 bg-slate-950 p-2"
      onChange={e=>{try{localStorage.setItem(key(scope),e.currentTarget.value);window.dispatchEvent(new Event(eventName));}catch{/* Keep the default. */}}}>
      <option value="local3060">Local · RTX 3060</option>
      <option value="openai">{ALLOWANCE?"OpenAI first · automatic local fallback":"OpenAI · uses allowance"}</option>
    </select>
    </label>
    {credit&&<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span role="status">{active} · {credit.admin?"Unlimited app allowance":`$${((credit.availableNanos||0)/1e9).toFixed(2)} OpenAI credit`}
        {credit.lastRoute?.reason==="global-budget"?" · The site-wide OpenAI budget was reached. Conversations continue on RTX 3060.":exhausted?" · Credit depleted. Conversations continue on RTX 3060.":credit.lastRoute?.reason==="allowance"?" · The latest request used local AI because available credit was insufficient.":low?" · Allowance running low.":""}
        {!credit.openAIAvailable&&" · OpenAI unavailable."}</span>
      {!credit.admin&&<><button type="button" className="min-h-9 underline" disabled={requesting||credit.requested} onClick={requestCredit}>{credit.requested?"Credit requested":"Request Additional Credit"}</button>
        <a className="underline" href="mailto:slrochford123@gmail.com?subject=SLR%20Studios%20OpenAI%20credit">Contact Administrator</a></>}
    </div>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
