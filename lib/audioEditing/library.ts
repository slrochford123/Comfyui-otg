import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { loadVoicesLibrary, resolveVoicesFile, voicesRoot } from "@/lib/voicesStudio";
import { containedFile } from "./store";
import { STEMS,type Stem } from "./contracts";

export function audioLibrary(owner: string) {
  const items:Array<{id:string;name:string;origin:string;file:string;suggestedLane?:Stem;license?:string}>=[];
  const add=(file:string,name:string,origin:string,root:string)=>{
    try {
      const safe=containedFile(root,file);
      let suggestedLane:Stem|undefined=origin==="Voice Library"?"speech":origin==="Generated music"?"music":undefined;
      let license:string|undefined;
      try {
        const metadata=containedFile(root,safe+".json");
        if(fs.statSync(metadata).size<=65536){const data=JSON.parse(fs.readFileSync(metadata,"utf8"));if(STEMS.includes(data.suggestedLane))suggestedLane=data.suggestedLane;license=String(data.license||"").slice(0,200)||undefined;}
      }catch{/* Older library items have no sidecar. */}
      items.push({id:crypto.createHash("sha256").update(safe).digest("hex"),name,origin,file:safe,suggestedLane,license});
    } catch { /* Missing or out-of-scope entries are never exposed. */ }
  };
  const safe=safeSegment(owner);
  for(const [root,origin] of [
    [path.join(OTG_DATA_ROOT,"edit_video","music",safe,"library"),"Saved audio"],
    [path.join(OTG_DATA_ROOT,"edit_video","music",safe,"generated"),"Generated music"],
    [path.join(OTG_DATA_ROOT,"voice_gallery",safe),"Extracted audio"],
  ]) {
    if(!fs.existsSync(root))continue;
    for(const file of fs.readdirSync(root))if(/\.(wav|mp3|flac|m4a|aac|ogg)$/i.test(file))add(path.join(root,file),file,origin,root);
  }
  for(const voice of loadVoicesLibrary(owner).voices) {
    if(!/^[A-Za-z0-9_-]+$/.test(voice.voiceId)||!voice.voiceId.startsWith(`${safe}__`))continue;
    try { for(const kind of ["samples","outputs"])add(resolveVoicesFile(voice.refAudioRel),voice.name,"Voice Library",path.join(voicesRoot(),kind,voice.voiceId)); }
    catch { /* One stale or invalid saved reference must not hide the owner's other assets. */ }
  }
  return items;
}
