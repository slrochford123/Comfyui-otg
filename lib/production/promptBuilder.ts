import {
  effectiveH3ShotFlow,
  h3StyleProfile,
  productionV2TargetShotCount,
} from "@/lib/production/promptOptions";
import {
  buildProductionV2LockedReferenceContext,
  resolveProductionV2H3ReferencePlan,
} from "@/lib/production/referenceResolver";
import {
  composeProductionV2FinalPrompt,
  productionV2H3VoiceBindings,
  type ProductionV2DialogueTurn,
  type ProductionV2Duration,
  type ProductionV2GenerationMode,
  type ProductionV2Model,
  type ProductionV2ReferencePlan,
  type ProductionV2Scene,
} from "@/lib/production/v2";

// Prompt controls and provider policy are adapted from Hailuo H3 Prompt Builder
// v2.8.0-beta.1 (c) 2026 Bob Doyle Media, MIT.
export const PRODUCTION_PROMPT_BUILDER_VERSION = "production-prompt-builder-v2";
export const H3_I2V_PROMPT_BUILDER_ID = `${PRODUCTION_PROMPT_BUILDER_VERSION}:h3-i2v`;
export const H3_REF2V_PROMPT_BUILDER_ID = `${PRODUCTION_PROMPT_BUILDER_VERSION}:h3-ref2v`;
export const LTX_INGREDIENTS_PROMPT_BUILDER_ID = `${PRODUCTION_PROMPT_BUILDER_VERSION}:ltx-ingredients`;

export type BuildProductionPromptInput = {
  model: ProductionV2Model;
  mode: ProductionV2GenerationMode;
  scene: ProductionV2Scene;
  references?: ProductionV2ReferencePlan;
  dialogue?: ProductionV2DialogueTurn[];
  camera?: string;
  duration?: ProductionV2Duration;
  scenePrompt?: string;
};

export type BuiltProductionPrompt = {
  prompt: string;
  lockedReferenceContext: string;
  scenePrompt: string;
  builderId: string;
  adapter: "h3-i2v" | "h3-ref2v" | "ltx-ingredients";
};

