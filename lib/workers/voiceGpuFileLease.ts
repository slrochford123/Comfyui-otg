import fs from "node:fs";
import path from "node:path";
import {spawn,spawnSync} from "node:child_process";
import { sharedVoiceLockPath } from "@/lib/runtime/configPaths";

// Same server-configured lock used by the existing Python voice workers.
// No path, command, hostname or service name comes from an HTTP request.
function lockPath(){return sharedVoiceLockPath();}
export function voiceGpuFileBusy(){
  const file=lockPath();fs.mkdirSync(path.dirname(file),{recursive:true});
  const check=spawnSync("/usr/bin/flock",["--nonblock",file,"/usr/bin/true"],{timeout:1000,stdio:"ignore"});
  if(check.status===0)return false;if(check.status===1)return true;
  throw Error("Cannot verify the shared voice GPU lock.");
}
export async function acquireVoiceGpuFileLease():Promise<()=>void>{
  const file=lockPath();fs.mkdirSync(path.dirname(file),{recursive:true});
  // --no-fork means this exact child becomes the lock holder. Its stdin also
  // closes if the web process exits. Never kill a GPU/model/owner process.
  const child=spawn("/usr/bin/flock",["--nonblock","--no-fork",file,process.execPath,"-e","process.stdout.write('locked\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],{stdio:["pipe","pipe","ignore"]});
  let released=false;
  const release=()=>{if(released)return;released=true;child.stdin.end();child.kill("SIGTERM");};
  try{
    await new Promise<void>((resolve,reject)=>{
      let ready=false;const timer=setTimeout(()=>{release();reject(Error("Cannot confirm the shared voice GPU lease."));},3000);
      child.once("error",()=>{clearTimeout(timer);reject(Error("Cannot acquire the shared voice GPU lease."));});
      child.once("exit",()=>{clearTimeout(timer);if(!ready)reject(Error("RTX 3090 is busy with an active voice operation."));});
      child.stdout.once("data",chunk=>{if(String(chunk).trim()!=="locked")return;ready=true;clearTimeout(timer);resolve();});
    });
    return release;
  }catch(error){release();throw error;}
}
