"use client";
import React,{useId,useState} from 'react';

export default function ExtractedCharacterName({name,saved,busy,onSave}:{name:string;saved:boolean;busy:boolean;onSave:(name:string)=>Promise<void>}){
 const id=useId();
 const [draft,setDraft]=useState<string|null>(saved?null:name),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const editing=draft!==null;
 async function save(){
  if(!editing||busy||saving||!draft.trim())return;
  setSaving(true);setError('');
  try{await onSave(draft);setDraft(null);}catch(error){setError(error instanceof Error?error.message:'Could not save this name. Please try again.');}finally{setSaving(false);}
 }
 return <div className="min-w-0 space-y-1.5">
  <label htmlFor={id} className="block text-sm">Name</label>
  <div className="flex min-w-0 items-center gap-2">
   <input id={id} className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-black/30 p-2.5 text-sm read-only:text-white/75" value={draft??name} maxLength={96} readOnly={!editing} disabled={busy||saving} autoComplete="off" aria-invalid={!!error} aria-describedby={id+'-status'} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(editing&&event.key==='Enter'){event.preventDefault();void save();}}}/>
   {editing?<button type="button" className="min-h-11 shrink-0 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40" aria-label="Save character name" disabled={busy||saving||!draft.trim()} onClick={()=>void save()}>{saving?'Saving…':'Save'}</button>
    :<button type="button" className="min-h-11 shrink-0 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40" aria-label="Edit character name" disabled={busy||saving} onClick={()=>{setDraft(name);setError('');}}>Edit</button>}
  </div>
  <p id={id+'-status'} role={error?'alert':'status'} className={'text-xs '+(error?'text-amber-200':'text-white/60')}>{error||(!editing?'Name saved.':'Choose a unique name, such as John – Young.')}</p>
 </div>;
}
