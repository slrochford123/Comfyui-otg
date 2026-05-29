from pathlib import Path
from datetime import datetime
import shutil

root = Path(r"C:\AI\OTG-Test2")
target = root / "lib" / "characters" / "qwenVoiceDesign.ts"
backup_dir = root / ".manual-backups" / ("qwen-voice-design-foundation-" + datetime.now().strftime("%Y%m%d-%H%M%S"))

backup_dir.mkdir(parents=True, exist_ok=True)
target.parent.mkdir(parents=True, exist_ok=True)

if target.exists():
    shutil.copy2(target, backup_dir / "qwenVoiceDesign.ts")

content = r"""
export type QwenVoiceType =
  | "elderly_man"
  | "elderly_woman"
  | "adult_man"
  | "adult_woman"
  | "teen_boy"
  | "teen_girl"
  | "young_boy_child"
  | "young_girl_child"
  | "monster"
  | "animal_creature"
  | "villain"
  | "robot_synthetic"
  | "custom";

export type QwenAgeMaturity =
  | "child"
  | "teen"
  | "young_adult"
  | "adult"
  | "middle_aged"
  | "elderly"
  | "ancient"
  | "creature";

export type QwenGenderExpression =
  | "male"
  | "female"
  | "androgynous"
  | "creature_non_human";

export type QwenPitch =
  | "very_low"
  | "low"
  | "medium_low"
  | "medium"
  | "medium_high"
  | "high"
  | "very_high";

export type QwenResonance =
  | "thin"
  | "nasal"
  | "throat_heavy"
  | "chest_heavy"
  | "round"
  | "hollow"
  | "rumbling"
  | "bright";

export type QwenTextureTag =
  | "clean"
  | "warm"
  | "breathy"
  | "raspy"
  | "gravelly"
  | "smooth"
  | "dry"
  | "scratchy"
  | "whispery"
  | "rumbling"
  | "squeaky"
  | "hiss_edged"
  | "metallic"
  | "animal_like";

export type QwenTextureStrength = "subtle" | "moderate" | "strong";
export type QwenPace = "slow" | "natural" | "quick" | "very_quick";
export type QwenEnergy = "low" | "medium" | "high";
export type QwenStyle =
  | "realistic"
  | "cinematic"
  | "animated"
  | "cartoon"
  | "creature_like"
  | "radio_clean"
  | "gritty";

export type QwenActingIntensity =
  | "plain_neutral"
  | "light_character"
  | "strong_character";

export type QwenVariationAmount = "low" | "medium" | "high";
export type QwenPreviewLineId =
  | "neutral_standard"
  | "character_intro"
  | "dialogue_test";

export type QwenVoiceDesignInput = {
  voiceType: QwenVoiceType;
  ageMaturity: QwenAgeMaturity;
  genderExpression: QwenGenderExpression;
  speciesContext: string;
  pitch: QwenPitch;
  resonance: QwenResonance;
  textureTags: QwenTextureTag[];
  textureStrength: QwenTextureStrength;
  pace: QwenPace;
  energy: QwenEnergy;
  style: QwenStyle;
  actingIntensity: QwenActingIntensity;
  avoidTags: string[];
  customNotes: string;
  variationAmount: QwenVariationAmount;
  previewLineId: QwenPreviewLineId;
  candidateCount: 3 | 5;
};

export type QwenVoiceCandidateInstruction = {
  candidateId: string;
  label: string;
  previewText: string;
  baseInstruction: string;
  variantInstruction: string;
  fullInstruction: string;
};

export const QWEN_PREVIEW_LINES: Record<QwenPreviewLineId, string> = {
  neutral_standard:
    "I walk down the street at a steady pace. I wave to someone passing by, sit on a bench, look left, look right, read the newspaper, stand up, and walk back home.",
  character_intro:
    "Hello. I am ready to step into the story whenever you need me.",
  dialogue_test:
    "I understand what you are saying. Let me think about it for a moment before I answer.",
};

export const QWEN_VOICE_TYPE_LABELS: Record<QwenVoiceType, string> = {
  elderly_man: "Elderly man",
  elderly_woman: "Elderly woman",
  adult_man: "Adult man",
  adult_woman: "Adult woman",
  teen_boy: "Teen boy",
  teen_girl: "Teen girl",
  young_boy_child: "Young boy child",
  young_girl_child: "Young girl child",
  monster: "Monster",
  animal_creature: "Animal / creature",
  villain: "Villain",
  robot_synthetic: "Robot / synthetic",
  custom: "Custom",
};

const AGE_LABELS: Record<QwenAgeMaturity, string> = {
  child: "child",
  teen: "teen",
  young_adult: "young adult",
  adult: "adult",
  middle_aged: "middle-aged",
  elderly: "elderly",
  ancient: "ancient",
  creature: "creature-like",
};

const GENDER_LABELS: Record<QwenGenderExpression, string> = {
  male: "male",
  female: "female",
  androgynous: "androgynous",
  creature_non_human: "creature / non-human",
};

const PITCH_LABELS: Record<QwenPitch, string> = {
  very_low: "very low pitch",
  low: "low pitch",
  medium_low: "medium-low pitch",
  medium: "medium pitch",
  medium_high: "medium-high pitch",
  high: "high pitch",
  very_high: "very high pitch",
};

const RESONANCE_LABELS: Record<QwenResonance, string> = {
  thin: "thin small-body resonance",
  nasal: "nasal resonance",
  throat_heavy: "throat-heavy resonance",
  chest_heavy: "chest-heavy resonance",
  round: "round resonance",
  hollow: "hollow resonance",
  rumbling: "rumbling resonance",
  bright: "bright resonance",
};

const TEXTURE_LABELS: Record<QwenTextureTag, string> = {
  clean: "clean",
  warm: "warm",
  breathy: "breathy",
  raspy: "raspy",
  gravelly: "gravelly",
  smooth: "smooth",
  dry: "dry",
  scratchy: "scratchy",
  whispery: "whispery",
  rumbling: "rumbling",
  squeaky: "squeaky",
  hiss_edged: "hiss-edged",
  metallic: "metallic",
  animal_like: "animal-like",
};

const PACE_LABELS: Record<QwenPace, string> = {
  slow: "slow",
  natural: "natural",
  quick: "quick",
  very_quick: "very quick",
};

const STYLE_LABELS: Record<QwenStyle, string> = {
  realistic: "realistic",
  cinematic: "cinematic",
  animated: "animated",
  cartoon: "cartoon",
  creature_like: "creature-like",
  radio_clean: "radio-clean",
  gritty: "gritty",
};

const ACTING_LABELS: Record<QwenActingIntensity, string> = {
  plain_neutral: "plain neutral delivery",
  light_character: "light character delivery",
  strong_character: "strong character delivery",
};

const COMMON_AVOID = [
  "robotic voice",
  "muddy pronunciation",
  "unintelligible speech",
  "random emotion",
  "rewriting the text",
  "changing the words",
];

export function defaultAvoidTagsForVoiceType(voiceType: QwenVoiceType): string[] {
  switch (voiceType) {
    case "young_boy_child":
      return ["feminine voice", "teenage voice", "baby voice", "squeaky cartoon voice", "shrill tone", "robotic voice"];
    case "young_girl_child":
      return ["adult woman voice", "baby voice", "cartoon child voice", "shrill tone", "robotic voice"];
    case "elderly_man":
      return ["cartoon grandpa voice", "fake trembling", "slurred speech", "monster voice", "unintelligible rasp"];
    case "elderly_woman":
      return ["young woman voice", "witch voice", "cartoon old lady", "fake trembling", "slurred speech"];
    case "monster":
      return ["pure growling", "roaring instead of speaking", "distorted noise", "unintelligible speech", "cartoon monster"];
    case "animal_creature":
      return ["chipmunk speed", "unintelligible squeal", "too human", "sound effects instead of speech"];
    case "villain":
      return ["monster growl", "cartoon villain", "shouting", "overacting", "unintelligible whisper"];
    case "robot_synthetic":
      return ["broken text-to-speech artifact", "glitching", "unintelligible synthetic noise"];
    default:
      return ["announcer voice", "cartoon acting", "overacting", "robotic voice"];
  }
}

function uniqueClean(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function joinNatural(values: string[]) {
  const cleaned = uniqueClean(values);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function variantPoolForVoiceType(voiceType: QwenVoiceType, variationAmount: QwenVariationAmount): string[] {
  const sharedLow = [
    "slightly warmer tone",
    "slightly clearer pronunciation",
    "slightly softer resonance",
    "slightly stronger vocal texture",
    "slightly calmer pacing",
  ];

  const sharedMedium = [
    "warmer tone with clearer resonance",
    "slightly rougher texture with natural pacing",
    "rounder tone with clean pronunciation",
    "drier texture with careful speech",
    "more grounded resonance while staying neutral",
  ];

  const sharedHigh = [
    "stronger vocal texture while preserving the same category",
    "more distinct resonance while staying believable",
    "more stylized character flavor while keeping words clear",
    "stronger timbre contrast without changing age or gender category",
    "more cinematic tone while staying neutral",
  ];

  const byType: Partial<Record<QwenVoiceType, string[]>> = {
    elderly_man: [
      "warm retired teacher quality",
      "soft gravelly aged texture",
      "thin breathy elderly tone",
      "deeper but tired grandfather tone",
      "careful slow speech with gentle breath",
    ],
    elderly_woman: [
      "soft grandmother warmth",
      "light breathy aged texture",
      "fragile but clear tone",
      "slightly deeper elderly woman register",
      "gentle caring resonance",
    ],
    young_boy_child: [
      "lower child register, not feminine",
      "clear non-squeaky boyish tone",
      "light youthful voice with soft warmth",
      "small-body resonance without cartoon pitch",
      "natural school-age boy voice",
    ],
    young_girl_child: [
      "bright natural child tone",
      "gentle school-age girl voice",
      "clear youthful voice without shrillness",
      "soft warm child resonance",
      "light playful edge while staying neutral",
    ],
    monster: [
      "low rumbling chest resonance",
      "rough throat texture while understandable",
      "large creature presence without roaring",
      "slow heavy speech with clean words",
      "dark creature tone without distortion",
    ],
    animal_creature: [
      "small bright animal-like flavor",
      "playful high-pitched texture without chipmunk speed",
      "slight squeak while understandable",
      "quick light resonance with clear words",
      "creature-like edge without sound effects",
    ],
    villain: [
      "smooth dark tone",
      "controlled menace",
      "slow confident delivery",
      "deep cinematic resonance",
      "dangerous but realistic voice",
    ],
  };

  const base =
    variationAmount === "low"
      ? sharedLow
      : variationAmount === "high"
        ? sharedHigh
        : sharedMedium;

  return uniqueClean([...(byType[voiceType] || []), ...base]);
}

export function defaultQwenVoiceDesignInput(
  overrides: Partial<QwenVoiceDesignInput> = {},
): QwenVoiceDesignInput {
  const voiceType = overrides.voiceType || "adult_man";

  const base: QwenVoiceDesignInput = {
    voiceType,
    ageMaturity: "adult",
    genderExpression: "male",
    speciesContext: "human",
    pitch: "medium",
    resonance: "round",
    textureTags: ["clean", "warm"],
    textureStrength: "moderate",
    pace: "natural",
    energy: "medium",
    style: "realistic",
    actingIntensity: "plain_neutral",
    avoidTags: defaultAvoidTagsForVoiceType(voiceType),
    customNotes: "",
    variationAmount: "medium",
    previewLineId: "neutral_standard",
    candidateCount: 3,
  };

  return {
    ...base,
    ...overrides,
    avoidTags: overrides.avoidTags || base.avoidTags,
    textureTags: overrides.textureTags || base.textureTags,
  };
}

export function buildQwenBaseInstruction(input: QwenVoiceDesignInput) {
  const voiceLabel = QWEN_VOICE_TYPE_LABELS[input.voiceType];
  const speciesContext = input.speciesContext.trim() || "unspecified character";
  const textures = input.textureTags.map((tag) => TEXTURE_LABELS[tag]).filter(Boolean);

  const avoid = uniqueClean([
    ...input.avoidTags,
    ...defaultAvoidTagsForVoiceType(input.voiceType),
    ...COMMON_AVOID,
  ]);

  const customNotes = input.customNotes.trim();

  return [
    "Create a new character voice.",
    "",
    "Voice identity:",
    `${AGE_LABELS[input.ageMaturity]}, ${GENDER_LABELS[input.genderExpression]}, ${voiceLabel}, ${speciesContext}.`,
    "",
    "Vocal texture:",
    `${joinNatural(textures)} with ${input.textureStrength} intensity.`,
    "",
    "Pitch and resonance:",
    `${PITCH_LABELS[input.pitch]}, ${RESONANCE_LABELS[input.resonance]}.`,
    "",
    "Speaking style:",
    `${PACE_LABELS[input.pace]} pace, ${input.energy} energy, ${STYLE_LABELS[input.style]} style, ${ACTING_LABELS[input.actingIntensity]}.`,
    customNotes ? "" : null,
    customNotes ? "Extra voice notes:" : null,
    customNotes ? customNotes : null,
    "",
    "Avoid:",
    avoid.join(", "),
    "",
    "Important:",
    "Speak in a plain neutral tone. Do not add emotion. Speak the exact text. Do not rewrite the words. Keep the voice understandable. Do not sound robotic. Do not sound cartoonish unless cartoon style is selected.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildQwenVoiceCandidateInstructions(input: QwenVoiceDesignInput): QwenVoiceCandidateInstruction[] {
  const previewText = QWEN_PREVIEW_LINES[input.previewLineId] || QWEN_PREVIEW_LINES.neutral_standard;
  const baseInstruction = buildQwenBaseInstruction(input);
  const variantPool = variantPoolForVoiceType(input.voiceType, input.variationAmount);
  const candidateCount = input.candidateCount === 5 ? 5 : 3;

  return Array.from({ length: candidateCount }).map((_, index) => {
    const variant = variantPool[index % variantPool.length] || "natural voice variation while preserving the same identity";
    const candidateId = `candidate_${String(index + 1).padStart(2, "0")}`;
    const variantInstruction = `Variant direction: ${variant}. Preserve the same core age, gender expression, species context, and voice category.`;
    const fullInstruction = `${baseInstruction}\n\n${variantInstruction}`;

    return {
      candidateId,
      label: `Voice Option ${index + 1}`,
      previewText,
      baseInstruction,
      variantInstruction,
      fullInstruction,
    };
  });
}

export function qwenVoiceDesignStorageRecord(
  input: QwenVoiceDesignInput,
  selected: QwenVoiceCandidateInstruction,
) {
  return {
    engine: "qwen3_tts_voice_design",
    model: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    status: "voice_design_selected",
    voiceType: input.voiceType,
    ageMaturity: input.ageMaturity,
    genderExpression: input.genderExpression,
    speciesContext: input.speciesContext,
    pitch: input.pitch,
    resonance: input.resonance,
    textureTags: input.textureTags,
    textureStrength: input.textureStrength,
    pace: input.pace,
    energy: input.energy,
    style: input.style,
    actingIntensity: input.actingIntensity,
    avoidTags: uniqueClean(input.avoidTags),
    customNotes: input.customNotes,
    variationAmount: input.variationAmount,
    selectedCandidateId: selected.candidateId,
    previewText: selected.previewText,
    baseInstruction: selected.baseInstruction,
    variantInstruction: selected.variantInstruction,
    fullQwenInstruction: selected.fullInstruction,
  };
}
"""

target.write_text(content.strip() + "\n", encoding="utf-8")

required = [
    "buildQwenBaseInstruction",
    "buildQwenVoiceCandidateInstructions",
    "defaultAvoidTagsForVoiceType",
    "qwenVoiceDesignStorageRecord",
    "QWEN_PREVIEW_LINES",
]

written = target.read_text(encoding="utf-8")
missing = [item for item in required if item not in written]
if missing:
    raise RuntimeError("Verification failed. Missing: " + ", ".join(missing))

print("OK: wrote", target)
print("Backup:", backup_dir)
