import type {GoogleWindow} from "./googleBrowser";
export {externalGoogleWindow,type GoogleWindow} from "./googleBrowser";
export const GOOGLE_PHOTOS_ENDPOINT="/api/integrations/google-photos";
export const GOOGLE_PHOTOS_ATTEMPT_KEY="otg:google-photos:attempt";
export async function googlePhotosRequest<T>(action:string,data:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
  const response=await fetch(GOOGLE_PHOTOS_ENDPOINT,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...data}),signal});
  return googlePhotosJson<T>(response);
}
export async function googlePhotosJson<T>(response:Response):Promise<T>{
  let result;
  try{result=await response.json();}
  catch{throw Error("Google Photos could not reach SLR Studios. Please try again. Your current inputs were kept.");}
  if(!response.ok)throw Error(typeof result?.error==="string"?result.error:"Google Photos request failed.");
  return result as T;
}
export async function pickGooglePhotos(input:HTMLInputElement,popup:GoogleWindow|null,signal:AbortSignal,onStatus:(message:string)=>void):Promise<File[]>{
  if(!popup)throw Error("Allow pop-ups for this site, then choose Google Photos again.");
  const close=()=>{void popup.close().catch(()=>{});};
  signal.addEventListener("abort",close,{once:true});
  try{
  signal.throwIfAborted();
  const remaining=input.multiple?Math.min(16,Number(input.dataset.maxFiles??16)):1;
  if(!Number.isInteger(remaining)||remaining<1)throw Error("This workflow has no remaining input slots. Remove an input first.");
  const session=await googlePhotosRequest<{id:string;pickerUri:string;pollAfterMs:number}>("pick",{maximum:remaining,accept:input.accept},signal);
  signal.throwIfAborted();
  await popup.navigate(session.pickerUri.replace(/\/$/,"")+"/autoclose");
  const start=Date.now();let delay=session.pollAfterMs;
  for(;;){
    signal.throwIfAborted();if(Date.now()-start>30*60_000)throw Error("Google Photos selection expired. Please choose again.");
    onStatus(popup.inApp?"Choose your media and tap Done. It will return here automatically.":"Choose your media in Google Photos and tap Done.");
    await new Promise<void>((resolve,reject)=>{const done=()=>{signal.removeEventListener("abort",abort);resolve();};const timer=setTimeout(done,Math.min(60_000,Math.max(1000,delay)));const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new DOMException("Canceled","AbortError"));};signal.addEventListener("abort",abort,{once:true});});
    const status=await googlePhotosRequest<{ready:boolean;pollAfterMs?:number;items?:Array<{id:string;name:string;mime:string}>}>("poll",{session:session.id},signal);
    // Done may close Google's page before the poll. Check readiness first.
    if(!status.ready){if(popup.isClosed())throw new DOMException("Canceled","AbortError");delay=status.pollAfterMs||5000;continue;}
    // Return to the app before importing so progress is visible.
    await popup.close();signal.throwIfAborted();
    const items=status.items||[];if(items.length>remaining)throw Error(`Choose at most ${remaining} items. Nothing was discarded.`);
    const files:File[]=[];let total=0;
    for(const [i,item] of items.entries()){
      onStatus(`Importing ${i+1} of ${items.length}…`);
      const response=await fetch(`${GOOGLE_PHOTOS_ENDPOINT}?${new URLSearchParams({session:session.id,item:item.id})}`,{credentials:"same-origin",cache:"no-store",signal});
      if(!response.ok){await googlePhotosJson(response);throw Error("Could not import Google media.");}
      const blob=await response.blob();total+=blob.size;if(total>128*1024*1024)throw Error("Choose a smaller batch (under 128 MB total). Nothing was added.");
      files.push(new File([blob],item.name,{type:item.mime,lastModified:Date.now()}));
    }
    signal.throwIfAborted();return files;
  }
  }finally{signal.removeEventListener("abort",close);await popup.close().catch(()=>{});}
}
