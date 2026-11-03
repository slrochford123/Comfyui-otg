"use client";

import {useCallback,useEffect,useRef,useState} from "react";

export type SavedH3Upload={id:string;kind:"image"|"video"|"audio";file:File;name:string;description:string;includeAudio?:boolean;sourceDurationSeconds?:number;clipStartSeconds?:number};
type RecordRow={key:string;owner:string;id:string;removed?:boolean;upload?:SavedH3Upload};
const DB="otg-h3-saved-uploads-v1",STORE="uploads",EVENT="otg:h3:saved-uploads-change";

function open():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined")return reject(new Error("Device storage unavailable."));
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore(STORE,{keyPath:"key"});store.createIndex("owner","owner");};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Could not open saved uploads."));
  });
}
const key=(owner:string,id:string)=>JSON.stringify([owner,id]);
/** Each write is atomic. Tombstones prevent a still-selected draft from re-adding a removed item. */
export async function saveH3Uploads(owner:string,uploads:SavedH3Upload[],removeId?:string):Promise<SavedH3Upload[]> {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE,"readwrite"),store=transaction.objectStore(STORE);
      for(const upload of uploads.filter(item=>item.id!==removeId)){
        const request=store.get(key(owner,upload.id));
        request.onsuccess=()=>{if(!(request.result as RecordRow|undefined)?.removed)store.put({key:key(owner,upload.id),owner,id:upload.id,upload} satisfies RecordRow);};
      }
      if(removeId)store.put({key:key(owner,removeId),owner,id:removeId,removed:true} satisfies RecordRow);
      let results:SavedH3Upload[]=[];
      // Queue the read after the get callbacks have scheduled their writes.
      const barrier=store.get("__barrier__");
      barrier.onsuccess=()=>{
        const request=store.index("owner").getAll(owner);
        request.onsuccess=()=>{results=(request.result as RecordRow[]).filter(row=>!row.removed&&row.upload).map(row=>row.upload!);};
      };
      transaction.oncomplete=()=>resolve(results);
      transaction.onerror=()=>reject(transaction.error||new Error("Could not save uploads."));
      transaction.onabort=()=>reject(transaction.error||new Error("Could not save uploads."));
    });
  } finally {db.close();}
}

export function useH3SavedUploads(owner:string,inputs:SavedH3Upload[],ready:boolean) {
  const [state,setState]=useState<{owner:string;uploads:SavedH3Upload[];error:string}>({owner,uploads:[],error:""});
  const ownerRef=useRef(owner);
  useEffect(()=>{ownerRef.current=owner;},[owner]);
  const serial=useRef<Promise<unknown>>(Promise.resolve());
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const refresh=useCallback((uploads:SavedH3Upload[],removeId?:string)=>{
    const task=serial.current.catch(()=>{}).then(async()=>{
      try{
        const saved=await saveH3Uploads(owner,uploads,removeId);
        if(mounted.current&&ownerRef.current===owner)setState({owner,uploads:saved,error:""});
        if(uploads.length||removeId)window.dispatchEvent(new CustomEvent(EVENT,{detail:owner}));
      }catch{
        if(mounted.current&&ownerRef.current===owner)setState(current=>({owner,uploads:current.owner===owner?current.uploads:[],error:"Saved uploads could not sync to this device. Your selected inputs are unchanged. Check available storage and retry."}));
      }
    });
    serial.current=task;return task;
  },[owner]);
  useEffect(()=>{if(ready)void refresh(inputs);},[ready,inputs,refresh]);
  useEffect(()=>{
    const changed=(event:Event)=>{if((event as CustomEvent).detail===owner&&ready)void refresh([]);};
    window.addEventListener(EVENT,changed);return()=>window.removeEventListener(EVENT,changed);
  },[owner,ready,refresh]);
  return {uploads:state.owner===owner?state.uploads:[],error:state.owner===owner?state.error:"",remove:(id:string)=>refresh([],id),retry:()=>refresh(inputs)};
}
