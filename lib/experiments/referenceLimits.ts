import type { LabSettings } from "./catalog";

// This is a model input limit, not a saved-upload or generated-history limit.
export const MAX_H3_RENDER_REFERENCES = 12;
type Source = {id:string;mime:string;role:string};

export function appendH3References(previous: string[], added: string[], assets: Source[], mode: LabSettings["mode"]): string[] {
  const byId=new Map(assets.filter(a=>a.role==="source").map(a=>[a.id,a]));
  if (["image","edit-image"].includes(mode)) {
    const replacement=[...added].reverse().find(id=>byId.get(id)?.mime.startsWith("image/"));
    const existing=previous.find(id=>byId.get(id)?.mime.startsWith("image/"));
    return replacement?[replacement]:existing?[existing]:[];
  }
  const limits:Record<string,number>={image:9,video:mode==="edit"?1:3,audio:mode==="edit"?0:3},counts:Record<string,number>={image:0,video:0,audio:0};
  return [...new Set([...previous,...added])].filter(id=>{
    const kind=byId.get(id)?.mime.split("/")[0];
    if (!kind || !(kind in limits) || counts[kind]>=limits[kind] || Object.values(counts).reduce((a,b)=>a+b,0)>=MAX_H3_RENDER_REFERENCES) return false;
    counts[kind]++;return true;
  });
}
