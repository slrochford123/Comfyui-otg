import fs from "node:fs";
import path from "node:path";
import {createHash,randomInt} from "node:crypto";
import Database from "better-sqlite3";
import {OTG_DATA_ROOT} from "@/lib/paths";
import type {H3EnhanceLevel} from "./h3DraftEnhancement";

const canonical=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export const newH3EnhancementSeed=()=>randomInt(1,2147483647);
export class H3EnhancementVariationError extends Error {
 constructor(){super("The enhancer could not produce a fresh variation. Your original text was kept; try again.");this.name="H3EnhancementVariationError";}
}
/** Hash-only history, shared across processes. No source text or dialogue is stored. */
export function acceptH3EnhancementVariation(owner:string,source:string,level:H3EnhanceLevel,text:string,seed:number,scope="standard"){
 if(canonical(source)===canonical(text))throw new H3EnhancementVariationError();
 const dir=path.join(OTG_DATA_ROOT,"h3-enhancement");fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const db=new Database(path.join(dir,"variations.sqlite"),{timeout:5000});
 try{
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS variations(owner TEXT NOT NULL,source TEXT NOT NULL,level TEXT NOT NULL,output TEXT NOT NULL,seed INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,source,level,output))");
  const row=db.prepare("INSERT OR IGNORE INTO variations VALUES(?,?,?,?,?,?)").run(hash(scope+":"+owner),hash(canonical(source)),level,hash(canonical(text)),seed,Date.now());
  if(row.changes!==1)throw new H3EnhancementVariationError();
 }finally{db.close();}
}
export const h3EnhancementVariationReminder="Use a fresh, clearly different wording and sentence opening for this variation. Preserve the original meaning, characters, action, outcome and exact dialogue tokens. Do not add random story events, artificial suffixes or a variation number to the prose.";
