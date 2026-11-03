"use client";
import React, {useEffect,useRef,useState} from "react";
import {GOOGLE_PHOTOS_ATTEMPT_KEY,GOOGLE_PHOTOS_ENDPOINT,externalGoogleWindow,googlePhotosRequest} from "@/lib/client/googlePhotos";
type Status={configured:boolean;connected:boolean;connecting?:boolean};
export default function GooglePhotosConnectionPanel({admin=false}:{admin?:boolean}){
  const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  const [redirectUri,setRedirectUri]=useState("");
  async function refresh(){
    if(inFlight.current)return;inFlight.current=true;
    try{const attempt=sessionStorage.getItem(GOOGLE_PHOTOS_ATTEMPT_KEY);const response=await fetch(GOOGLE_PHOTOS_ENDPOINT+(attempt?"?attempt="+encodeURIComponent(attempt):""),{credentials:"same-origin",cache:"no-store"});const data=await response.json();if(!response.ok){sessionStorage.removeItem(GOOGLE_PHOTOS_ATTEMPT_KEY);throw Error(data.error||"Could not check Google Photos.");}setStatus(data);if(data.connected&&!data.connecting){sessionStorage.removeItem(GOOGLE_PHOTOS_ATTEMPT_KEY);setMessage("Google Photos connected. Only media you select will be imported.");}}
    catch(error){setMessage((error as Error).message);}finally{inFlight.current=false;}
  }
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==="visible"&&sessionStorage.getItem(GOOGLE_PHOTOS_ATTEMPT_KEY))void refresh();},3000);const resume=()=>void refresh();window.addEventListener("focus",resume);return()=>{clearInterval(timer);window.removeEventListener("focus",resume);};},[]);
  async function connect(){const popup=externalGoogleWindow();setBusy(true);setMessage("");try{const result=await googlePhotosRequest<{authorizationUrl:string;attempt:string}>("connect");sessionStorage.setItem(GOOGLE_PHOTOS_ATTEMPT_KEY,result.attempt);if(!popup)throw Error("Allow pop-ups for this site to connect Google Photos.");popup.navigate(result.authorizationUrl);setMessage("Approve Google Photos in your browser, then return here.");setStatus(current=>current?{...current,connecting:true}:current);}catch(error){popup?.close();setMessage((error as Error).message);}finally{setBusy(false);}}
  return <section aria-label="Google Photos connection" className="space-y-3 rounded-[22px] border border-white/10 bg-black/25 p-5">
    <h2 className="text-lg font-bold">Google Photos</h2>
    <p className="text-sm text-white/65">Import photos and videos you choose. Phone storage stays available. This does not back up your stories or settings.</p>
    <p role="status" className="text-sm">{!status?"Checking connection…":!status.configured?"Administrator setup required":status.connecting?"Waiting for Google approval…":status.connected?"Connected":"Not connected"}</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!status?.configured} onClick={()=>void connect()} className="min-h-11 rounded-xl bg-violet-600 px-4 py-2 font-semibold disabled:opacity-40">{status?.connected?"Change Google account":"Connect Google Photos"}</button>
    {status?.connected&&<button type="button" disabled={busy} className="min-h-11 rounded-xl border border-white/20 px-4 py-2" onClick={()=>{setBusy(true);void googlePhotosRequest<{revoked:boolean}>("disconnect").then(result=>{sessionStorage.removeItem(GOOGLE_PHOTOS_ATTEMPT_KEY);setStatus(current=>current?{...current,connected:false,connecting:false}:current);setMessage(result.revoked?"Disconnected. Imported app files were kept.":"Disconnected locally. You can also revoke access in your Google account.");}).catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>Disconnect</button>}
    <button type="button" className="min-h-11 rounded-xl border border-white/20 px-4 py-2" onClick={()=>void refresh()}>Refresh</button></div>
    {message&&<p className="text-sm text-amber-100">{message}</p>}
    {admin&&<details className="rounded-xl border border-white/10 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Administrator setup</summary>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-white/70"><li>In Google Cloud, enable Google Photos Picker API.</li><li>Configure the consent screen and add your Google account as a test user.</li><li>Create a Web application OAuth client and register the exact HTTPS callback below. Download its JSON file.</li></ol>
      <label className="mt-3 block text-sm">Authorized redirect URI<input type="url" value={redirectUri} onChange={e=>setRedirectUri(e.target.value)} placeholder="https://your-test-site/api/integrations/google-photos/callback" className="mt-1 min-h-11 w-full rounded-xl bg-black/40 p-3"/></label>
      <label className="mt-3 block text-sm">Upload OAuth client JSON<input type="file" accept="application/json,.json" disabled={busy||!redirectUri} className="mt-2 block w-full" onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;setBusy(true);void (async()=>{if(file.size>12*1024)throw Error("Choose the small OAuth client JSON, not a service-account key.");const client=JSON.parse(await file.text());await googlePhotosRequest("configure",{client,redirectUri});setMessage("Configuration saved securely. You can now connect Google Photos.");await refresh();})().catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}/></label>
      <p className="mt-3 text-xs text-white/55">Credentials stay encrypted on this server. Do not paste secrets into chat. This is separate from your Google Play service account.</p>
    </details>}
  </section>;
}
