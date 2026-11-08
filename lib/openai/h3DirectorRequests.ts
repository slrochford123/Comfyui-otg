import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { RequestError } from "@/lib/requestError";
import { dispatchProcessState, readDispatchProcess } from "@/lib/workers/dispatchProcess";

const keyPattern = /^[\w.-]{8,120}$/;
type Result = {status: number; body: unknown};
type Row = { input_hash:string; worker:string; status:number|null; result:string|null };

function use<T>(fn:(db:Database.Database)=>T) {
  const dir=path.join(OTG_DATA_ROOT,"h3-director");
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,"requests.sqlite");
  const db=new Database(file);
  try {
    fs.chmodSync(file,0o600);
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.exec("CREATE TABLE IF NOT EXISTS requests(account TEXT, request TEXT, input_hash TEXT, instruction TEXT, worker TEXT, status INTEGER, result TEXT, PRIMARY KEY(account,request))");
    return fn(db);
  } finally {db.close();}
}

function rowFor(db:Database.Database,account:string,key:string) {
  return db.prepare("SELECT input_hash,worker,status,result FROM requests WHERE account=? AND request=?").get(account,key) as Row|undefined;
}
function resultFor(row:Row):Result {
  if(row.status!==null)return {status:row.status,body:JSON.parse(row.result!)};
  if(dispatchProcessState(JSON.parse(row.worker))==="stopped") {
    return {status:409,body:{ok:false,state:"interrupted",error:"The H3 Director request was interrupted. Its instruction was saved. Review the conversation before submitting a new request."}};
  }
  return {status:202,body:{ok:true,state:"pending"}};
}

export function claimH3DirectorRequest(account:string,key:string,input:unknown,instruction:string) {
  if(!keyPattern.test(key))throw new RequestError("Invalid H3 Director request ID.",400);
  const inputHash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return use(db=>db.transaction(()=>{
    const row=rowFor(db,account,key);
    if(row) {
      if(row.input_hash!==inputHash)throw new RequestError("This H3 Director request ID was already used for a different instruction.",409);
      return {accepted:false,result:resultFor(row)};
    }
    db.prepare("INSERT INTO requests(account,request,input_hash,instruction,worker) VALUES (?,?,?,?,?)")
      .run(account,key,inputHash,instruction,JSON.stringify(readDispatchProcess()));
    return {accepted:true,result:{status:202,body:{ok:true,state:"pending"}}};
  }).immediate());
}

export function readH3DirectorRequest(account:string,key:string) {
  if(!keyPattern.test(key))throw new RequestError("Invalid H3 Director request ID.",400);
  return use(db=>{
    const row=rowFor(db,account,key);
    if(!row)throw new RequestError("H3 Director request not found.",404);
    return resultFor(row);
  });
}

export function finishH3DirectorRequest(account:string,key:string,result:Result) {
  use(db=>db.prepare("UPDATE requests SET status=?,result=? WHERE account=? AND request=? AND worker=? AND status IS NULL")
    .run(result.status,JSON.stringify(result.body),account,key,JSON.stringify(readDispatchProcess())));
}
