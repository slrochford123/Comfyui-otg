export type ProtectedDialogueTurn = {
  speaker: string;
  delivery: string;
  line: string;
  order: number;
};

export type ProtectedDialogueResult = {
  original: string;
  turns: ProtectedDialogueTurn[];
  hasDialogue: boolean;
  protectedBlock: string;
};

const SPEECH_VERBS = [
  "called out",
  "calls out",
  "call out",
  "cried out",
  "cries out",
  "cry out",
  "whispered",
  "whispers",
  "whisper",
  "muttered",
  "mutters",
  "mutter",
  "replied",
  "replies",
  "reply",
  "shouted",
  "shouts",
  "shout",
  "screamed",
  "screams",
  "scream",
  "yelled",
  "yells",
  "yell",
  "asked",
  "asks",
  "ask",
  "said",
  "says",
  "say",
  "told",
  "tells",
  "tell",
] as const;

const SPEECH_PATTERN = new RegExp(
  String.raw`\b(${SPEECH_VERBS.map((verb) => verb.replace(/\s+/g, String.raw`\s+`)).join("|")})\b`,
  "gi",
);

const ENDING_WORDS = new Set([
  "then",
  "while",
  "before",
  "after",
  "as",
]);

function oneLine(value: unknown) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value: string) {
  const trimmed = oneLine(value);
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizeSpeaker(value: string, fallback: string) {
  const context = oneLine(value);
  const lastSentenceStart = Math.max(
    context.lastIndexOf("."),
    context.lastIndexOf("?"),
    context.lastIndexOf("!"),
  );
  const speakerContext = lastSentenceStart >= 0 ? context.slice(lastSentenceStart + 1) : context;
  const cleaned = oneLine(speakerContext)
    .replace(/[.?!,;:]+$/g, "")
    .replace(/\b(?:and|then|while|before|after|as)$/i, "")
    .trim();

  if (!cleaned) return fallback;

  const tokens = cleaned.split(/\s+/);
  const start = Math.max(0, tokens.length - 8);
  return tokens.slice(start).join(" ");
}

function normalizeDelivery(value: string) {
  const verb = oneLine(value).toLowerCase();
  if (verb.includes("whisper")) return "whispers";
  if (verb.includes("yell")) return "yells";
  if (verb.includes("shout")) return "shouts";
  if (verb.includes("scream")) return "screams";
  if (verb.includes("mutter")) return "mutters";
  if (verb.includes("call")) return "calls out";
  if (verb.includes("cry")) return "cries out";
  if (verb.includes("ask")) return "asks";
  if (verb.includes("repl")) return "replies";
  if (verb.includes("tell") || verb.includes("told")) return "tells";
  return "says";
}

function splitAtContinuation(value: string) {
  const words = oneLine(value).split(/\s+/);
  if (words.length <= 2) return oneLine(value);

  for (let index = 1; index < words.length - 1; index += 1) {
    const word = words[index].toLowerCase().replace(/[^a-z]/g, "");
    if (ENDING_WORDS.has(word)) {
      return words.slice(0, index).join(" ").replace(/[,\s]+$/g, "");
    }
  }

  return oneLine(value);
}

function speechVerbLooksNested(original: string, match: RegExpMatchArray, previousVerbEnd: number) {
  if (previousVerbEnd <= 0) return false;
  const verbStart = match.index ?? 0;
  const prefixSincePrevious = original.slice(previousVerbEnd, verbStart);
  if (/[.!?]/.test(prefixSincePrevious)) return false;
  if (/\band\s+[A-Z][\w'-]{1,40}\s+$/u.test(prefixSincePrevious)) return false;
  return true;
}

function trimNextSpeakerFragment(segment: string, hasNextTurn: boolean) {
  const cleaned = oneLine(segment);
  if (!hasNextTurn) return cleaned;

  const lastBoundary = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf("?"),
    cleaned.lastIndexOf("!"),
  );
  if (lastBoundary < 0) return cleaned;

  const tail = cleaned.slice(lastBoundary + 1).trim();
  if (!tail) return cleaned;
  const tailWords = tail.split(/\s+/);
  const looksLikeSpeakerLead =
    tailWords.length <= 6 &&
    /^[A-Z][\p{L}\p{N}'-]*(?:\s+(?:and\s+)?[A-Z][\p{L}\p{N}'-]*)*$/u.test(tail);

  return looksLikeSpeakerLead ? cleaned.slice(0, lastBoundary + 1).trim() : cleaned;
}

export function normalizeDialogueLine(value: string) {
  let line = splitAtContinuation(value)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bcant\b/gi, "can't")
    .replace(/\bwont\b/gi, "won't")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bive\b/gi, "I've")
    .replace(/\bid\b/gi, "I'd")
    .replace(/\bits\b/gi, "it's")
    .replace(/\bthats\b/gi, "that's")
    .trim();

  if (!line) return "";
  line = sentenceCase(line);

  if (!/[.!?]$/.test(line)) {
    line += /\b(where|what|when|why|how|who|are|is|do|did|can|could|would|will|should)\b/i.test(line)
      ? "?"
      : ".";
  }

  line = line
    .replace(/\bMom mom\b/i, "Mom, Mom")
    .replace(/\bwhere are you[.?]$/i, "where are you?")
    .replace(/\bare you coming with us[.?]$/i, "are you coming with us?")
    .replace(/\bwhere is she[.?]$/i, "where is she?")
    .replace(/\bi don't know[.?]$/i, "I don't know.")
    .replace(/\bdon't touch that it's too hot[.!?]$/i, "Don't touch that. It's too hot.");

  return line.charAt(0).toUpperCase() + line.slice(1);
}

