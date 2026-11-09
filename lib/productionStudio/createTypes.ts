export const requirementKinds = ["environment", "character", "prop", "wardrobe", "background", "music", "sfx", "ambience"] as const;
export type RequirementKind = typeof requirementKinds[number];
export type AssetComposition = {environmentMode?:"empty"|"generic-extras"|"specified-people";people?:string;characterMode?:"reference"|"environmental"};
export type CreateItem = {
  id: string; kind: RequirementKind; name: string; role: string; description: string;
  prompt: string; sourceSegmentIds: string[]; continuity: string[]; evidence: string;
  speaking: boolean; optional: boolean; question: string;
  status: "todo" | "ready" | "deferred" | "needs-review";
  candidateIds: string[]; assetId?: string; referenceIds: string[]; voiceId?: string;
  voiceSkipped?: boolean; refModId?: string; refModSkipped?: boolean; refCardId?: string;
  sourceLibraryId?: string; approvedStoryKey?: string; approvedVersions?: Record<string, string>;
  step: "appearance" | "voice" | "refmod" | "save"; savedLibraryId?: string;
  voiceDirection?: string; chooseExisting?: boolean;
  origin?: "manual";
  removedAt?: string;
  removedBindings?: Array<{assetId:string;role:string;approved:boolean}>;
  // Empty appearance is valid story data, not a failed inventory. Decisions stay
  // separate from approved identity/media until explicitly supplied or accepted.
  missingDetails?: string[]; creativeDetailsResolved?: boolean;
  composition?:AssetComposition;
  candidateReviews?:Record<string,{status:"suitable"|"unsuitable";reason:string;assetSha256:string;scope:string}>;
};
export type CreateManifest = {
  schemaVersion: 1; storyKey: string; storyVersion: number; briefKey: string; items: CreateItem[];
  retiredItems: CreateItem[]; started: boolean; activeItemId?: string; changes: string[];
  analyzedAt?: string; sourceRevision?: number;
};
export function needsCreativeDetails(item: CreateItem) { return !item.creativeDetailsResolved && (!!item.missingDetails?.length || !!item.question); }
export function analysisCompletion(items: CreateItem[]) { return items.some(needsCreativeDetails) ? "Completed — Needs Creative Details" : "Completed"; }
export type CreateSuggestion = { itemId: string; name: string; prompt: string; voiceDirection: string; action: "revise" | "choose-existing" | "defer" | "navigate"; targetItemId: string };
export function isAudioRequirement(kind: RequirementKind) { return ["music", "sfx", "ambience"].includes(kind); }
export function preparationSummary(items: CreateItem[]) {
  return requirementKinds.map(kind => { const n = items.filter(i => i.kind === kind).length; return n ? `${n} ${kind === "sfx" ? "sound effect" : kind}${n === 1 ? "" : "s"}` : ""; }).filter(Boolean).join(", ");
}
