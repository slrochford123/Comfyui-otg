import type {H3ContinuationSource} from "@/lib/h3ContinuationContract";
export type Frame = {id:string;file:string;time:number;width:number;height:number};
export const MAX_CHARACTER_REFERENCES = 4;
export const SOURCE_VIEW_ROLES = ["Primary Face", "Clothing / Full Body", "Alternate Angle", "Side or Back View"] as const;
export type CharacterReference = { file: string; frame: string; role?: typeof SOURCE_VIEW_ROLES[number] };
export type ApprovedView = { id: string; file: string; label: string; origin: "captured" | "reconstructed" | "upscaled"; frame?: string; look?: string };
export type DevelopmentRole = "model" | "face" | "left" | "right" | "back";
export type CharacterDevelopment = {version:1;modelId?:string;approvedModelId?:string;sheet?:{id:string;file:string;modelId:string;viewIds:string[];approvedAt:string};priorSheets?:Array<{id:string;file:string;modelId:string;viewIds:string[];approvedAt:string}>};
export type View = {developmentRole?:DevelopmentRole;correction?:string;modelId?:string;approvedAt?:string;id:string;angle:string;master?:true;sourceViewId?:string;file?:string;job?:string;state:string;gpu?:"rtx3090"|"rtx5060ti"|"rtx3060";baseUrl?:string;prompt?:string;seed?:number;references?:CharacterReference[];originalReferences?:CharacterReference[];error?:string};
export type Candidate = {development?:CharacterDevelopment;id:string;name:string;nameSavedAt?:string;description:string;frame:string;file:string;bbox:number[];score?:number;selected:boolean;approved:boolean;views:View[];priorViews?:View[];alternateForms:string[];voiceId:string|null;voiceReviewed:boolean;origin:string;extractedFile?:string;extractedFrame?:string;card?:string;globalId?:string;bundle?:{job:string;name:string;state:string;visualOnly?:boolean;sourceCount?:number;execution?:"private3060";coordinatorPid?:number;gpu?:"rtx5060ti"|"rtx3060";baseUrl?:string;tokens?:number;file?:string;sha256?:string;error?:string};priorBundles?:NonNullable<Candidate["bundle"]>[];mergedFrom?:string[];referenceIds?:string[]; referenceRoles?:Record<string,typeof SOURCE_VIEW_ROLES[number]>; approvedViews?:ApprovedView[]; look?:string };
export type Voice = {id:string;name:string;file:string;duration:number;segments:Array<{start:number;end:number;file?:string}>;warning:string;combined:boolean;sourceReference?:boolean};
export type Workspace = {continuation?:H3ContinuationSource;continuationLastFrame?:string;completedAt?:string;completedCharacterIds?:string[];savedCharacters?:Record<string,import("./voiceContract").SavedCharacterSummary>;id:string;revision:number;owner:string;libraryOwner?:string;productionId:string;sourceName:string;sourceSha256:string;created:string;updated:string;stage:number;state:string;message:string;frames:Frame[];candidates:Candidate[];voices:Voice[];warnings:string[];duration:number;detector?:string;diarization?:string;separation?:string;sourceRefs?:Array<{id:string;name:string;file:string;originalFile?:string}>;analysis?:{pid:number;request:string;output:string;voiceOnly?:boolean};};


export function characterReferenceIds(character: Candidate, candidates: Candidate[]) {
  if (character.referenceIds) return character.referenceIds;
  const legacy = candidates.find(item =>
    (item.id === character.id || character.mergedFrom?.includes(item.id)) &&
    (item.extractedFile || item.file) === character.file
  );
  return [legacy?.id || character.id];
}

export const DEVELOPMENT_VIEWS = [
 {id:"face",label:"Face close-up",instruction:"A front-facing close-up of the face and shoulders, preserving apparent age, facial identity and hairstyle."},
 {id:"left",label:"Left view",instruction:"A left three-quarter full-body view. Turn the whole character 45 degrees left; do not mirror. Include the entire head and feet."},
 {id:"right",label:"Right view",instruction:"A right three-quarter full-body view. Turn the whole character 45 degrees right; do not mirror. Include the entire head and feet."},
 {id:"back",label:"Back view",instruction:"A full-body view directly from behind. Preserve hair, outfit, colors, silhouette and proportions. Include the entire head and feet."},
] as const;
export function approvedDefaultModel(c:Candidate) {
 return c.views.find(v=>v.id===c.development?.modelId&&v.id===c.development?.approvedModelId&&v.developmentRole==="model"&&v.state==="ready"&&v.file&&v.approvedAt);
}
export function developmentCardViews(c:Candidate) {
 const model=approvedDefaultModel(c);
 return model?[model,...DEVELOPMENT_VIEWS.map(role=>[...c.views].reverse().find(v=>v.developmentRole===role.id&&v.modelId===model.id))]:[];
}
export function completeDevelopmentCard(c:Candidate) {
 const views=developmentCardViews(c),sheet=c.development?.sheet;
 return !!sheet&&views.length===5&&views.every(v=>v?.state==="ready"&&v.file&&v.approvedAt)&&sheet.modelId===views[0]!.id&&sheet.viewIds.join()===views.map(v=>v!.id).join();
}
