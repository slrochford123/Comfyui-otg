import type { H3DirectReference } from "@/lib/h3DirectJobs";
import type { H3SmartReferenceMapEntry } from "@/lib/h3SmartReferences";
import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";
import type { H3ProductionDuration } from "@/lib/production/h3ProductionRecipes";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";
import { validateH3DirectedPrompt } from "@/lib/openai/h3SceneDirection";

export const H3_CHARACTER_VOICE_RECIPES = ["native", "visual-refmod", "visual-refmod-wav", "combined-refmod"] as const;
export type H3CharacterVoiceRecipe = typeof H3_CHARACTER_VOICE_RECIPES[number];
export type H3CastBinding = { characterId: string; name: string; aliases?: string[]; identity?: string; subject: string; visual: string[]; audio: string[]; voiceId?: string; voiceName?: string; speakerId?: string };
export type H3VoiceEvent = { lineId: string; characterId: string; speakerId: string; wordText: string; language: string; shot: number; startSeconds?: number; endSeconds?: number; offScreen?: boolean };
export type H3CharacterVoicePlan = {
  recipe: H3CharacterVoiceRecipe;
  nativeAudio?: true;
  bindings: H3CastBinding[];
  events: H3VoiceEvent[];
  sharedIdentityPrompt?: string;
  nativeVoiceSeconds?: number[];
  references: H3SmartReferenceMapEntry[];
  refMods: H3RefModSlot[];
  refModSignatures?: Record<string, string>;
  inputHashes: Record<string, string>;
  voiceTargets: Array<{ characterId: string; modelId: string; sample: H3DirectReference; sha256: string }>;
};

const SECTIONS = /^(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music):[ \t]*/gim;
const GUIDE = "Use the supplied opening guide for the 0.00-second composition and develop the requested action from it.";
const LABEL = /<(Subject|Picture|Video|Audio) (\d+)>/g;
const DIALOGUE = /<d>\[([^\]\n]+)\][ \t]+([\s\S]*?)<\/d>|"([^"\n]+)"|“([^”\n]+)”/g;
const SPEECH = /\b(?:says?|said|whispers?|whispered|asks?|asked|replies|replied|shouts?|shouted|yells?|yelled|answers?|answered|mutters?|muttered|calls? out|called out|speaks?)\b/gi;
const QUOTED_SPEECH_BOUNDARY = /\n|[!?;]\s|(?<!\d)\.\s/;
const VISIBLE_QUOTE = /\b(?:sign|poster|label|title card|letter|screen|subtitle|inscription|visible text)\b.*\b(?:reads?|says?|displays?|shows?)\b/i;
const TIME_WINDOW = /(?:from\s+)?(\d+(?:\.\d+)?)\s*s?\s*(?:–|—|-|to)\s*(\d+(?:\.\d+)?)\s*s?/i;
const OFF_SCREEN = /\boff[ -]screen\b|\bvoice[ -]?over\b|\bnever seen\b/i;
const AUTHOR_ALIAS = /(?<![\p{L}\p{N}])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

function fields(prompt: string) {
  const markers = [...prompt.matchAll(SECTIONS)];
  const result: Record<string, string> = {};
  for (const [index, marker] of markers.entries()) {
    const key = marker[1].toLowerCase();
    if (Object.hasOwn(result, key)) throw Error(`The prompt has more than one ${key} section.`);
    result[key] = prompt.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? prompt.length).trim();
  }
  if (markers.length) result.leadingScene = prompt.slice(0, markers[0].index).trim();
  return result;
}

function namePattern(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
}

function castByName(text: string, cast: H3CastBinding[]) {
  return cast.filter(entry => [entry.name, ...(entry.aliases ?? [])].some(name => new RegExp(namePattern(name), "iu").test(text)));
}

function castMentions(text: string, cast: H3CastBinding[]) {
  return cast.flatMap(member => [member.name, ...(member.aliases ?? [])].flatMap(name =>
    [...text.matchAll(new RegExp(namePattern(name), "giu"))].map(match => ({ member, match }))));
}

function aliasKey(value: string) {
  return value.toLocaleLowerCase().replace(/[-\s]+/g, "_");
}

