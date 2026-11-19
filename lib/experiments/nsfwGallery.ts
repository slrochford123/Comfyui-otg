import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { requireStorageHeadroom } from "@/lib/storageAdmission";
import { RequestError } from "@/lib/requestError";
import { requireNsfwAccess } from "./nsfwAccess";
import { withNsfwWorkspace } from "./availability";
import { withLab, validId } from "./store";
import { labExperiment } from "./catalog";
import {labRoot} from "./store";
import {safeSegment} from "@/lib/paths";

export type NsfwGalleryItem = { id:string; name:string; kind:"image"|"video"; url:string; thumbnailUrl:string; created:number; owner?:string; gpu:string; device:string; jobId?:string; mode?:string; favorite:boolean; owned:boolean; source:string };
type Row = {id:string;owner:string;name:string;mime:string;bytes:number;sha256:string;session:string;jobId:string;model:string;created:number};
function annotations(db:import("better-sqlite3").Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS nsfw_gallery_notes (owner TEXT NOT NULL,asset TEXT NOT NULL,name TEXT,favorite INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,asset));
  CREATE TABLE IF NOT EXISTS nsfw_gallery_saved (id TEXT PRIMARY KEY,owner TEXT NOT NULL,source_key TEXT NOT NULL,record TEXT NOT NULL,UNIQUE(owner,source_key));`);
}
function ownFile(file:string, sha?:string) {
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||!st.size)throw new RequestError("This saved media is unavailable.",404);
  if(sha&&crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")!==sha)throw new RequestError("The saved media no longer matches its receipt.",409);
  return st;
}
function detail(root:string,row:Row,verify=true) {
  if(labExperiment(row.model)?.kind!=="h3-admin")throw new RequestError("Media not found.",404);
  const file=path.join(root,row.id+".media");ownFile(file,verify?row.sha256:undefined);
  let request:Record<string,any>={},status:Record<string,any>={};
  try{request=JSON.parse(fs.readFileSync(path.join(root,"jobs",row.jobId,"request.json"),"utf8"));status=JSON.parse(fs.readFileSync(path.join(root,"jobs",row.jobId,"status.json"),"utf8"));}catch{}
  return {...row,file,request,status};
}
export function resolveNsfwAsset(owner:string,id:string,admin=false,verify=true) {
  validId(id);
  return withNsfwWorkspace(()=>withLab((db,root)=>{
    const row=db.prepare(`SELECT a.id,a.owner,a.name,a.mime,a.bytes,a.sha256,a.session,g.id AS jobId,g.model,g.created FROM assets a JOIN generation_jobs g ON g.asset=a.id WHERE a.id=? AND a.ready=1 ${admin?"":"AND a.owner=?"}`).get(...(admin?[id]:[id,owner])) as Row|undefined;
    if(!row)throw new RequestError("Media not found.",404);
    return detail(root,row,verify);
  }));
}
export async function ownedNsfwSource(request:NextRequest,id:string) {
  const user=await requireSessionUser(request);if(!user.accountId)throw new RequestError("Sign in required.",401);
  requireNsfwAccess(user.accountId);
  return resolveNsfwAsset(user.accountId,id);
}
export function listNsfwGallery(owner:string,query:{admin?:boolean;search?:string;media?:string;sort?:string;page?:number;per?:number;favorites?:boolean}={}) {
 return withNsfwWorkspace(()=>withLab((db,root)=>{
  annotations(db);
  const rows=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_jobs'").get()?db.prepare(`SELECT a.id,a.owner,a.name,a.mime,a.bytes,a.sha256,a.session,g.id AS jobId,g.model,g.created FROM assets a JOIN generation_jobs g ON g.asset=a.id WHERE a.ready=1 ${query.admin?"":"AND a.owner=?"} ORDER BY g.created DESC`).all(...(query.admin?[]:[owner])) as Row[]:[];
  const items:NsfwGalleryItem[]=[],warnings:string[]=[];
  for(const row of rows){
   if(labExperiment(row.model)?.kind!=="h3-admin"||!/^image\/|^video\//.test(row.mime))continue;
   const note=db.prepare("SELECT name,favorite,hidden FROM nsfw_gallery_notes WHERE owner=? AND asset=?").get(owner,row.id) as {name?:string;favorite?:number;hidden?:number}|undefined;
   if(note?.hidden)continue;
   try{
    const asset=detail(root,row,false),isVideo=row.mime.startsWith("video/"),base=query.admin?"/api/admin/nsfw-gallery/file":"/api/h3/nsfw/assets";
    items.push({id:row.id,name:note?.name||row.name,kind:isVideo?"video":"image",url:base+"?id="+row.id,thumbnailUrl:(query.admin?"/api/admin/nsfw-gallery/thumbnail":"/api/h3/nsfw/gallery/thumbnail")+"?id="+row.id,created:row.created,...(query.admin?{owner:row.owner}:{}),gpu:String(asset.status.gpu||asset.status.actual?.gpu||"rtx3090"),device:String(asset.request.sourceDevice||"Not recorded"),jobId:row.jobId,mode:asset.request.settings?.mode,favorite:!!note?.favorite,owned:row.owner===owner,source:"NSFW generation"});
   }catch{warnings.push("A saved item is unavailable; its original record was retained.");}
  }
  const saved=db.prepare(`SELECT record FROM nsfw_gallery_saved ${query.admin?"":"WHERE owner=?"}`).all(...(query.admin?[]:[owner])) as {record:string}[];
  for(const entry of saved){try{const {file,previewId:_preview,...item}=JSON.parse(entry.record) as NsfwGalleryItem & {file?:string;previewId?:string};if(file)verifySavedNsfwGalleryFile(file);const url=file?(query.admin?"/api/admin/nsfw-gallery/file":"/api/h3/nsfw/gallery/file")+"?id="+item.id+"&saved=1":item.url;items.push({...item,url,thumbnailUrl:file?(query.admin?"/api/admin/nsfw-gallery/thumbnail":"/api/h3/nsfw/gallery/thumbnail")+"?id="+item.id+"&saved=1":item.thumbnailUrl,owned:item.owner===owner,...(!query.admin?{owner:undefined}:{})});}catch{warnings.push("An indexed item needs administrator review.");}}
  const filtered=items.filter(i=>(!query.search||i.name.toLowerCase().includes(query.search.toLowerCase()))&&(!query.media||query.media==="all"||i.kind===query.media)&&(!query.favorites||i.favorite)).sort((a,b)=>query.sort==="name"?a.name.localeCompare(b.name)||a.id.localeCompare(b.id):query.sort==="oldest"?a.created-b.created||a.id.localeCompare(b.id):b.created-a.created||a.id.localeCompare(b.id));
  const per=Math.max(1,Math.min(100,query.per||48)),page=Math.max(1,Math.min(1000000,Math.floor(query.page||1)));
  return {ok:true,items:filtered.slice((page-1)*per,page*per),total:filtered.length,page,per,hasMore:page*per<filtered.length,warnings:[...new Set(warnings)]};
 }));
}
export function updateNsfwGallery(owner:string,id:string,action:string,value:unknown) {
 resolveNsfwAsset(owner,id);
 return withNsfwWorkspace(()=>withLab(db=>{annotations(db);db.prepare("INSERT OR IGNORE INTO nsfw_gallery_notes(owner,asset) VALUES (?,?)").run(owner,id);
  if(action==="rename"){if(typeof value!=="string"||!value.trim()||value.length>160)throw new RequestError("Enter a name up to 160 characters.",400);db.prepare("UPDATE nsfw_gallery_notes SET name=? WHERE owner=? AND asset=?").run(value.trim(),owner,id);}
  else if(action==="favorite"&&typeof value==="boolean")db.prepare("UPDATE nsfw_gallery_notes SET favorite=? WHERE owner=? AND asset=?").run(Number(value),owner,id);
  else if(action==="hide"||action==="restore")db.prepare("UPDATE nsfw_gallery_notes SET hidden=? WHERE owner=? AND asset=?").run(Number(action==="hide"),owner,id);
  else throw new RequestError("Unknown Gallery action.",400);
  return {ok:true};
 }));
}
export function registerNsfwSavedItem(owner:string,key:string,item:Omit<NsfwGalleryItem,"id"|"owned"> & {file?:string;previewId?:string}) {
 return withNsfwWorkspace(()=>withLab(db=>{annotations(db);return db.transaction(()=>{const old=db.prepare("SELECT id FROM nsfw_gallery_saved WHERE owner=? AND source_key=?").get(owner,key) as {id:string}|undefined;const id=old?.id||crypto.randomUUID();db.prepare("INSERT INTO nsfw_gallery_saved(id,owner,source_key,record) VALUES (?,?,?,?) ON CONFLICT(owner,source_key) DO UPDATE SET record=excluded.record").run(id,owner,key,JSON.stringify({...item,id,owner,owned:true}));return id;})();}));
}
/** No file is exposed outside the account's ordinary Gallery or private asset route. */
export function verifySavedNsfwGalleryFile(file:string) {
 const root=fs.realpathSync(withNsfwWorkspace(()=>path.join(labRoot(),"saved-gallery"))),real=fs.realpathSync(file),rel=path.relative(root,real);
 if(rel.startsWith("..")||path.isAbsolute(rel))throw new RequestError("Media unavailable.",404);ownFile(real);return real;
}

export function resolveSavedNsfwItem(owner:string,id:string,admin=false) {
 validId(id);return withNsfwWorkspace(()=>withLab(db=>{annotations(db);const row=db.prepare(`SELECT record FROM nsfw_gallery_saved WHERE id=? ${admin?"":"AND owner=?"}`).get(...(admin?[id]:[id,owner])) as {record:string}|undefined;if(!row)throw new RequestError("Media not found.",404);const item=JSON.parse(row.record) as NsfwGalleryItem&{file?:string;previewId?:string};if(!item.file)throw new RequestError("Media not found.",404);const file=verifySavedNsfwGalleryFile(item.file);return {file,name:item.name,id,previewId:item.previewId,sha256:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),mime:item.kind==="video"?"video/mp4":"image/png"};}));
}

export function nsfwSavedGalleryPath(owner:string,previewId:string) {
 if(!/^[a-zA-Z0-9_-]{8,96}$/.test(previewId))throw new RequestError("Invalid saved take.",400);
 return withNsfwWorkspace(()=>{const directory=path.join(labRoot(),"saved-gallery",safeSegment(owner));fs.mkdirSync(directory,{recursive:true,mode:0o700});return path.join(directory,previewId+".mp4");});
}