export type ProductionV2ScenePromptValidation = {
  ok: boolean;
  errors: string[];
  shotCount: number;
  timestamps: number[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function oneLine(value: unknown) {
  return clean(value).replace(/\s+/g, " ");
}

function finish(value: unknown) {
  const text = oneLine(value);
  if (!text) return "";
  return /[.!?"']$/.test(text) ? text : `${text}.`;
}

function sanitizeNamedStyleReferences(value: string) {
  return value
    .replace(/(?:in\s+)?(?:the\s+)?(?:style|look|aesthetic)\s+of\s+(?:David\s+)?Cronenberg/gi, "with clinical, tactile biomechanical body horror")
    .replace(/David\s+Cronenberg(?:'s)?/gi, "tactile biomechanical")
    .replace(/(?:in\s+)?(?:the\s+)?(?:style|look|aesthetic)\s+of\s+Tim\s+Burton/gi, "with playfully macabre gothic storybook traits")
    .replace(/Tim\s+Burton(?:'s)?/gi, "playfully macabre gothic");
}

function assertAdapterInput(input: BuildProductionPromptInput, expectedModel: ProductionV2Model, expectedMode: ProductionV2GenerationMode) {
  if (input.model !== expectedModel || input.scene.model !== expectedModel) throw new Error(`Prompt adapter requires ${expectedModel}.`);
  if (input.mode !== expectedMode || input.scene.generationMode !== expectedMode) throw new Error(`Prompt adapter requires ${expectedMode}.`);
  if (!input.scene.promptStateByMode[expectedMode].userPrompt.trim()) throw new Error("Write what should happen before building the Scene Prompt.");
}

function formatTimestamp(seconds: number) {
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = milliseconds - minutes * 60_000;
  const wholeSeconds = Math.floor(remainder / 1000);
  const millis = remainder - wholeSeconds * 1000;
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function productionV2ShotTimeline(scene: ProductionV2Scene) {
  const prompt = scene.promptStateByMode[scene.generationMode].userPrompt;
  const count = productionV2TargetShotCount(scene.durationSeconds, scene.promptOptions.shotFlow, scene.promptOptions.visualStyle, prompt);
  return Array.from({ length: count }, (_, index) => ({
    shot: index + 1,
    timestamp: index === 0 ? null : formatTimestamp(scene.durationSeconds * index / count),
  }));
}

function stableSubjects(scene: ProductionV2Scene) {
  return scene.referencePlan.modelFacingReferences.map((reference) => ({
    subject: `<Subject ${reference.subjectSlot}>`,
    name: reference.name,
    kind: reference.sourceKind,
  }));
}

function speakerBrief(scene: ProductionV2Scene) {
  return productionV2H3VoiceBindings(scene).map((binding) => ({
    characterId: binding.characterId,
    subject: `<Subject ${binding.subjectSlot}>`,
    speakerId: `S${binding.speakerId}`,
    audio: `<Audio ${binding.audioSlot}>`,
    name: binding.snapshotName,
  }));
}

function orderedDialogueBrief(scene: ProductionV2Scene) {
  const speakers = new Map(speakerBrief(scene).map((speaker) => [speaker.characterId, speaker]));
  return scene.dialogueTurns.flatMap((turn, index) => {
    const speaker = speakers.get(turn.speakerCharacterId);
    const text = oneLine(turn.text);
    return speaker && text ? [{ ...speaker, turn: index + 1, text }] : [];
  });
}

function cleanGeneratedPrompt(value: string) {
  return clean(value)
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^\s*(?:Here(?:'s| is)|Final Scene Prompt:)\s*/i, "")
    .trim()
    .slice(0, 7000);
}

const PRODUCTION_V2_SCENE_PROMPT_SECTIONS = [
  { heading: "SUMMARY", machineLabel: "summary:", machinePattern: String.raw`\bsummary\s*:` },
  { heading: "RETENTION ANALYSIS", machineLabel: "retention_analysis:", machinePattern: String.raw`\bretention[\\_\s]+analysis\s*:` },
  { heading: "DETAILED DESCRIPTION", machineLabel: "detailed_description:", machinePattern: String.raw`\bdetailed[\\_\s]+description\s*:` },
  { heading: "OVERALL SOUNDSCAPE", machineLabel: "overall_soundscape:", machinePattern: String.raw`\boverall[\\_\s]+soundscape\s*:` },
  { heading: "NON-DIEGETIC MUSIC", machineLabel: "non_diegetic_music:", machinePattern: String.raw`\bnon[\\_\s-]+diegetic[\\_\s]+music\s*:` },
] as const;

type ScenePromptSection = (typeof PRODUCTION_V2_SCENE_PROMPT_SECTIONS)[number];
type ScenePromptSectionMarker = { start: number; end: number; section: ScenePromptSection };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstPatternMatch(value: string, source: string, cursor: number, flags: string) {
  const pattern = new RegExp(source, flags);
  pattern.lastIndex = cursor;
  return pattern.exec(value);
}

function findScenePromptSectionMarker(value: string, section: ScenePromptSection, cursor: number): ScenePromptSectionMarker | null {
  const machineMatch = firstPatternMatch(value, section.machinePattern, cursor, "gi");
  const headingMatch = firstPatternMatch(value, String.raw`(?:^|\n)[\t ]*${escapeRegExp(section.heading)}[\t ]*(?=\n|$)`, cursor, "g");
  const match = [machineMatch, headingMatch]
    .filter((candidate): candidate is RegExpExecArray => Boolean(candidate))
    .sort((left, right) => left.index - right.index)[0];
  return match ? { start: match.index, end: match.index + match[0].length, section } : null;
}

function orderedScenePromptSectionMarkers(value: string) {
  const markers: ScenePromptSectionMarker[] = [];
  let cursor = 0;
  for (const section of PRODUCTION_V2_SCENE_PROMPT_SECTIONS) {
    const marker = findScenePromptSectionMarker(value, section, cursor);
    if (!marker) return null;
    markers.push(marker);
    cursor = marker.end;
  }
  return markers;
}

function formatScenePromptShots(value: string) {
  const matches = [...value.matchAll(/\[Shot\s+(\d+)\](?:\s+At\s+(\d+:\d+(?:\.\d+)?))?/gi)];
  if (!matches.length) return value.trim();
  const blocks: string[] = [];
  const preamble = value.slice(0, matches[0].index).trim();
  if (preamble) blocks.push(preamble);
  matches.forEach((match, index) => {
    const nextIndex = matches[index + 1]?.index ?? value.length;
    const body = value.slice((match.index || 0) + match[0].length, nextIndex).trim();
    const redundantOpeningTimestamp = Number(match[1]) === 1 && match[2] && parseTimestamp(match[2]) === 0;
    const heading = `[Shot ${match[1]}]${match[2] && !redundantOpeningTimestamp ? ` At ${match[2]}` : ""}`;
    blocks.push(body ? `${heading}\n${body}` : heading);
  });
  return blocks.join("\n\n");
}

export function formatProductionV2ScenePrompt(value: string) {
  const prompt = cleanGeneratedPrompt(value);
  const markers = orderedScenePromptSectionMarkers(prompt);
  if (!markers) return prompt;
  const prefix = prompt.slice(0, markers[0].start).trim();
  return markers.map((marker, index) => {
    const nextStart = markers[index + 1]?.start ?? prompt.length;
    let body = prompt.slice(marker.end, nextStart).trim();
    if (index === 0 && prefix) body = `${prefix}\n\n${body}`.trim();
    if (marker.section.heading === "DETAILED DESCRIPTION") body = formatScenePromptShots(body);
    return body ? `${marker.section.heading}\n\n${body}` : marker.section.heading;
  }).join("\n\n\n");
}

export function buildProductionV2SceneEnhancementInstruction(scene: ProductionV2Scene) {
  if (scene.model !== "minimax-h3") throw new Error("The H3 Scene Prompt enhancer requires MiniMax H3.");
  const userPrompt = sanitizeNamedStyleReferences(scene.promptStateByMode[scene.generationMode].userPrompt);
  const timeline = productionV2ShotTimeline(scene);
  const effectiveFlow = effectiveH3ShotFlow(scene.promptOptions.shotFlow, scene.promptOptions.visualStyle, userPrompt);
  const subjects = scene.generationMode === "h3-reference-to-video" ? stableSubjects(scene) : [];
  const speakers = scene.generationMode === "h3-reference-to-video" ? speakerBrief(scene) : [];
  const dialogueTurns = scene.generationMode === "h3-reference-to-video" ? orderedDialogueBrief(scene) : [];
  const timelineTemplate = timeline.map((item) => item.shot === 1 ? "[Shot 1]" : `[Shot ${item.shot}] At ${item.timestamp}`).join("\n");
  return `Write ONLY the editable Scene Prompt for one MiniMax H3 video. Do not write markdown fences or commentary. Do not write subject_definitions and do not define or renumber <Picture N>, <Video N>, or <Audio N>; the application supplies that locked block separately. Do not write a DIALOGUE SEQUENCE block or dialogue timestamps; the application injects that machine-critical block deterministically.

Use this exact section order:
summary:
retention_analysis:
detailed_description:
${timelineTemplate}
overall_soundscape:
non_diegetic_music:

AUTHORITATIVE CONTENT POLICY
- Preserve everything the user specified.
- Use facts established by the available Subjects and speaker assignments.
- When neither source establishes a fact, add only neutral cinematic connective detail needed to make the requested action coherent.
- You may add blocking, camera direction, pacing, lighting interaction, sound texture, physical motion, and cause-and-effect transitions.
- Do not invent an age, profession, costume, prop, vehicle, weapon, new character, or new plot event unless the user request or available Subject data establishes it.
- Refer to visible selected entities only by their stable <Subject N> labels. Never rename or remap a Subject.
- Preserve every supplied dialogue turn in exact array order and with exact wording. Minor punctuation normalization is allowed only when it does not change the words.
- Do not drop repeated appearances by the same speaker, merge turns, reassign a line, or invent additional spoken dialogue.
- A repeated Character must reuse the same <Subject N>, (S N), and <Audio N> identity on every turn. Dialogue turn number never determines Audio number.

TIMING CONTRACT
- The clip is exactly ${scene.durationSeconds} seconds.
- Use exactly ${timeline.length} ${timeline.length === 1 ? "shot" : "shots"} for the selected ${effectiveFlow} flow.
- [Shot 1] begins at 00:00.000 and must not include an At timestamp.
- Reproduce every later shot heading exactly as shown above.
- No timestamp, action, sound, or described event may extend beyond ${formatTimestamp(scene.durationSeconds)}.
- Do not write a DIALOGUE SEQUENCE block or dialogue timestamps; OTG inserts them deterministically after cinematic generation.
- Use supplied dialogue turns only to stage reactions, pacing, blocking, and camera coverage. Do not quote, paraphrase, reorder, merge, or invent spoken dialogue in the cinematic sections.

USER REQUEST
${userPrompt}

SELECTED LOOK
Visual style: ${scene.promptOptions.visualStyle}
Mandatory visual art direction: ${h3StyleProfile(scene.promptOptions.visualStyle)}
Camera feel: ${scene.promptOptions.cameraFeel}
Shot flow: ${effectiveFlow}
Format: ${scene.durationSeconds} seconds, ${scene.promptOptions.aspectRatio}, ${scene.promptOptions.quality}
Sound: ${scene.promptOptions.soundEnabled ? scene.promptOptions.soundDirection || "Native synchronized dialogue, ambience, effects, and environmental reactions." : "Complete silence."}
Avoid: ${scene.promptOptions.thingsToAvoid || "Continuity errors, duplicated anatomy, identity drift, unreadable action, and invented story facts."}

AVAILABLE SUBJECTS
${subjects.length ? subjects.map((item) => `${item.subject}: ${item.name} (${item.kind})`).join("\n") : "No reusable Subject labels are available; preserve the single starting image and user request."}

SPEAKER ASSIGNMENTS
${speakers.length ? speakers.map((item) => `${item.name}: ${item.subject} (${item.speakerId}) -> ${item.audio}`).join("\n") : "No Character is assigned to speak."}

ORDERED DIALOGUE TURNS
${dialogueTurns.length ? dialogueTurns.map((item) => `${item.turn}. ${item.name}: ${item.subject} (${item.speakerId}), using ${item.audio}: \"${item.text}\"`).join("\n") : "No spoken dialogue is supplied. Do not invent dialogue."}

${dialogueTurns.length ? `APPLICATION-OWNED DIALOGUE CONTRACT
- Do not output a DIALOGUE SEQUENCE block.
- OTG will inject exactly ${dialogueTurns.length} timed dialogue entries from the ordered turns above.
- OTG owns every ${"<Subject N>"}, (S N), ${"<Audio N>"}, timestamp, speaker mapping, and quoted dialogue line.
- Use the ordered turns only as context for cinematic staging and reactions.` : "Do not add spoken dialogue or a DIALOGUE SEQUENCE block."}

Return the complete Scene Prompt now. /no_think`;
}

function parseTimestamp(value: string) {
  const match = value.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

export function validateProductionV2ScenePrompt(scene: ProductionV2Scene, value: string): ProductionV2ScenePromptValidation {
  const source = cleanGeneratedPrompt(value);
  const prompt = formatProductionV2ScenePrompt(source);
  const errors: string[] = [];
  const expected = productionV2ShotTimeline(scene);
  const shots = [...prompt.matchAll(/\[Shot\s+(\d+)\](?:\s+At\s+(\d+:\d+(?:\.\d+)?))?/gi)];
  const timestamps = shots.flatMap((match) => match[2] ? [parseTimestamp(match[2])] : []);
  if (!prompt) errors.push("The Scene Prompt is empty.");
  for (const section of PRODUCTION_V2_SCENE_PROMPT_SECTIONS) {
    if (!findScenePromptSectionMarker(source, section, 0)) errors.push(`Missing required section ${section.machineLabel}`);
  }
  if (/subject_definitions\s*:|<Picture\s+\d+>|<Video\s+\d+>/i.test(prompt)) {
    errors.push("The editable Scene Prompt may not define locked Picture, Video, or subject_definitions mappings.");
  }
  if (/<Audio\s+\d+>\s*(?:is|=)/i.test(prompt)) {
    errors.push("The editable Scene Prompt may reference but may not define locked Audio mappings.");
  }
  if (shots.length !== expected.length) errors.push(`Expected exactly ${expected.length} shot headings but received ${shots.length}.`);
  shots.forEach((match, index) => {
    const shotNumber = Number(match[1]);
    if (shotNumber !== index + 1) errors.push("Shot headings must be sequential and start at [Shot 1].");
    if (index === 0 && match[2]) errors.push("[Shot 1] must begin the clip without an At timestamp.");
    if (index > 0 && !match[2]) errors.push(`[Shot ${index + 1}] requires an At timestamp.`);
  });
  let previous = 0;
  timestamps.forEach((timestamp) => {
    if (!Number.isFinite(timestamp)) errors.push("A shot timestamp is invalid.");
    else if (timestamp <= previous) errors.push("Shot timestamps must increase strictly.");
    else if (timestamp >= scene.durationSeconds) errors.push(`A shot timestamp reaches or exceeds the ${scene.durationSeconds}-second duration.`);
    previous = timestamp;
  });
  validateDialogueSequence(scene, prompt).forEach((error) => errors.push(error));
  if (prompt.length > 7000) errors.push("The Scene Prompt exceeds 7,000 characters.");
  return { ok: errors.length === 0, errors: [...new Set(errors)], shotCount: shots.length, timestamps };
}

function validateDialogueSequence(scene: ProductionV2Scene, prompt: string) {
  if (scene.generationMode !== "h3-reference-to-video") return [];
  const dialogueTurns = orderedDialogueBrief(scene);
  const heading = /\bDIALOGUE\s+SEQUENCE\b/i.exec(prompt);
  if (!dialogueTurns.length) return heading ? ["Do not add a DIALOGUE SEQUENCE when no spoken dialogue was supplied."] : [];
  if (!heading) return ["Missing required DIALOGUE SEQUENCE for the ordered dialogue turns."];

  const following = prompt.slice(heading.index + heading[0].length);
  const nextSection = /\n\s*OVERALL\s+SOUNDSCAPE\b/i.exec(following);
  const block = following.slice(0, nextSection?.index ?? following.length);
  const quotedLines = [...block.matchAll(/[\"“]([^\"”\n]+)[\"”]/g)].map((match) => oneLine(match[1]));
  const expectedLines = dialogueTurns.map((turn) => turn.text);
  const errors: string[] = [];
  if (quotedLines.length !== expectedLines.length || quotedLines.some((line, index) => line !== expectedLines[index])) {
    errors.push("DIALOGUE SEQUENCE must contain only the exact supplied dialogue lines in their original order.");
  }

  let cursor = 0;
  dialogueTurns.forEach((turn) => {
    const textIndex = block.indexOf(turn.text, cursor);
    if (textIndex < 0) return;
    const assignment = block.slice(cursor, textIndex);
    if (!assignment.includes(turn.subject) || !assignment.includes(`(${turn.speakerId})`) || !assignment.includes(turn.audio)) {
      errors.push(`Dialogue turn ${turn.turn} must retain ${turn.subject} (${turn.speakerId}) and ${turn.audio}.`);
    }
    cursor = textIndex + turn.text.length;
  });

  const intervals = [...block.matchAll(/\[(\d+:\d+(?:\.\d+)?)-(\d+:\d+(?:\.\d+)?)\]/g)].map((match) => ({
    start: parseTimestamp(match[1]),
    end: parseTimestamp(match[2]),
  }));
  if (intervals.length !== dialogueTurns.length) {
    errors.push(`DIALOGUE SEQUENCE requires exactly ${dialogueTurns.length} timed entries.`);
  } else {
    let previousEnd = 0;
    intervals.forEach((interval) => {
      if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < previousEnd || interval.end <= interval.start || interval.end > scene.durationSeconds) {
        errors.push(`Dialogue timing must be ordered and remain within the ${scene.durationSeconds}-second duration.`);
      }
      previousEnd = interval.end;
    });
  }
  const allowedAudioSlots = new Set(dialogueTurns.map((turn) => turn.audio));
  const usedAudioSlots = [...block.matchAll(/<Audio\s+\d+>/gi)].map((match) => match[0].replace(/\s+/g, " "));
  if (usedAudioSlots.some((audio) => !allowedAudioSlots.has(audio))) errors.push("DIALOGUE SEQUENCE references an Audio slot that is not assigned to a selected speaker.");
  return [...new Set(errors)];
}

export function buildProductionV2SceneRepairInstruction(scene: ProductionV2Scene, invalidPrompt: string, errors: string[]) {
  return `${buildProductionV2SceneEnhancementInstruction(scene)}

The previous draft failed validation:
${errors.map((error) => `- ${error}`).join("\n")}

Rewrite the complete Scene Prompt and correct every failure. Preserve the user's request and all valid scene details.

INVALID DRAFT
${cleanGeneratedPrompt(invalidPrompt)}`;
}

function deterministicScenePrompt(scene: ProductionV2Scene) {
  const userPrompt = finish(sanitizeNamedStyleReferences(scene.promptStateByMode[scene.generationMode].userPrompt));
  const subjects = stableSubjects(scene).map((item) => item.subject).join(", ");
  const timeline = productionV2ShotTimeline(scene);
  const shotLines = timeline.map((item, index) => {
    const heading = item.shot === 1 ? "[Shot 1]" : `[Shot ${item.shot}] At ${item.timestamp}`;
    const camera = index === 0 ? "Establish clear geography and the requested action." : index === timeline.length - 1 ? "Move to the requested action's clearest resolution and hold the final reaction." : "Change framing only on motivated movement while preserving screen direction.";
    return `${heading}\n${subjects ? `${subjects} remain identity-stable. ` : ""}${camera} ${userPrompt}`;
  });
  const dialogueSequence = deterministicDialogueSequence(scene);
  return `summary:\n${userPrompt}\n\nretention_analysis:\nPreserve the user-specified action, selected Subject identities, scene geography, and exact dialogue without adding unsupported story facts.\n\ndetailed_description:\n${shotLines.join("\n\n")}${dialogueSequence ? `\n\n${dialogueSequence}` : ""}\n\noverall_soundscape:\n${scene.promptOptions.soundEnabled ? finish(scene.promptOptions.soundDirection || "Native synchronized ambience and effects follow their visible source") : "Complete silence."}\n\nnon_diegetic_music:\n${scene.promptOptions.soundEnabled ? "Use restrained music only when it supports the requested action without masking dialogue." : "None."}`;
}

function deterministicDialogueSequence(scene: ProductionV2Scene) {
  if (scene.generationMode !== "h3-reference-to-video") return "";
  const turns = orderedDialogueBrief(scene);
  if (!turns.length) return "";
  const weights = turns.map((turn) => Math.max(1, turn.text.match(/\S+/g)?.length || 1));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const startPadding = Math.min(0.4, scene.durationSeconds * 0.08);
  const endPadding = Math.min(0.2, scene.durationSeconds * 0.04);
  const usableDuration = Math.max(0.1, scene.durationSeconds - startPadding - endPadding);
  let cursor = startPadding;
  const entries = turns.map((turn, index) => {
    const start = cursor;
    const end = index === turns.length - 1
      ? scene.durationSeconds - endPadding
      : cursor + usableDuration * weights[index] / totalWeight;
    cursor = end;
    return `[${formatTimestamp(start)}-${formatTimestamp(end)}]\n${turn.subject} (${turn.speakerId}), using ${turn.audio}, says:\n\"${turn.text}\"`;
  });
  return `DIALOGUE SEQUENCE\n\n${entries.join("\n\n")}`;
}

export function applyProductionV2DeterministicShotTimeline(
  scene: ProductionV2Scene,
  value: string,
) {
  const prompt = formatProductionV2ScenePrompt(value);
  const timeline = productionV2ShotTimeline(scene);

  if (!timeline.length) {
    return prompt;
  }

  const detailedHeading =
    /(?:^|\n)[ \t]*DETAILED[ \t_-]+DESCRIPTION\b[^\n]*/i.exec(prompt);

  if (!detailedHeading) {
    return prompt;
  }

  const detailedBodyStart =
    detailedHeading.index + detailedHeading[0].length;

  const followingDetailedBody =
    prompt.slice(detailedBodyStart);

  const nextSection =
    /(?:^|\n)[ \t]*(?:DIALOGUE[ \t_-]+SEQUENCE|OVERALL[ \t_-]+SOUNDSCAPE|NON[ \t_-]+DIEGETIC[ \t_-]+MUSIC)\b/i.exec(
      followingDetailedBody,
    );

  const detailedBodyEnd = nextSection
    ? detailedBodyStart + nextSection.index
    : prompt.length;

  const detailedBody = prompt
    .slice(detailedBodyStart, detailedBodyEnd)
    .trim();

  const shotPattern =
    /\[Shot\s+\d+\](?:\s+At\s+\d+:\d+(?:\.\d+)?)?/gi;

  const shotMatches =
    [...detailedBody.matchAll(shotPattern)];

  let bodies: string[] = [];

  if (shotMatches.length) {
    const preamble = detailedBody
      .slice(0, shotMatches[0].index)
      .trim();

    bodies = shotMatches.map((match, index) => {
      const start =
        (match.index || 0) + match[0].length;

      const end =
        shotMatches[index + 1]?.index
        ?? detailedBody.length;

      return detailedBody
        .slice(start, end)
        .trim();
    });

    if (preamble) {
      bodies[0] = bodies[0]
        ? `${preamble}\n\n${bodies[0]}`
        : preamble;
    }
  } else if (detailedBody) {
    bodies = detailedBody
      .split(/\n\s*\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const userPrompt = finish(
    sanitizeNamedStyleReferences(
      scene.promptStateByMode[
        scene.generationMode
      ].userPrompt,
    ),
  );

  const canonicalShots = timeline.map(
    (item, index) => {
      const heading =
        item.shot === 1
          ? "[Shot 1]"
          : `[Shot ${item.shot}] At ${item.timestamp}`;

      let body = "";

      if (index === timeline.length - 1) {
        body = bodies
          .slice(index)
          .filter(Boolean)
          .join("\n\n")
          .trim();
      } else {
        body = String(bodies[index] || "")
          .trim();
      }

      if (!body) {
        const cameraDirection =
          index === 0
            ? "Establish clear geography and the requested action."
            : index === timeline.length - 1
              ? "Resolve the requested action clearly and hold the final reaction without introducing a new story event."
              : "Continue the requested action with a motivated framing change while preserving identity, geography, and screen direction.";

        body = `${cameraDirection} ${userPrompt}`.trim();
      }

      return `${heading}\n${body}`;
    },
  );

  const beforeDetailedBody = prompt
    .slice(0, detailedBodyStart)
    .trimEnd();

  const afterDetailedBody = prompt
    .slice(detailedBodyEnd)
    .trimStart();

  return afterDetailedBody
    ? `${beforeDetailedBody}\n\n${canonicalShots.join("\n\n")}\n\n\n${afterDetailedBody}`
    : `${beforeDetailedBody}\n\n${canonicalShots.join("\n\n")}`;
}

export function applyProductionV2DeterministicDialogueSequence(
  scene: ProductionV2Scene,
  value: string,
) {
  let prompt = applyProductionV2DeterministicShotTimeline(
    scene,
    value,
  );

  if (scene.generationMode !== "h3-reference-to-video") {
    return prompt;
  }

  const canonicalDialogue = deterministicDialogueSequence(scene);

  const dialogueHeading =
    /(?:^|\n)[ \t]*DIALOGUE[ \t_-]+SEQUENCE\b[^\n]*/i.exec(prompt);

  if (dialogueHeading) {
    const following = prompt.slice(dialogueHeading.index);
    const nextSection =
      /(?:^|\n)[ \t]*(?:OVERALL[ \t_-]+SOUNDSCAPE|NON[ \t_-]+DIEGETIC[ \t_-]+MUSIC)\b/i.exec(
        following,
      );

    const end = nextSection
      ? dialogueHeading.index + nextSection.index
      : prompt.length;

    const before = prompt
      .slice(0, dialogueHeading.index)
      .trimEnd();

    const after = prompt
      .slice(end)
      .trimStart();

    prompt = after
      ? `${before}\n\n${after}`
      : before;
  }

  if (!canonicalDialogue) {
    return prompt.trim();
  }

  const soundscapeHeading =
    /(?:^|\n)[ \t]*OVERALL[ \t_-]+SOUNDSCAPE\b/i.exec(prompt);

  if (soundscapeHeading) {
    const beforeSoundscape = prompt
      .slice(0, soundscapeHeading.index)
      .trimEnd();

    const soundscapeAndAfter = prompt
      .slice(soundscapeHeading.index)
      .trimStart();

    return `${beforeSoundscape}\n\n${canonicalDialogue}\n\n${soundscapeAndAfter}`;
  }

  const musicHeading =
    /(?:^|\n)[ \t]*NON[ \t_-]+DIEGETIC[ \t_-]+MUSIC\b/i.exec(prompt);

  if (musicHeading) {
    const beforeMusic = prompt
      .slice(0, musicHeading.index)
      .trimEnd();

    const musicAndAfter = prompt
      .slice(musicHeading.index)
      .trimStart();

    return `${beforeMusic}\n\n${canonicalDialogue}\n\n${musicAndAfter}`;
  }

  return `${prompt.trimEnd()}\n\n${canonicalDialogue}`.trim();
}

function validatedScenePrompt(scene: ProductionV2Scene, provided?: string) {
  const scenePrompt = applyProductionV2DeterministicDialogueSequence(
    scene,
    provided || deterministicScenePrompt(scene),
  );
  const validation = validateProductionV2ScenePrompt(scene, scenePrompt);
  if (!validation.ok) throw new Error(`Scene Prompt validation failed: ${validation.errors.join(" ")}`);
  return scenePrompt;
}

export function buildH3I2VPrompt(input: BuildProductionPromptInput): BuiltProductionPrompt {
  assertAdapterInput(input, "minimax-h3", "h3-image-to-video");
  const startingImage = input.scene.modelState.h3.imageToVideo.startingImage;
  if (!startingImage) throw new Error("Choose exactly one Starting Image for H3 Image-to-Video.");
  const lockedReferenceContext = `starting_image_definition:\n\n<Picture 1> is the single authoritative starting image, ${startingImage.name}. Preserve its subject identity, composition, proportions, palette, lighting direction, and environment. Animate from this opening frame without treating it as a multi-reference board.`;
  const scenePrompt = validatedScenePrompt(input.scene, input.scenePrompt);
  return {
    prompt: composeProductionV2FinalPrompt(lockedReferenceContext, scenePrompt),
    lockedReferenceContext,
    scenePrompt,
    builderId: H3_I2V_PROMPT_BUILDER_ID,
    adapter: "h3-i2v",
  };
}

export function buildH3Ref2VPrompt(input: BuildProductionPromptInput): BuiltProductionPrompt {
  assertAdapterInput(input, "minimax-h3", "h3-reference-to-video");
  const scene = resolveProductionV2H3ReferencePlan(input.scene);
  const lockedReferenceContext = buildProductionV2LockedReferenceContext(scene);
  const scenePrompt = validatedScenePrompt(scene, input.scenePrompt);
  return {
    prompt: composeProductionV2FinalPrompt(lockedReferenceContext, scenePrompt),
    lockedReferenceContext,
    scenePrompt,
    builderId: H3_REF2V_PROMPT_BUILDER_ID,
    adapter: "h3-ref2v",
  };
}

export function buildLtxIngredientsPrompt(input: BuildProductionPromptInput): BuiltProductionPrompt {
  assertAdapterInput(input, "ltx-2.5", "ltx-ingredients-image-to-video");
  const scene = input.scene;
  const entities = [
    ...scene.selectedCharacters.map((item) => `Character ${item.snapshotName}`),
    ...(scene.selectedBackground ? [`Background ${scene.selectedBackground.snapshotName}`] : []),
    ...scene.selectedAssets.map((item) => `Asset ${item.snapshotName}`),
  ];
  const scenePrompt = `${scene.durationSeconds}-second LTX 2.5 Ingredients Image-to-Video prompt. ${h3StyleProfile(scene.promptOptions.visualStyle)}\n\nINGREDIENTS SHEET MAP: ${entities.length ? entities.join("; ") : "No saved entities selected"}. Match only these saved entities to their corresponding sheet regions while rendering one unified scene. Never show the sheet, panel borders, labels, gutters, or a collage.\n\nUSER SCENE DESCRIPTION: ${finish(scene.promptStateByMode[scene.generationMode].userPrompt)}\n\nCAMERA AND FLOW: ${scene.promptOptions.cameraFeel}. ${effectiveH3ShotFlow(scene.promptOptions.shotFlow, scene.promptOptions.visualStyle, scene.promptStateByMode[scene.generationMode].userPrompt)}. ${scene.promptOptions.aspectRatio}, ${scene.promptOptions.quality}.\n\nAUDIO: ${scene.promptOptions.soundEnabled ? finish(scene.promptOptions.soundDirection || "Native synchronized ambience and effects") : "Complete silence."}\n\nFINAL TEMPORAL QUALITY: Maintain stable faces, clothing, proportions, object shape, background layout, motion direction, and illumination across frames. Avoid morphing, identity swaps, duplicated entities, frozen poses, collage artifacts, panel borders, text, logos, and camera jitter.${scene.promptOptions.thingsToAvoid ? ` Exclude ${finish(scene.promptOptions.thingsToAvoid)}` : ""}`;
  return {
    prompt: scenePrompt,
    lockedReferenceContext: "",
    scenePrompt,
    builderId: LTX_INGREDIENTS_PROMPT_BUILDER_ID,
    adapter: "ltx-ingredients",
  };
}

export function buildProductionPrompt(input: BuildProductionPromptInput): BuiltProductionPrompt {
  if (input.mode === "h3-image-to-video") return buildH3I2VPrompt(input);
  if (input.mode === "h3-reference-to-video") return buildH3Ref2VPrompt(input);
  if (input.mode === "ltx-ingredients-image-to-video") return buildLtxIngredientsPrompt(input);
  throw new Error(`Unsupported Production prompt mode: ${String(input.mode)}`);
}
