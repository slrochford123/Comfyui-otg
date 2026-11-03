import {Capacitor} from "@capacitor/core";
export const GOOGLE_PHOTOS_ENDPOINT="/api/integrations/google-photos";
export const GOOGLE_PHOTOS_ATTEMPT_KEY="otg:google-photos:attempt";
export async function googlePhotosRequest<T>(action:string,data:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
  const response=await fetch(GOOGLE_PHOTOS_ENDPOINT,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...data}),signal});
  const result=await response.json();if(!response.ok)throw Error(result.error||"Google Photos request failed.");return result;
}
export type GoogleWindow={navigate:(url:string)=>void;close:()=>void};
export function externalGoogleWindow():GoogleWindow|null{
  // Capacitor's BridgeWebViewClient opens off-origin HTTPS navigation with an
  // Android ACTION_VIEW intent. It keeps Google login out of the embedded view.
  if(Capacitor.isNativePlatform())return {navigate:url=>window.location.assign(url),close:()=>{}};
  const popup=window.open("about:blank","_blank");
  if(popup){popup.opener=null;popup.document.title="Opening Google Photos…";}
  return popup?{navigate:url=>{popup.location.href=url;},close:()=>popup.close()}:null;
}
export async function pickGooglePhotos(input:HTMLInputElement,popup:GoogleWindow|null,signal:AbortSignal,onStatus:(message:string)=>void):Promise<File[]>{
  const remaining=input.multiple?Math.min(16,Number(input.dataset.maxFiles??16)):1;
  if(!Number.isInteger(remaining)||remaining<1)throw Error("This workflow has no remaining input slots. Remove an input first.");
  const session=await googlePhotosRequest<{id:string;pickerUri:string;pollAfterMs:number}>("pick",{maximum:remaining,accept:input.accept},signal);
  if(!popup)throw Error("Allow pop-ups for this site, then choose Google Photos again.");
  popup.navigate(session.pickerUri.replace(/\/$/,"")+"/autoclose");
  const start=Date.now();let delay=session.pollAfterMs;
  for(;;){
    signal.throwIfAborted();if(Date.now()-start>30*60_000)throw Error("Google Photos selection expired. Please choose again.");
    onStatus("Choose your photos or videos in Google Photos, then return here.");
    await new Promise<void>((resolve,reject)=>{const done=()=>{signal.removeEventListener("abort",abort);resolve();};const timer=setTimeout(done,Math.min(60_000,Math.max(1000,delay)));const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new DOMException("Canceled","AbortError"));};signal.addEventListener("abort",abort,{once:true});});
    const status=await googlePhotosRequest<{ready:boolean;pollAfterMs?:number;items?:Array<{id:string;name:string;mime:string}>}>("poll",{session:session.id},signal);
    if(!status.ready){delay=status.pollAfterMs||5000;continue;}
    const items=status.items||[];if(items.length>remaining)throw Error(`Choose at most ${remaining} items. Nothing was discarded.`);
    const files:File[]=[];let total=0;
    for(const [i,item] of items.entries()){
      onStatus(`Importing ${i+1} of ${items.length}…`);
      const response=await fetch(`${GOOGLE_PHOTOS_ENDPOINT}?${new URLSearchParams({session:session.id,item:item.id})}`,{credentials:"same-origin",cache:"no-store",signal});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||"Could not import Google media.");}
      const blob=await response.blob();total+=blob.size;if(total>128*1024*1024)throw Error("Choose a smaller batch (under 128 MB total). Nothing was added.");
      files.push(new File([blob],item.name,{type:item.mime,lastModified:Date.now()}));
    }
    return files;
  }
}