function validateCastReferences(cast: H3CastBinding[], references: H3SmartReferenceMapEntry[], refMode: boolean) {
  const ids = new Set<string>(), names = new Set<string>(), used = new Set<string>();
  const map = new Map(references.map(ref => [ref.tag, ref]));
  if (cast.length < 1 || cast.length > 3 || map.size !== references.length) throw Error("Choose one to three different Character Cards with unique references.");
  for (const [index, member] of cast.entries()) {
    const aliases = new Set([member.name, ...(member.aliases ?? [])].map(name => name.toLocaleLowerCase()));
    if (!member.name || member.subject !== `<Subject ${index + 1}>` || ids.has(member.characterId) || [...aliases].some(alias => names.has(alias))) throw Error("The selected cast has conflicting character IDs, names or aliases.");
    ids.add(member.characterId);
    aliases.forEach(alias => names.add(alias));
    if (refMode && !member.visual.length) throw Error(`The selected graph has no visual identity reference for ${member.name}.`);
    for (const [kind, tags] of [["visual", member.visual], ["audio", member.audio]] as const) {
      for (const tag of tags) {
        const ref = map.get(tag);
        if (used.has(tag) || !ref || ref.characterKey !== member.characterId || (kind === "audio" ? ref.kind !== "audio" || !member.voiceId || member.voiceId !== ref.voiceId : ref.kind === "audio")) {
          throw Error(`The selected graph no longer binds ${tag} to ${member.name}. Preview the current references.`);
        }
        used.add(tag);
      }
    }
  }
  if (used.size !== references.length) throw Error("The selected graph contains a reference without a selected cast role.");
}