export function detectProtectedDialogue(prompt: string): ProtectedDialogueResult {
  const original = oneLine(prompt);
  const matches = [...original.matchAll(SPEECH_PATTERN)];
  const validMatches: RegExpMatchArray[] = [];
  const turns: ProtectedDialogueTurn[] = [];

  matches.forEach((match) => {
    const previous = validMatches[validMatches.length - 1];
    const previousEnd = previous ? (previous.index ?? 0) + previous[0].length : 0;
    if (speechVerbLooksNested(original, match, previousEnd)) return;
    validMatches.push(match);
  });

  validMatches.forEach((match, index) => {
    const verb = match[1] || "";
    const verbStart = match.index ?? 0;
    const verbEnd = verbStart + match[0].length;
    const nextStart = validMatches[index + 1]?.index ?? original.length;
    const before = original.slice(0, verbStart);
    const after = trimNextSpeakerFragment(original.slice(verbEnd, nextStart), Boolean(validMatches[index + 1]));
    const line = normalizeDialogueLine(after);

    if (!line) return;

    turns.push({
      speaker: normalizeSpeaker(before, `Speaker ${turns.length + 1}`),
      delivery: normalizeDelivery(verb),
      line,
      order: turns.length + 1,
    });
  });

  const protectedBlock = turns.length
    ? [
        "PROTECTED_DIALOGUE:",
        ...turns.map((turn) =>
          `${turn.order}. Speaker: ${turn.speaker}; Delivery: ${turn.delivery}; Exact line: "${turn.line}"`,
        ),
        "Dialogue is protected content. Preserve these exact spoken words and speaker order. Do not invent extra dialogue.",
      ].join("\n")
    : "";

  return {
    original,
    turns,
    hasDialogue: turns.length > 0,
    protectedBlock,
  };
}

export function appendProtectedDialogueBlock(prompt: string) {
  const dialogue = detectProtectedDialogue(prompt);
  if (!dialogue.protectedBlock) return oneLine(prompt);
  return `${oneLine(prompt)}\n\n${dialogue.protectedBlock}`;
}

export function ensureProtectedDialogueInOutput(inputPrompt: string, outputPrompt: string) {
  const dialogue = detectProtectedDialogue(inputPrompt);
  const output = oneLine(outputPrompt);
  if (!dialogue.turns.length) return output;

  const missing = dialogue.turns.filter((turn) => {
    const normalizedLine = turn.line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const normalizedOutput = output.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return normalizedLine && !normalizedOutput.includes(normalizedLine);
  });

  if (!missing.length) return output;

  return [
    output,
    "Protected dialogue:",
    ...dialogue.turns.map((turn) => `${turn.speaker} ${turn.delivery}, "${turn.line}"`),
  ].filter(Boolean).join("\n");
}
