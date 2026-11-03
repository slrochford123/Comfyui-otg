import { normalizeH3RefModSlots, type H3RefModSlot } from "@/lib/h3SpecialModes/refMods";

export type H3SmartReferenceSelection = { useFirstFrame: boolean; refMods: H3RefModSlot[] };
export type H3SmartReferenceAsset = { path: string; name: string; description: string };
export type H3SmartReferenceInput = H3SmartReferenceSelection & {
  originalPrompt?: string;
  firstFrame: H3SmartReferenceAsset | null;
  images: H3SmartReferenceAsset[];
  referenceMap: H3SmartReferenceMapEntry[];
};
export type H3SmartReferenceMapEntry = { tag: string; name: string; source: "image" | "media" | "refmod"; kind: "image" | "video" | "audio"; description: string; characterKey?: string; characterName?: string; voiceId?: string };
export type H3SmartRefModInfo = { name: string; kind: string; tokens?: number | null; members?: Array<{kind: "image" | "video" | "audio"; tokens: number}>; characterKey?: string; characterName?: string; voiceId?: string };
export type H3SmartReferenceCapabilities = {
  backend: "rtx3090" | "rtx5060ti";
  available: boolean;
  firstFrame: boolean;
  mixedReferences: boolean;
  reason: string;
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
  maxTotalReferenceMedia: number;
  maxRefModSlots: number;
  firstFrameConsumesReferenceAllowance: false;
  referenceTokenBudget: number | null;
  tokenBudgetExplanation: string;
  refMods: H3SmartRefModInfo[];
  combinedLimitBasis?: string;
};
export function normalizeH3SmartReferenceSelection(value: unknown): H3SmartReferenceSelection | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw Error("Invalid smart reference selection.");
  const v = value as Record<string, unknown>;
  if (v.useFirstFrame !== undefined && typeof v.useFirstFrame !== "boolean") throw Error("Use as First Frame must be on or off.");
  if (v.refMods !== undefined && !Array.isArray(v.refMods)) throw Error("Select RefMods from the library.");
  return { useFirstFrame: v.useFirstFrame === true, refMods: normalizeH3RefModSlots(v.refMods || []) };
}
export function checkH3SmartReferences(cap: H3SmartReferenceCapabilities, selection: H3SmartReferenceSelection,
  images: Array<{ name: string; description?: string }>, videos = 0, audios = 0, hasFirstFrame = false) {
  if (!cap.available) throw Error("H3 reference capabilities are unavailable. Recheck the selected GPU before generating.");
  if (selection.useFirstFrame && !cap.firstFrame) throw Error("Use as First Frame is unavailable on this GPU: the native timeline-guide node is missing.");
  if (selection.useFirstFrame && !hasFirstFrame) throw Error("Choose the opening image, or turn off Use as First Frame.");
  if (selection.refMods.length > cap.maxRefModSlots) throw Error(`Remove a RefMod: this GPU has ${cap.maxRefModSlots} loader slots.`);
  const mixed = selection.refMods.length > 0 && (images.length + videos + audios > 0);
  if (mixed && !cap.mixedReferences) throw Error(cap.reason || "Mixed references are unavailable on the selected GPU.");
  // The installed combined node exposes one video/audio without the native
  // paired-track/multi-video loader. Preserve the original media pipeline.
  if (mixed && (videos || audios)) throw Error("Keep video/audio references in the existing reference workflow, or remove the RefMods. This installed mixed path supports ordinary still images and RefMods; it does not replace the video/audio path.");
  const count = { image: images.length, video: videos, audio: audios };
  const map: H3SmartReferenceMapEntry[] = images.map((image, index) => ({ tag: `<Picture ${index + 1}>`, name: image.name, description: image.description || "", source: "image", kind: "image" }));
  let tokens = 0, tokensKnown = true;
  for (const slot of normalizeH3RefModSlots(selection.refMods)) {
    const info = cap.refMods.find(item => item.name === slot.name);
    if (!info) throw Error(`RefMod "${slot.name}" is not available on this GPU. Remove or replace it.`);
    if (slot.strength === 0) continue;
    const members = info.kind === "bundle" ? info.members : [info];
    if (!members?.length || members.some(m => !["image", "video", "audio"].includes(m.kind))) throw Error(`RefMod "${slot.name}" contains an unverified bundle layout. Its member counts must be verified before Smart References can use it.`);
    // Matches the installed loader: each member's copies precede the next member.
    for (const member of members) {
      const kind = member.kind as "image" | "video" | "audio";
      if (kind === "audio" ? slot.components === "Visual" || slot.audioStrength === 0 : slot.components === "Audio" || slot.visualStrength === 0) continue;
      const label = {image: "Picture", video: "Video", audio: "Audio"}[kind];
      for (let n = 0; n < slot.copies; n++) map.push({tag: `<${label} ${++count[kind]}>`, name: info.characterName || slot.name, description: slot.description, source: "refmod", kind, characterKey: info.characterKey, characterName: info.characterName, ...(kind === "audio" ? {voiceId: info.voiceId} : {})});
      if (typeof member.tokens === "number" && Number.isFinite(member.tokens)) tokens += member.tokens * slot.copies;
      else tokensKnown = false;
    }
  }
  for (const [kind, maximum] of [["image", cap.maxImages], ["video", cap.maxVideos], ["audio", cap.maxAudios]] as const) {
    if (count[kind] > maximum) throw Error(`Remove a ${kind} reference or reduce RefMod copies: ${count[kind]} ${kind} references exceed the verified ${maximum}-reference envelope. RefMod members and copies count too.`);
  }
  if (count.image + count.video + count.audio > cap.maxTotalReferenceMedia) throw Error(`Remove a reference or reduce RefMod copies: the workflow envelope is ${cap.maxTotalReferenceMedia} reference media in total, including RefMod members.`);
  if (cap.referenceTokenBudget !== null && (!tokensKnown || tokens > cap.referenceTokenBudget)) throw Error("The selected RefMods exceed the reference-token budget or have unknown token counts. Remove a RefMod or reduce copies.");
  return { referenceMap: map, counts: count, refModTokens: tokensKnown ? tokens : null };
}
const SMART_MARKER = "[H3 Smart References]";
export function h3CharacterVoicePromptLines(map: H3SmartReferenceMapEntry[]) {
  const groups = new Map<string, H3SmartReferenceMapEntry[]>();
  map.filter(item => item.kind !== "audio").forEach(item => {
    const key = item.characterKey || item.tag;
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return [...groups.entries()].flatMap(([key, visual], index) => {
    const voices = map.filter(item => item.kind === "audio" && item.voiceId && item.characterKey === key);
    if (new Set(voices.map(v => v.voiceId)).size > 1) throw Error(`Choose one saved voice version for ${visual[0].name}; different character voices cannot be assigned to the same subject.`);
    return [`<Subject ${index + 1}>${visual[0].characterName ? " = " + JSON.stringify(visual[0].characterName) : ""} uses ${visual.map(v => v.tag).join(", ")} for the identity or scene element requested in the original prompt. These references describe the same subject, not additional people.`,
      ...(voices.length ? [`Only <Subject ${index + 1}> uses ${voices.map(v => v.tag).join(", ")} as the saved character voice. Preserve its vocal identity while speaking only that character's requested dialogue. Do not copy the reference recording's words or assign this voice to other subjects.`] : [])];
  });
}
export function compileH3SmartReferencePrompt(prompt: string, input: Pick<H3SmartReferenceInput, "referenceMap" | "useFirstFrame">) {
  if (prompt.includes(SMART_MARKER)) return prompt;
  return "[Original user prompt]\n" + prompt + "\n\n" + SMART_MARKER + "\n" + [
    input.useFirstFrame ? "Begin from the supplied frame-zero image. Preserve its opening composition; it is a timeline keyframe, not an additional identity reference." : "",
    ...input.referenceMap.map(item => `${item.tag} = ${JSON.stringify(item.name)} (${item.source === "refmod" ? "saved RefMod" : item.kind === "image" ? "ordinary reference image" : `reference ${item.kind}`})${item.description ? ": " + item.description : ""}.`),
    ...h3CharacterVoicePromptLines(input.referenceMap),
    "Use the mapped references for the subjects and scene requested above. Preserve their identity and appearance; do not add unrequested subjects. Follow the original action and dialogue without repeating speech.",
  ].filter(Boolean).join("\n");
}

/** Native video soundtracks get Audio ordinals before standalone audio. */
export function appendH3SmartMediaMap(map: H3SmartReferenceMapEntry[], videos: Array<{name: string; description?: string; includeAudio?: boolean}>, audios: Array<{name: string; description?: string}>) {
  const result = [...map]; let audio = 0;
  videos.forEach((item, index) => {
    if (item.includeAudio) result.push({tag: `<Audio ${++audio}>`, name: item.name + " soundtrack", description: "Soundtrack of the same reference video", source: "media", kind: "audio"});
    result.push({tag: `<Video ${index + 1}>`, name: item.name, description: item.description || "", source: "media", kind: "video"});
  });
  audios.forEach(item => result.push({tag: `<Audio ${++audio}>`, name: item.name, description: item.description || "", source: "media", kind: "audio"}));
  return result;
}
