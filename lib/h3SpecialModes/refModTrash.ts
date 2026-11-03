import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {OTG_DATA_ROOT} from "@/lib/paths";
import {atomicJson} from "@/lib/audioEditing/store";
import {RequestError} from "@/lib/requestError";
import {characterRefCardsEnabled} from "./characterRefCardAvailability";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
function root(owner:string){if(!owner)throw new RequestError("Sign in first.",401);return path.join(OTG_DATA_ROOT,"h3-special","refmods","trash",hash(owner));}
export function canonicalRefName(value:string){
  const name=value.replaceAll("\\","/");
  if(!name||name.length>500||name.split("/").some(p=>!p||p==="."||p==="..")||/[\x00-\x1f]/.test(name))throw new RequestError("Invalid RefMod name.",400);
  return name;
}
const file=(owner:string,name:string)=>path.join(root(owner),hash(canonicalRefName(name))+".json");
export function refModIsDeleted(owner:string,name:string){
  if(!characterRefCardsEnabled())return false;
  try{return fs.existsSync(file(owner,name));}catch{return true;}
}
export function trashRefMod(owner:string,name:string,displayName:string){
  if(!characterRefCardsEnabled())throw new RequestError("Not found.",404);
  const target=file(owner,name);if(!fs.existsSync(target))atomicJson(target,{name:canonicalRefName(name),displayName:displayName.slice(0,160),deletedAt:new Date().toISOString()});
}
export function restoreRefMod(owner:string,name:string){
  if(!characterRefCardsEnabled())throw new RequestError("Not found.",404);
  fs.rmSync(file(owner,name),{force:true});
}
export function deletedRefMods(owner:string):Array<{name:string;displayName:string;deletedAt:string}>{
  const dir=root(owner);if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).flatMap(n=>{try{return [JSON.parse(fs.readFileSync(path.join(dir,n),"utf8"))];}catch{return [];}}).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
}
