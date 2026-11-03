"use client";
/* eslint-disable @next/next/no-img-element -- Owned authenticated previews must not enter the shared image optimizer cache. */
import React from "react";
import {newClientRequestId} from "@/lib/client/requestId";
import {H3_MEDIA_ACCEPT} from "@/lib/h3MediaTypes";
import {type CharacterRefCardPublic as Card} from "@/lib/h3SpecialModes/characterRefCardContract";

type Fields=Pick<Card,"name"|"description"|"characterId"|"mode"|"gpu">;
type Character={id:string;name:string;description?:string};
const endpoint="/api/h3/special/refmods/character-card";
const button="min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm font-bold disabled:opacity-40";
const input="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white";
const fieldsOf=(c:Card):Fields=>({name:c.name,description:c.description,characterId:c.characterId,mode:c.mode,gpu:c.gpu});
async function request(url:string,init?:RequestInit):Promise<Card|null>{
  const response=await fetch(url,{credentials:"include",cache:"no-store",...init});
  const body=await response.json();
  if(!response.ok||!body.ok)throw Object.assign(Error(body.error||"The card could not be saved."),{status:response.status});
  return body.card;
}

export default function CharacterRefCardCreator({characters,initialCharacterId="",onSaved}:{characters:Character[];initialCharacterId?:string;onSaved:()=>void}){
  const [card,setCard]=React.useState<Card|null>(null);
  const [fields,setFields]=React.useState<Fields>({name:"",description:"",characterId:"",mode:"single",gpu:"auto"});
  const [working,setWorking]=React.useState(false),[error,setError]=React.useState(""),[loading,setLoading]=React.useState(true);
  const [uploadMessage,setUploadMessage]=React.useState("");
  const cardRef=React.useRef<Card|null>(null),fieldsRef=React.useRef(fields),dirty=React.useRef(false),revision=React.useRef(0),busy=React.useRef(false),mounted=React.useRef(true);
  const notified=React.useRef("");
  const autoSaveBlocked=React.useRef(false);
  const operations=React.useRef<Promise<unknown>>(Promise.resolve());
  const accept=React.useCallback((next:Card)=>{cardRef.current=next;if(mounted.current)setCard(next);},[]);
  const replaceFields=React.useCallback((next:Fields)=>{fieldsRef.current=next;dirty.current=false;if(mounted.current)setFields(next);},[]);
  function change(patch:Partial<Fields>){
    const next={...fieldsRef.current,...patch};fieldsRef.current=next;dirty.current=true;revision.current++;
    autoSaveBlocked.current=false;
    setFields(next);
    if(cardRef.current)try{localStorage.setItem("otg:refcard:"+cardRef.current.id,JSON.stringify({fields:next,at:Date.now()}));}catch{}
  }
  async function post(data:Record<string,unknown>){
    const next=await request(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    if(!next)throw Error("The server returned no card.");accept(next);return next;
  }
  async function saveSettings(){
    if(!dirty.current||!cardRef.current)return;
    const version=revision.current;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const next=await post({...fieldsRef.current,action:"settings",id:cardRef.current!.id,revision:cardRef.current!.revision});
        if(version===revision.current){dirty.current=false;try{localStorage.removeItem("otg:refcard:"+next.id);}catch{}}
        return;
      }catch(e){
        if((e as {status?:number}).status!==409||attempt)throw e;
        const fresh=await request(endpoint+"?id="+cardRef.current!.id);if(fresh)accept(fresh);
      }
    }
  }
  async function run(task:()=>Promise<unknown>,silent=false){
    const work=operations.current.catch(()=>{}).then(async()=>{
      busy.current=true;if(!silent&&mounted.current)setWorking(true);if(mounted.current)setError("");
      try{await saveSettings();await task();autoSaveBlocked.current=false;}catch(e){autoSaveBlocked.current=true;if(mounted.current)setError((e as Error).message);}
      finally{busy.current=false;if(!silent&&mounted.current)setWorking(false);}
    });
    operations.current=work;await work;
  }
  async function freshCard(){
    const next=await post({action:"create",id:newClientRequestId()});
    const selected=characters.find(c=>c.id===initialCharacterId);
    replaceFields({...fieldsOf(next),...(selected?{name:selected.name,description:selected.description||"",characterId:selected.id}:{})});
    if(selected){dirty.current=true;await saveSettings();}
  }
  React.useEffect(()=>{
    mounted.current=true;let disposed=false;
    (async()=>{
      try{
        const found=await request(endpoint+(initialCharacterId?"?characterId="+encodeURIComponent(initialCharacterId):""));if(disposed)return;
        if(found){
          accept(found);replaceFields(fieldsOf(found));
          try{const local=JSON.parse(localStorage.getItem("otg:refcard:"+found.id)||"null");if(local?.fields&&local.at>Date.parse(found.updatedAt)&&!["generating","encoding"].includes(found.state)){fieldsRef.current=local.fields;dirty.current=true;setFields(local.fields);}}catch{}
        }else await freshCard();
      }catch(e){if(!disposed)setError((e as Error).message);}
      finally{if(!disposed)setLoading(false);}
    })();
    return()=>{disposed=true;mounted.current=false;};
    // Initial character is a starting suggestion, not permission to replace a saved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  React.useEffect(()=>{
    if(!dirty.current||!card||working||autoSaveBlocked.current)return;
    const timer=setTimeout(()=>{void run(async()=>{},true);},650);return()=>clearTimeout(timer);
    // Ref-held settings prevent polling from overwriting current typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[fields,working,card?.id]);
  const pollingId=card?.id;
  React.useEffect(()=>{
    if(!pollingId)return;let disposed=false,inFlight=false;
    const refresh=async()=>{
      if(inFlight||busy.current||document.visibilityState==="hidden")return;inFlight=true;
      try{const next=await request(endpoint+"?id="+pollingId);if(next&&!disposed){accept(next);if(!dirty.current)replaceFields(fieldsOf(next));}}catch(e){if(!disposed)setError((e as Error).message);}finally{inFlight=false;}
    };
    const timer=setInterval(()=>{void refresh();},3000);window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[pollingId,accept,replaceFields]);
  React.useEffect(()=>{if(card?.state==="completed"&&notified.current!==card.libraryName){notified.current=card.libraryName||"";onSaved();}},[card?.state,card?.libraryName,onSaved]);
  async function action(action:string,extra:Record<string,unknown>={}){await run(async()=>{await post({action,...extra,id:cardRef.current!.id,revision:cardRef.current!.revision});});}
  async function upload(files:FileList|null,role:"original"|"view",replace?:string){
    if(!files?.length)return;const selected=Array.from(files);
    await run(async()=>{
      if(role==="view"&&!replace&&cardRef.current!.views.length+selected.length>8)throw Error("Use at most eight reference images per card. No files were discarded.");
      for(const file of selected){
        if(!file.size||file.size>512*1024*1024)throw Error("Choose a non-empty image up to 512 MiB.");
        const uploadId=newClientRequestId(),assetId=newClientRequestId(),chunkSize=4*1024*1024,count=Math.ceil(file.size/chunkSize);let upload;
        for(let index=0;index<count;index++){
          const form=new FormData();for(const [key,value]of Object.entries({uploadId,kind:"image",name:file.name,type:file.type,size:String(file.size),chunkIndex:String(index),chunkCount:String(count)}))form.set(key,value);
          form.set("chunk",file.slice(index*chunkSize,Math.min(file.size,(index+1)*chunkSize)),file.name);
          setUploadMessage(`Uploading ${file.name} · ${Math.round((index+1)/count*100)}%`);
          let result;
          for(let attempt=0;attempt<2;attempt++){
            try{const response=await fetch("/api/h3/generation/upload",{method:"POST",credentials:"include",body:form});result=await response.json();if(!response.ok)throw Error(result.error||"Upload failed.");break;}catch(e){if(attempt)throw e;}
          }
          upload=result.upload;
        }
        await post({action:"upload-staged",id:cardRef.current!.id,assetId,role,upload,...(replace?{replace}:{})});
      }
      setUploadMessage("");
    });
  }
  if(loading)return <p role="status">Opening saved reference card…</p>;
  if(!card)return <div role="alert">{error||"Unable to open a card."}<button className={button} onClick={()=>void run(freshCard)}>Try again</button></div>;
  const active=["generating","encoding"].includes(card.state),locked=working||active;
  const done=card.views.filter(v=>v.state==="ready").length;
  const move=(index:number,delta:number)=>{const order=card.views.map(v=>v.id);[order[index],order[index+delta]]=[order[index+delta],order[index]];void action("reorder",{order});};
  return <section className="space-y-4 text-white" data-otg="character-refcard">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-white/60" role="status">{working?"Saving…":dirty.current?"Saving draft…":"Saved"}</span><button className={button} disabled={locked} onClick={()=>void run(freshCard)}>New card</button></div>
    <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Character name<input aria-label="Character name" className={input} maxLength={96} value={fields.name} onChange={e=>change({name:e.target.value})}/></label>
      <label className="text-sm">Save to character<select aria-label="Save to character" className={input} value={fields.characterId} onChange={e=>{const c=characters.find(c=>c.id===e.target.value);change({characterId:e.target.value,...(c?{name:c.name,description:c.description||""}:{})});}}><option value="">Create a new character</option>{fields.characterId&&!characters.some(c=>c.id===fields.characterId)?<option value={fields.characterId}>{fields.name} · saved</option>:null}{characters.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
    </fieldset>
    <div className="grid grid-cols-2 gap-2">{(["single","upload"] as const).map(mode=><button key={mode} className={button+(fields.mode===mode?" bg-violet-500/40":"")} disabled={locked} aria-pressed={fields.mode===mode} onClick={()=>change({mode})}>{mode==="single"?"One image → four views":"Upload 4–8 images"}</button>)}</div>
    {fields.mode==="single"?<div className="flex flex-wrap items-center gap-3">
      {card.original?<div className="space-y-1"><img src={card.original.url} alt="Original character" className="h-32 w-28 rounded-xl object-contain"/><button disabled={locked||!!card.views.length} title={card.views.length?"Original kept for regenerating these views":"Remove source"} className={button} onClick={()=>void action("remove",{asset:card.original!.id})}>Remove source</button></div>:<label className={button}>Add source image<input aria-label="Add source image" type="file" accept={H3_MEDIA_ACCEPT.image} className="block max-w-full text-sm" disabled={locked} onChange={e=>{void upload(e.target.files,"original");e.target.value="";}}/></label>}
      {fields.characterId&&!card.original?<button className={button} disabled={locked} onClick={()=>void action("import-character",{characterId:fields.characterId,assetId:newClientRequestId()})}>Use character image</button>:null}
      {!card.views.length?<button className={button+" bg-violet-500"} disabled={locked||!card.original||!fields.name.trim()} onClick={()=>void action("generate")}>Create four views</button>:null}
    </div>:<label className={button+" block"}>Add reference images<input aria-label="Add reference images" className="block max-w-full text-sm" type="file" accept={H3_MEDIA_ACCEPT.image} multiple disabled={locked} onChange={e=>{void upload(e.target.files,"view");e.target.value="";}}/></label>}
    <details><summary className="cursor-pointer py-2 text-sm font-bold">Details & GPU</summary>
      <fieldset disabled={locked} className="mt-2 space-y-3">
        <label className="block text-sm">Keep these character details<textarea className={input} maxLength={2000} value={fields.description} onChange={e=>change({description:e.target.value})}/></label>
        <label className="block text-sm">Rendering GPU<select aria-label="Rendering GPU" className={input} value={fields.gpu} onChange={e=>change({gpu:e.target.value as Fields["gpu"]})}><option value="auto">Auto · RTX 3090 first</option><option value="rtx3090">RTX 3090</option><option value="rtx5060ti">RTX 5060 Ti</option></select></label>
        <p className="text-xs text-white/60">Use one consistent character and outfit. Review generated angles for identity and hidden details. FIBO 2.0 Turbo runs locally; private research use only. A RefMod is cached H3 reference conditioning, not a trained LoRA.</p>
      </fieldset>
    </details>
    {error||card.error?<div className="rounded-xl bg-red-500/15 p-3 text-sm" role="alert">{error||card.error}<div className="mt-2 flex gap-2"><button className={button} disabled={working} onClick={()=>void run(async()=>{const next=await request(endpoint+"?id="+card.id);if(next)accept(next);})}>Refresh</button>{card.state==="attention"?<button className={button} disabled={working} onClick={()=>void action("resume")}>Resume / check original job</button>:null}</div></div>:null}
    <div role="status" className="space-y-2 text-sm text-white/75"><p>{uploadMessage||card.message}</p>{active?<progress aria-label="Reference card progress" max={card.state==="encoding"?1:4} value={card.state==="generating"?done:undefined} className="w-full accent-violet-500"/>:null}</div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{card.views.map((view,index)=><article key={view.id} className="min-w-0 space-y-2 rounded-2xl border border-white/15 p-2">
      <p className="text-sm font-bold">{view.label}</p>{view.url?<a href={view.url} target="_blank" rel="noopener noreferrer" aria-label={"Preview "+view.label}><img src={view.url} alt={view.label} className="aspect-[4/7] w-full rounded-xl bg-zinc-900 object-contain"/></a>:<div className="flex aspect-[4/7] items-center justify-center rounded-xl bg-zinc-900 text-sm">{view.state}</div>}
      {view.error?<p className="text-xs text-red-200">{view.error}</p>:null}
      <div className="flex flex-wrap gap-1">{view.angle?<button disabled={locked} className={button} onClick={()=>void action("regenerate",{asset:view.id})}>Regenerate</button>:null}<button disabled={locked} className={button} onClick={()=>void action("remove",{asset:view.id})}>Remove</button><button aria-label={"Move "+view.label+" up"} disabled={locked||index===0} className={button} onClick={()=>move(index,-1)}>↑</button><button aria-label={"Move "+view.label+" down"} disabled={locked||index===card.views.length-1} className={button} onClick={()=>move(index,1)}>↓</button></div>
      <label className="block text-xs">Replace image<input aria-label={"Replace "+view.label} type="file" accept={H3_MEDIA_ACCEPT.image} className="block w-full text-xs" disabled={locked} onChange={e=>{void upload(e.target.files,"view",view.id);e.target.value="";}}/></label>
    </article>)}</div>
    {card.state==="completed"?<p className="rounded-xl bg-emerald-500/15 p-3 text-sm">Saved to Characters and Ref Mod Gallery · {card.backend==="rtx5060ti"?"RTX 5060 Ti":"RTX 3090"}. Close this editor and choose “Use in H3”.</p>:<button className={button+" w-full bg-violet-500"} disabled={locked||done<4||done!==card.views.length||!fields.name.trim()} onClick={()=>void action("encode")}>Approve {done} images & create RefMod</button>}
    <p className="text-xs text-white/50">You can close this editor. Saved images and GPU jobs continue on TEST.</p>
  </section>;
}