/** Read the author's semantic mapping before translating identifiers to the actual selected assets. */
function importedIdentifiers(definitions: string, cast: H3CastBinding[]) {
  const known = new Map<string, H3CastBinding>();
  for (const line of definitions.split(/\n/)) {
    const tag = line.trim().match(/^<Subject \d+>/)?.[0];
    if (!tag) continue;
    const direct = line.trim().slice(tag.length).replace(/^\s*(?:is\s+|=\s*)?["“]?/i, "");
    const named = castMentions(direct, cast).find(mention => mention.match.index === 0)?.member;
    const names = named ? [named] : castByName(line, cast);
    if (names.length === 1) {
      if (known.has(tag) && known.get(tag)?.characterId !== names[0].characterId) throw Error(`${tag} identifies more than one cast member.`);
      known.set(tag, names[0]);
    }
    else if (names.length > 1) throw Error(`Identify one cast member for ${tag} in the prompt.`);
  }
  const tagMap = new Map([...known].map(([tag, entry]) => [tag, entry.subject]));
  for (const line of definitions.split(/\n/)) {
    const tags = [...line.matchAll(LABEL)].map(match => match[0]);
    const subject = tags.map(tag => known.get(tag)).find(Boolean) ?? castByName(line, cast).find((_, index, matches) => index === 0 && matches.length === 1);
    if (!subject) continue;
    const claimedSubjects = new Set(tags.flatMap(tag => known.has(tag) ? [known.get(tag)!.characterId] : []));
    if (/^<Audio \d+>/.test(line) && (claimedSubjects.size > 1 || castByName(line, cast).some(member => member.characterId !== subject.characterId))) throw Error("An authored Audio reference names multiple characters. Give it one owner.");
    const visual = tags.filter(tag => /^<(?:Picture|Video) /.test(tag));
    const audio = tags.filter(tag => tag.startsWith("<Audio "));
    for (const [from, to] of [[visual, subject.visual], [audio, subject.audio]]) {
      // Several archived visual references may have since been packed into one RefMod.
      if (from.length > to.length && to.length > 1) throw Error(`Review the visual and audio references for ${subject.name}. Their previous and selected roles do not match.`);
      from.forEach((tag, index) => {
        const target = to[index] ?? to[0];
        if (!target) return;
        if (tagMap.has(tag) && tagMap.get(tag) !== target) throw Error(`${tag} is assigned to multiple cast members. Correct its role in the prompt.`);
        tagMap.set(tag, target);
      });
    }
  }
  return { known, tagMap };
}

function speakerBefore(before: string, cast: H3CastBinding[], known: Map<string, H3CastBinding>, tagged: boolean) {
  const local = before.split(QUOTED_SPEECH_BOUNDARY).at(-1)!.slice(-240);
  const lastSpeech = [...local.matchAll(SPEECH)].at(-1);
  const prefix = lastSpeech ? local.slice(0, lastSpeech.index) : local;
  if (!tagged && !lastSpeech && !local.trimEnd().endsWith(":")) return undefined;
  const tags = [...prefix.matchAll(/<Subject \d+>/g)];
  const positions = [...castMentions(prefix, cast), ...tags.flatMap(match => known.has(match[0]) ? [{ member: known.get(match[0])!, match }] : [])]
    .sort((left, right) => (right.match.index ?? 0) - (left.match.index ?? 0));
  if (tags.some(match => !known.has(match[0]))) return undefined;
  const next = positions[0];
  if (!next) return undefined;
  const named = new Set(positions.map(position => position.member.characterId));
  if (named.size === 1) return next.member;
  const suffix = prefix.slice(next.match.index! + next.match[0].length).replace(/\([^)]*\)/g, "").trim();
  if (/^(?:[:,\s-]|\b(?:quietly|gently|angrily|softly|calmly|urgently|off-screen|offscreen|in a whisper)\b)*$/i.test(suffix)) return next.member;
  throw Error("Two characters appear in the speech cue. Put the speaking character's name directly before the quoted line.");
}

type Shot = { heading: string; content: string };
function readShots(source: string): Shot[] {
  const marks = [...source.matchAll(/^\[Shot (\d+)\][ \t]*/gim)];
  if (!marks.length) return [{ heading: "[Shot 1]", content: source }];
  return marks.map((mark, index) => {
    if (Number(mark[1]) !== index + 1) throw Error("Number the shot headings in playback order from Shot 1.");
    let content = source.slice(mark.index! + mark[0].length, marks[index + 1]?.index ?? source.length).trim();
    if (index > 0) {
      const at = content.match(/^At (\d{2}):(\d{2})(\.\d{1,3})?,?\s*/i);
      if (!at) throw Error(`Add the start time for Shot ${index + 1}, for example At 00:03.000.`);
      const after = content.slice(at[0].length);
      const transition = /^(?:the camera cuts to|the shot transitions with a (?:cross-dissolve|fade|wipe) to) /i.test(after) ? "" : "the camera cuts to the next shot. ";
      content = `At ${at[1]}:${at[2]}${(at[3] || ".").padEnd(4, "0")}, ${transition}${after}`;
    }
    return { heading: `[Shot ${index + 1}]`, content };
  });
}

function scriptedLines(text: string, cast: H3CastBinding[]) {
  const label = cast.flatMap(member => [member.name, ...(member.aliases ?? [])]).map(namePattern).join("|");
  const line = new RegExp(`^([ \\t]*(?:\\d+(?:\\.\\d+)?\\s*s?\\s*(?:–|—|-|to)\\s*\\d+(?:\\.\\d+)?\\s*s?\\s+)?@?(?:${label})(?:[ \\t]*\\((?:off[ -]screen|voice[ -]?over)\\))?[ \\t]*:[ \\t]*)(.*)$`, "gimu");
  return text.replace(line, (original, lead: string, words: string) => {
    if (!words || /^["“]|^<d>/i.test(words)) return original;
    const withLanguage = words.match(/^\[([^\]\n]+)\][ \t]+(.+)$/);
    return `${lead}<d>[${withLanguage?.[1] || "English"}] ${withLanguage?.[2] || words}</d>`;
  });
}

function unresolvedSpeech(text: string, cast: H3CastBinding[]) {
  for (const tail of text.split(QUOTED_SPEECH_BOUNDARY)) {
    if (VISIBLE_QUOTE.test(tail) || /\b(?:never|nobody|no one|does not|doesn't|without)\s+(?:say|speak|whisper|ask|reply)\b/i.test(tail)) continue;
    const verb = [...tail.matchAll(SPEECH)].at(-1);
    if (verb && castByName(tail.slice(0, verb.index), cast).length) return true;
  }
  return false;
}

function approvedIdentityText(value: string | undefined) {
  return (value || "").replace(/<[^>]+>|\(S\d+\)|\[Shot \d+\]/gi, "").replace(/\s+/g, " ").trim();
}

function preserveReferenceSections(sections: Record<string, string>, rewrite: (text: string, visualAlias?: boolean) => string) {
  const authored = (key: string) => (sections[key] || "").split("\n").map(line => line.trim()).filter(Boolean);
  const definitions = authored("subject_definitions").filter(line => line !== GUIDE);
  const retention = authored("retention_analysis");
  if (/(?:^|[ +])audio reuse(?:[ +\]]|$)/i.test(sections.summary?.match(/^\[[^\]]+\]/)?.[0]?.slice(1) || "")
    || retention.some(line => /^<Audio \d+>/.test(line) && /\b(?:fully_copy|partially_copy)\b/.test(line))) {
    throw Error("The supplied audio is configured as a cast voice reference. Remove the instruction to replay the recording or use the existing audio-reuse workflow.");
  }
  const render = (line: string) => rewrite(line, /^<Subject \d+>/.test(line)).replace(/\s*\(S\d+\)/g, "");
  return { definitions: definitions.map(render), retention: retention.map(render) };
}

export function compileH3CharacterVoices(input: {
  prompt: string; cast: H3CastBinding[]; references: H3SmartReferenceMapEntry[];
  mode: ProductionV2H3Mode; durationSeconds: H3ProductionDuration; firstImage: boolean; lastImage: boolean;
  style?: { label: string; description: string };
  dialogueOnly?: boolean;
}) {
  const { prompt, mode, durationSeconds, references, firstImage, lastImage, style } = input;
  const cast = input.cast.map(binding => ({ ...binding }));
  const refMode = mode === "h3-reference-to-video";
  validateCastReferences(cast, references, refMode);
  const source = prompt.trim().replace(/^```(?:text|markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i, "$1");
  const sections = fields(source);
  if (sections.detailed_description && sections.integrated_multimodal_description) throw Error("Choose one scene timeline in your prompt.");
  if (Object.entries(sections).some(([key, value]) => key !== "leadingScene" && !["integrated_multimodal_description", "detailed_description"].includes(key) && /<\/?d\b/i.test(value))) throw Error("Put spoken lines only in the shot timeline so each line plays once.");
  const { known, tagMap } = importedIdentifiers(sections.subject_definitions || "", cast);
  const scene = sections.detailed_description || sections.integrated_multimodal_description || sections.leadingScene || (Object.keys(sections).length ? "" : source);
  if (!scene.trim()) throw Error("Enter the scene's actions and any dialogue.");
  const marks = [...scene.matchAll(/^\[Shot \d+\]/gim)];
  const authoredOpening = marks.length ? scene.slice(0, marks[0].index).trim() : "";
  if (/<\/?d\b/i.test(authoredOpening) || unresolvedSpeech(authoredOpening, cast)) throw Error("Put spoken lines inside the shot where the character speaks.");
  const shots = readShots(scene);
  const events: H3VoiceEvent[] = [];
  const authorizedTags = new Set([...references.map(ref => ref.tag), ...cast.map(member => member.subject)]);
  const rewrite = (text: string, visualAlias = false) => text.replace(LABEL, (tag, kind) => {
    if (refMode) {
      const mapped = tagMap.get(tag);
      if (mapped && authorizedTags.has(mapped)) return mapped;
      throw Error(`The prompt uses ${tag} without a named reference assignment. Identify its character or reference role.`);
    }
    if (kind === "Subject" && known.has(tag)) return known.get(tag)!.name;
    if (kind === "Picture" && mode === "h3-image-to-video" && (tag === "<Picture 1>" || lastImage && tag === "<Picture 2>")) return tag;
    throw Error(`${tag} needs Reference-to-Video. Choose that mode or remove this external reference.`);
  }).replace(AUTHOR_ALIAS, (label, alias: string) => {
    const key = aliasKey(alias);
    const voice = key.endsWith("_voice");
    const member = cast.find(binding => [binding.name, ...(binding.aliases ?? [])].some(name => aliasKey(name) === (voice ? key.slice(0, -6) : key)));
    if (!member) throw Error(`${label} is not assigned to a selected Character Card.`);
    if (voice) {
      if (!refMode || !member.audio.length) throw Error(`${label} needs an attached saved voice in Reference-to-Video.`);
      return member.audio.join(", ");
    }
    return refMode ? visualAlias ? member.visual.join(", ") : member.subject : member.name;
  });
  const visualStyle = style ? `${style.label}. ${style.description.replace(/\s+/g, " ")}` : "";
  let continuation: H3VoiceEvent | undefined;
  const speakers: string[] = [];
  let lastTimedStart = -1;
  const directed = shots.map((shot, index) => {
    const content = scriptedLines(shot.content, cast);
    let cursor = 0;
    let body = "";
    for (const token of content.matchAll(DIALOGUE)) {
      const from = token.index!;
      const before = content.slice(cursor, from);
      const tagged = token[1] !== undefined;
      const words = token[2] ?? token[3] ?? token[4];
      const local = before.split(QUOTED_SPEECH_BOUNDARY).at(-1)!;
      if (unresolvedSpeech(before.slice(0, before.length - local.length), cast)) throw Error("A speech cue is missing exact dialogue. Use quotation marks or a separate Character: line entry for the spoken words.");
      const member = !tagged && VISIBLE_QUOTE.test(local) ? undefined : speakerBefore(before, cast, known, tagged);
      if (!member) {
        if (tagged || !VISIBLE_QUOTE.test(local) && [...local.matchAll(SPEECH)].length) throw Error(`Who says “${words.replace(/<[^>]+>/g, "").slice(0, 100)}”? Add the saved character's name before the line.`);
        body += rewrite(before) + token[0];
        cursor = from + token[0].length;
        continue;
      }
      if (refMode && !input.dialogueOnly && !member.audio.length) throw Error(`Choose a saved voice for ${member.name} before generating their dialogue.`);
      if (refMode && /<Audio \d+>|@[^\s]+[_-]voice/i.test(local)) {
        const explicit = [...rewrite(local).matchAll(/<Audio \d+>/g)].map(match => match[0]);
        if (explicit.some(tag => !member.audio.includes(tag))) throw Error(`${member.name}'s spoken line refers to another character's voice. Correct the audio assignment.`);
      }
      if (!speakers.includes(member.characterId)) speakers.push(member.characterId);
      const speakerId = `S${speakers.indexOf(member.characterId) + 1}`;
      member.speakerId = speakerId;
      const language = token[1] || "English";
      const time = local.match(TIME_WINDOW);
      const continuationStart = words.startsWith("<scenetrans>");
      const continuationEnd = words.endsWith("<scenetrans>");
      const spoken = words.replace(/<scenetrans>|<cutoff>/g, "");
      if (continuationStart !== !!continuation || continuation && (continuation.characterId !== member.characterId || continuation.language !== language || continuation.shot >= index + 1)) throw Error("A line crossing a cut must keep the same speaker, language and continuation markers.");
      const startSeconds = time ? Number(time[1]) : undefined;
      const endSeconds = time ? Number(time[2]) : undefined;
      if (startSeconds !== undefined && (startSeconds < lastTimedStart || startSeconds >= endSeconds! || endSeconds! > durationSeconds)) throw Error(`The dialogue for ${member.name} must follow playback order and fit inside the selected ${durationSeconds} seconds.`);
      if (startSeconds !== undefined) lastTimedStart = startSeconds;
      const event = continuation || { lineId: `line-${events.length + 1}`, characterId: member.characterId, speakerId, wordText: "", language, shot: index + 1,
        ...(time ? { startSeconds, endSeconds } : {}), ...(OFF_SCREEN.test(local) ? { offScreen: true } : {}) };
      event.wordText += spoken;
      if (endSeconds !== undefined) event.endSeconds = endSeconds;
      continuation = continuationEnd ? event : undefined;
      if (!continuationEnd) events.push(event);
      const direction = rewrite(before).replace(/\(S\d+\)/g, "").trimEnd();
      const character = refMode ? member.subject : member.name;
      const voices = refMode && member.audio.length ? ` using ${member.audio.join(", ")} for vocal timbre` : "";
      body += `${direction} ${character} (${speakerId})${voices}: <d>[${language}] ${words}</d>`;
      cursor = from + token[0].length;
    }
    const remaining = content.slice(cursor);
    if (unresolvedSpeech(remaining, cast)) throw Error("A speech cue is missing exact dialogue. Use quotation marks or a separate Character: line entry for the spoken words.");
    body += rewrite(remaining);
    if (index === 0 && mode === "h3-image-to-video") body = `Begin from the supplied opening image. ${body}`;
    if (index === 0 && !refMode && visualStyle) body = `${visualStyle} ${body}`;
    if (/<\/?d\b/i.test(body.replace(/<d>\[[^\]\n]+\]\s[\s\S]*?<\/d>/gi, ""))) throw Error("Use the dialogue format <d>[English] exact words</d> and name the saved speaker.");
    const timeline = body.trim().replace(/\s*\n\s*/g, " ");
    return `${shot.heading} ${timeline}`;
  });
  if (continuation) throw Error("Complete the dialogue continuation after the cut.");

  const ambience = `overall_soundscape: ${rewrite(sections.overall_soundscape || "Use only the ambience and effects described in the scene.").replace(/\s*\n\s*/g, " ")}`;
  const music = `non_diegetic_music: ${rewrite(sections.non_diegetic_music || "N/A").replace(/\s*\n\s*/g, " ")}`;
  let compiled: string;
  const sharedIdentityPrompt = cast.flatMap(character => [
    `${refMode ? `${character.subject} is ` : ""}${character.name}.${refMode ? ` Use ${character.visual.join(", ")} for their visual identity.` : ""}${character.identity ? ` ${approvedIdentityText(character.identity)}` : ""}`,
    ...character.audio.map(tag => `${tag} is the saved voice-timbre reference for ${character.subject}; use it only for this character's voice.`),
  ]).join("\n");
  if (refMode) {
    const preserved = preserveReferenceSections(sections, rewrite);
    const definitions = cast.flatMap(character => [
      `${character.subject} is ${character.name}. Use ${character.visual.join(", ")} for their visual identity.${character.identity ? ` ${approvedIdentityText(character.identity)}` : ""}`,
      ...character.audio.map(tag => `${tag} is the voice-timbre reference for ${character.subject}${character.speakerId ? ` (${character.speakerId})` : ""}. ${preserved.definitions.filter(line => line.startsWith(tag)).map(line => line.slice(tag.length).replace(/^\s*[:=]?\s*/, "")).join(" ")}`.trim()),
    ]);
    const authoredDefinitions = preserved.definitions.filter(line => !line.startsWith("<Audio "));
    const retention = cast.flatMap(character => [
      ...(!preserved.retention.some(line => line.startsWith(character.subject)) ? [`${character.subject}: fully_preserved. Keep the selected visual identity.`] : []),
      ...character.audio.filter(tag => !preserved.retention.some(line => line.startsWith(tag))).map(tag => `${tag}: reference. Follow the saved voice while speaking the new dialogue.`),
    ]);
    const summary = `[reference generation${firstImage ? " + keyframe completion" : ""}${references.some(ref => ref.kind === "audio") ? " + audio reference" : ""}] ${sections.summary ? rewrite(sections.summary.replace(/^\[[^\]]+\]\s*/, "")).replace(/\s*\n\s*/g, " ") : "Generate the requested scene with the selected cast."}`;
    const opening = [visualStyle, authoredOpening ? rewrite(authoredOpening).replace(/\s*\n\s*/g, " ") : ""].filter(Boolean).join(" ");
    compiled = [`subject_definitions:\n${[firstImage ? GUIDE : "", ...definitions, ...authoredDefinitions].filter(Boolean).join("\n")}`, `summary: ${summary}`,
      `retention_analysis:\n${[...retention, ...preserved.retention].join("\n")}`, `detailed_description:\n${opening ? opening + "\n" : ""}${directed.join("\n")}`, ambience, music].join("\n\n");
  } else {
    const alignment = mode !== "h3-image-to-video" ? "" : lastImage
      ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${shots.length}) aligns with the ${durationSeconds.toFixed(2)}-second mark of the target video.`
      : "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
    const directionOpening = [authoredOpening ? rewrite(authoredOpening).replace(/\s*\n\s*/g, " ") : "", sharedIdentityPrompt.replace(/\n/g, " ")].filter(Boolean).join(" ");
    if (directionOpening) directed[0] = directed[0].replace("[Shot 1] ", `[Shot 1] ${directionOpening} `);
    compiled = [alignment, `integrated_multimodal_description: ${directed.join("\n")}`, ambience, music].filter(Boolean).join("\n\n");
  }
  if (compiled.length > 4000) throw Error("The compiled clip exceeds H3's 4,000-character prompt limit after adding the cast. Shorten optional scene details.");
  validateH3DirectedPrompt(compiled, { mode, durationSeconds, firstImage, lastImage,
    pictures: references.filter(ref => ref.kind === "image").length,
    videos: references.filter(ref => ref.kind === "video").length,
    audios: references.filter(ref => ref.kind === "audio").length,
    allowReferenceStyleOpening: true,
  });
  return { prompt: compiled, bindings: cast, events, sharedIdentityPrompt };
}
