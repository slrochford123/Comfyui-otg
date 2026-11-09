import type {Asset} from "./model";
import type {CreateItem} from "./createTypes";
import {AssetPromptError,assetRole,type AssetPrompt} from "./assetPrompts";
import {ASSET_PROMPT_VERSION} from "@/lib/assets/productionReferencePolicy";

export function imageEditReferenceIds(raw:unknown):string[]{
  if(!Array.isArray(raw)||raw.length<1||raw.length>4||raw.some(id=>typeof id!=="string"||!id.trim()||id.length>200))throw new AssetPromptError("Select one source image and up to three additional references for FIBO Turbo. Nothing was discarded.");
  if(new Set(raw).size!==raw.length)throw new AssetPromptError("Each reference must be a different saved image.");
  return raw as string[];
}
export function buildAssetImageEditPrompt(item:CreateItem,instructions:unknown,assets:Asset[]):AssetPrompt{
  if(typeof instructions!=="string"||!instructions.trim()||instructions.length>6000)throw new AssetPromptError("Describe the edit in 1–6000 characters.");
  imageEditReferenceIds(assets.map(a=>a.id));
  if(assets.some(a=>!["image","character"].includes(a.kind)||!a.mime.startsWith("image/")))throw new AssetPromptError("FIBO references must be saved images or character images.");
  if(assets.some(a=>a.bytes>20*1024*1024))throw new AssetPromptError("Each FIBO reference must be at most 20 MB. Choose a smaller image.");
  const text=instructions.trim();
  // Explicit editing is intentionally separate from isolated-character/empty-set
  // generation defaults. A requested family photo must not acquire 'one person'
  // or 'no people' constraints from its destination asset category.
  return {version:ASSET_PROMPT_VERSION,role:assetRole(item),policy:"production-asset-edit",description:text,
    prompt:["Edit the supplied image references into one finished image according to the user's instructions.",...assets.map((a,i)=>`Reference ${i+1}: ${a.name.slice(0,200)}${i===0?" (primary source image)":""}.`),`User edit instructions: ${text}`].join("\n"),
    editInstruction:"Use the numbered references in the supplied order. Preserve the identity and distinguishing features of each requested character. Compose only the people and objects the user requests, with coherent scale, lighting and perspective. Do not replace identities or invent extra people. Follow the requested framing and background; do not force a single-person or isolated-object composition when a combined photo was requested.",
    omitted:[],review:`Check the requested edit: ${text}. Verify each requested character's identity, composition and framing before using this candidate.`,
    edit:{model:"fibo2-edit-turbo",instructions:text,references:assets.map(a=>({id:a.id,name:a.name,sha256:a.sha256}))}};
}
export function imageEditDetails(asset:Asset|undefined){
  const edit=(asset?.metadata.assetPrompt as AssetPrompt|undefined)?.edit;
  return edit?.model==="fibo2-edit-turbo"&&typeof edit.instructions==="string"?edit:undefined;
}
export function imageEditReview(asset:Asset|undefined){const details=imageEditDetails(asset);return details?`Check the requested edit: ${details.instructions}. Verify the identity of each requested character and the composition before approving.`:undefined;}
