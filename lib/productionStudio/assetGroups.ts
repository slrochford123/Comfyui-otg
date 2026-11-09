import type { Asset } from "./model";
/** Display grouping only: never deletes source imports or reference views. */
export function groupedAssets(assets:Asset[]){
  const children=new Set(assets.filter(a=>a.kind==="character").flatMap(a=>Array.isArray(a.metadata.imageIds)?a.metadata.imageIds.map(String):[]));
  const keys=new Set<string>();
  return assets.filter(a=>!children.has(a.id)).filter(a=>{const key=a.kind==="character"?`${a.kind}:${a.metadata.sourceId||a.metadata.sourceRequirementId||a.name}:${a.metadata.sourceVersion||a.sha256}`:`${a.kind}:${a.sha256}`;if(keys.has(key))return false;keys.add(key);return true;});
}
