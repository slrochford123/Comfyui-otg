import type { LabSettings } from "@/lib/experiments/catalog";
export type NsfwPendingUpload={sessionId:string;name:string;type:string;size:number;lastModified:number;snapshot:boolean;before:string[];selectedBefore:string[];storageKey:string};
export type NsfwUiState = { strength:"short"|"medium"|"long"; promptUndo:string[]; inputUndo:string[]|null; suggestion:string; builderId:string; directorDraft:string; directorId:string; directorReply:string; dismissedJob:string; openSections:string[];pendingUpload?:NsfwPendingUpload|null };
export const DEFAULT_NSFW_UI:NsfwUiState={strength:"medium",promptUndo:[],inputUndo:null,suggestion:"",builderId:"",directorDraft:"",directorId:"",directorReply:"",dismissedJob:"",openSections:[]};
export type NsfwDraft = {version:1;sessionId:string|null;savedKey:string;editor:{experiment:string;settings:LabSettings};ui:NsfwUiState;pending:{key:string;id:string}|null;updatedAt:number};
export const nsfwDraftKey=(owner:string)=>`otg:h3:nsfw:draft:v1:${encodeURIComponent(owner)}`;
/** Settings returned by server validation may have a different property order. */
export function nsfwEditorKey(value:unknown):string{return JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
export function readNsfwDraft(owner:string):NsfwDraft|null {
  if(!owner)return null;
  try {const raw=localStorage.getItem(nsfwDraftKey(owner));if(!raw||raw.length>400_000)return null;const v=JSON.parse(raw);
    if(typeof v.savedKey==="string")v.savedKey=nsfwEditorKey(JSON.parse(v.savedKey));
    if(v.pending?.key){const [session,key]=JSON.parse(v.pending.key);v.pending.key=JSON.stringify([session,nsfwEditorKey(JSON.parse(key))]);}
    return v.version===1 && typeof v.updatedAt==="number" && v.editor && typeof v.editor.settings?.prompt==="string" && typeof v.editor.experiment==="string" && v.ui && Array.isArray(v.ui.promptUndo) && Array.isArray(v.ui.openSections) ? v : null;
  }catch{return null;}
}
export function writeNsfwDraft(owner:string,draft:NsfwDraft):boolean {
  if(!owner)return true;
  try {localStorage.setItem(nsfwDraftKey(owner),JSON.stringify(draft));return true;}catch{return false;}
}
