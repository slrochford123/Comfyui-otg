import type {Project,Asset} from "./model";
import type {CreateItem,AssetComposition} from "./createTypes";
import {previewFromPlan} from "./storyPreview";
import {ASSET_PROMPT_VERSION,productionReferencePolicy} from "@/lib/assets/productionReferencePolicy";
export class AssetPromptError extends Error { status=422; }
export type AssetRole="environment"|"main-character"|"supporting-character"|"background-group"|"prop"|"wardrobe";
export type AssetPrompt={version:number;role:AssetRole;policy:string;description:string;prompt:string;omitted:string[];review:string;editInstruction:string;edit?:{model:"fibo2-edit-turbo";instructions:string;references:Array<{id:string;name:string;sha256:string}>}};
export function assetRole(item:CreateItem):AssetRole {
  if(item.kind==="character")return /\b(main|lead|central|protagonist|heroine|hero)\b/i.test(item.role)?"main-character":"supporting-character";
  if(item.kind==="background")return "background-group";
  if(["environment","prop","wardrobe"].includes(item.kind))return item.kind as AssetRole;
  throw new AssetPromptError("Choose a visual asset, not an audio requirement.");
}
export function assetLabel(item:CreateItem){return item.kind==="character"?"Character":item.kind==="background"?"Background Group":item.kind==="wardrobe"?"Wardrobe / Accessory":item.kind==="prop"?"Prop":"Environment";}
export function readAssetComposition(kind:CreateItem["kind"],raw:unknown):AssetComposition {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new AssetPromptError("Invalid asset composition.");
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["environmentMode","people","characterMode"].includes(k)))throw new AssetPromptError("Unsupported asset composition option.");
  if(v.environmentMode!==undefined&&(kind!=="environment"||!["empty","generic-extras","specified-people"].includes(String(v.environmentMode))))throw new AssetPromptError("Choose an environment occupancy option.");
  if(v.characterMode!==undefined&&(kind!=="character"||!["reference","environmental"].includes(String(v.characterMode))))throw new AssetPromptError("Choose a character reference composition.");
  if(v.people!==undefined&&(kind!=="environment"||typeof v.people!=="string"||v.people.length>1000))throw new AssetPromptError("Describe only the explicitly requested people, within 1000 characters.");
  return {...v} as AssetComposition;
}
const people=/\b(people|humans?|person|persons|women|woman|men|man|girl|boy|customers?|patrons?|staff|cashiers?|baristas?|robbers?|characters?|crowds?|extras|children|child)\b/i;
const action=/\b(robbery|confrontation|aftermath|subdued|defeats?|defeating|attacks?|attacking|shelter|sheltering|fights?|fighting|chases?|chasing|runs?|running|walks?|walking|approach(?:es|ing)?|gestures?|blocking|escaped?|falling|fallen|fall|phone call|on the phone|dialogue|speech|voice|closing beat|preceding|following|between cuts|scene action|story action|stunt|choreograph\w*)\b/i;
const setting=/\b(caf[eé]|coffee[ -]shop|counter|furniture|seating|table|chair|window|entrance|doorway|aisle|street|vehicle|room|interior|exterior|landscape framing|landscape composition|screen[ -](?:left|right)|background focus)\b/i;
const appearance=/\b(hair|hairstyle|eyes?|skin|complexion|face|facial|beard|moustache|mustache|freckles|scar|jacket|hoodie|coat|apron|shirt|pants|trousers|dress|skirt|hat|cap|boots?|shoes?|wardrobe|outfit|wear(?:s|ing)?|clothing|body|height|tall|short|slender|skinny|petite|build|muscular|age|years? old|year[ -]old|ethnicity|ethnic|caucasian|black|white|asian|latino|latina|brown|pale|dark|light|blue|green|red)\b/i;
const controls=/\b(?:scene|shot|beat|continuity|across both|throughout|remain(?:s)?|stay(?:s)?|until|after being|before being|immediately continuous|time jump|landscape framing|landscape composition|portrait framing|close[ -]?up|headshot|waist[ -]?up|bust portrait|cropped portrait)\b/i;
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function clauses(text:string){return text.split(/[\n;.!?]+|,\s*/).map(s=>s.trim()).filter(Boolean);}
/** Conservative legacy cleanup, not a visual detector. Excluded text remains visible/recoverable. */
function cleanDetails(p:Project,item:CreateItem,text:string,mode:"environment"|"identity"|"object"|"group"){
  const omitted:string[]=[],kept:string[]=[];
  const names=(p.creation?.items||[]).filter(i=>i.kind==="character"&&i.id!==item.id).map(i=>i.name).filter(n=>n.length>1&&!/^(woman|man|girl|boy|heroine|hero|robber|barista|cashier)$/i.test(n));
  // Separate named wardrobe clauses before screening; do not lose this person's coat
  // just because the same continuity sentence also describes another person's apron.
  const separated=text.replace(/\s+(?:and|&)\s+(?=[A-Z][\w -]{0,40}['’]s\b)/g,". ");
  for(const original of clauses(separated)){
    let c=original.replace(/\bcafé(?=\W|$)/ig,"cafe");
    if(mode==="environment")c=c.replace(/\b(?:where|while|with)\s+(?:the\s+)?(?:customers?|patrons?|staff|cashiers?|baristas?|robbers?|people|characters?)\b.*$/i,"");
    else c=c.replace(/\b(?:in|inside|outside|near|beside|behind|at|on|within|against)\s+(?:(?:the|a|an|same|this)\s+)?(?:(?:neighborhood|screen[ -](?:left|right))\s+)?(?:caf[eé]|coffee[ -]shop|counter|table|chair|entrance|doorway|seating|aisle|street|room|vehicle|store|furniture)\b.*$/i,"");
    c=c.replace(/\b(?:while|when|after|before|until)\b.*$/i,"").replace(/\b(?:standing|sitting|lying)\s+(?:near|at|beside|behind|on|in)\b.*$/i,"");
    if(mode==="object")c=c.replace(/\b(?:for|worn by|used by|belonging to)\s+(?:the\s+)?(?:[A-Z][\w'’ -]*|woman|man|robber|barista|cashier)\b.*$/,"");
    c=c.replace(/^(?:use|keep|preserve|maintain)\s+(?:the\s+)?(?:proposed\s+)?/i,"").replace(/\bonly upon approval\b/ig,"").replace(/\b(?:is|as) (?:the )?proposed identifying wardrobe\b/ig,"").replace(/\b(?:proposed|established|approved)\b/ig,"");
    if(mode==="group")c=c.replace(/\b(?:caf[eé]|coffee[ -]shop)\s+(?=customers?|patrons?|staff)/ig,"");
    c=c.replace(/\s+/g," ").trim().replace(/[, :\-]+$/,"");
    const containsOther=names.some(n=>new RegExp(`\\b${escape(n)}\\b`,"i").test(c));
    const bad=!c||action.test(c)||controls.test(c)||/\b(?:unspecified|unresolved|not specified|not supplied|require[sd]? (?:owner )?(?:approval|confirmation)|no supplied|final design|missing asset|rejected|position continuous)\b/i.test(c)||/^(?:initially|and position|same position|position|appearance|wardrobe|and appearance|and wardrobe)$/i.test(c)
      ||(mode==="environment"&&(people.test(c)||containsOther))
      ||(mode!=="environment"&&(setting.test(c)||containsOther))
      ||(mode==="object"&&people.test(c));
    if(bad){omitted.push(original);continue;}
    if(c!==original)omitted.push(original);
    kept.push(c);
  }
  return {text:[...new Set(kept)].join(". "),omitted};
}
function identityDetails(p:Project,item:CreateItem,text:string){
  const primary=cleanDetails(p,item,text,item.kind==="background"?"group":item.kind==="character"?"identity":"object");
  // Only identity-bearing continuity is eligible; action/location continuity stays in the story.
  const extras=item.continuity.filter(c=>appearance.test(c));
  const filtered=cleanDetails(p,item,extras.join(". "),item.kind==="character"?"identity":item.kind==="background"?"group":"object");
  return {text:[...new Set([primary.text,filtered.text].filter(Boolean))].join(". "),omitted:primary.omitted};
}
export function assetDescription(p:Project,item:CreateItem,text=item.prompt){
  if(item.kind==="environment")return cleanDetails(p,item,text,"environment");
  return identityDetails(p,item,text);
}
function environmentContext(p:Project,item:CreateItem){
  const first=previewFromPlan(p.plan)?.segments.find(s=>item.sourceSegmentIds.includes(s.id));
  return cleanDetails(p,item,[first?.location,first?.timeOfDay,first?.lighting,p.brief.atmosphere,...item.continuity].filter(Boolean).join(". "),"environment").text;
}
function environment(p:Project,item:CreateItem,description:string){
  const mode=item.composition?.environmentMode||"empty";
  const policy=mode==="empty"?"production-environment-empty":mode==="generic-extras"?"production-environment-extras":"production-environment-requested";
  if(mode==="specified-people"&&!item.composition?.people?.trim())throw new AssetPromptError("Describe the people you explicitly want in this environment, or select Empty Environment.");
  return {policy,details:[`Location: ${item.name}`,description,environmentContext(p,item),mode==="generic-extras"?"Include a few unobtrusive generic anonymous extras.":mode==="specified-people"?`Explicitly requested people: ${item.composition!.people!.trim()}`:""]};
}
function character(p:Project,item:CreateItem,description:string,main:boolean){
  const environmental=item.composition?.characterMode==="environmental";
  return {policy:environmental?"production-character-environmental":main?"production-main-character":"production-supporting-character",details:[`Character identity: ${item.name}`,description,environmental?`Selected setting: ${environmentContext(p,item)}`:""]};
}
function background(_p:Project,item:CreateItem,description:string){return {policy:"production-background-group",details:[`Group: ${item.name}`,description]};}
function prop(_p:Project,item:CreateItem,description:string){return {policy:"production-prop",details:[`Object: ${item.name}`,description]};}
function wardrobe(_p:Project,item:CreateItem,description:string){return {policy:"production-wardrobe",details:[`Wardrobe/accessory: ${item.name}`,description]};}
export function buildProductionAssetPrompt(p:Project,item:CreateItem,text=item.prompt):AssetPrompt {
  if(typeof text!=="string"||text.length>12000)throw new AssetPromptError("Describe this asset within 12000 characters.");
  if(item.composition)readAssetComposition(item.kind,item.composition);
  const role=assetRole(item),clean=assetDescription(p,item,text);
  const value=role==="environment"?environment(p,item,clean.text):role==="main-character"?character(p,item,clean.text,true):role==="supporting-character"?character(p,item,clean.text,false):role==="background-group"?background(p,item,clean.text):role==="prop"?prop(p,item,clean.text):wardrobe(p,item,clean.text);
  const style=cleanDetails(p,item,p.brief.style,role==="environment"?"environment":"identity").text;
  const rules=productionReferencePolicy(value.policy)!;
  const prompt=[rules[0],...value.details.filter(Boolean),style?`Visual style: ${style}`:"",...rules.slice(1),"Clear reusable production reference; no watermark."].filter(Boolean).join("\n");
  if(prompt.length>3800)throw new AssetPromptError("This asset description is too long for the qualified image workflow. Shorten its visual details; keep scene action in the story.");
  const review=role==="environment"?(item.composition?.environmentMode&&item.composition.environmentMode!=="empty"?"Location is readable; only the explicitly requested extras/people are present.":"Location only: no people or story action."):role.endsWith("character")?"Exactly one character; head, arms, hands, legs and feet fully visible; no unwanted scenery or other people.":role==="background-group"?"Generic group only, readable figures, no featured identities or scene action.":role==="wardrobe"?"Complete standalone garment/accessory, no wearer or scene.":"Complete isolated object, no people, surrounding set or duplicates.";
  return {version:ASSET_PROMPT_VERSION,role,policy:value.policy,description:clean.text,omitted:clean.omitted,prompt,review,editInstruction:role==="environment"?"Preserve the supplied location's architecture and set dressing only; remove any people not explicitly requested by the current occupancy option.":role.endsWith("character")?"Preserve only the selected character's identity, physical features and wardrobe. Recompose as the requested complete full-body reference, removing unrelated people and unwanted scenery; do not preserve the source scene action.":"Preserve the requested asset's design and visible details only; remove unrelated subjects and scene action."};
}
export function candidateReviewScope(item:CreateItem){return JSON.stringify([ASSET_PROMPT_VERSION,item.kind,item.name,item.prompt,item.composition||{}]);}
export function candidateAssessment(item:CreateItem,a:Asset){
  const scope=candidateReviewScope(item),direct=item.candidateReviews?.[a.id];
  if(direct&&direct.assetSha256===a.sha256&&direct.scope===scope)return direct.status;
  // Save Character pins the same approved pixels under a new identity asset ID.
  // Carry review by exact content hash only within this item and current prompt scope.
  const matching=Object.values(item.candidateReviews||{}).filter(r=>r.assetSha256===a.sha256&&r.scope===scope);
  if(matching.some(r=>r.status==="unsuitable"))return "unsuitable";
  return matching.some(r=>r.status==="suitable")?"suitable":"unreviewed";
}
