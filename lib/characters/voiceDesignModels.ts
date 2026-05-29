export type VoiceDesignModelId = "qwen3tts" | "cosyvoice";
export type VoiceDesignMode = "voice_design" | "custom_voice" | "voice_clone" | "instruct" | "zero_shot_reference";
export type SpeakerIdentity = "man" | "woman" | "child" | "adult" | "elderly_person";
export type VoiceAgeRange = "child" | "teen" | "young_adult" | "adult" | "middle_aged" | "elderly";
export type VoiceGenderPresentation = "male" | "female" | "neutral_androgynous";
export type VoicePace = "very_slow" | "slow" | "medium" | "fast" | "very_fast";
export type VoicePitch = "very_low" | "low" | "medium" | "high" | "very_high";
export type VoiceEnergy = "low" | "medium" | "high" | "very_high";

export type VoiceDesignOptionKind =
  | "official"
  | "prompt_based"
  | "preset_speaker"
  | "chinese_dialect";

export type VoiceDesignOption = {
  id: string;
  label: string;
  detail?: string;
  language?: string;
  speaker?: string;
  kind: VoiceDesignOptionKind;
  instruction?: string;
  referenceRecommended?: boolean;
};

export type VoiceDesignProfile = {
  model: VoiceDesignModelId;
  mode: VoiceDesignMode;
  modelVersion: "cosyvoice" | "cosyvoice3";
  speakerIdentity: SpeakerIdentity;
  ageRange: VoiceAgeRange;
  genderPresentation: VoiceGenderPresentation;
  language: string;
  accentDialectId: string;
  qwenPresetSpeaker: string;
  tone: string;
  pace: VoicePace;
  pitch: VoicePitch;
  energy: VoiceEnergy;
  timbre: string;
  deliveryStyle: string;
  useCaseContext: string;
  avoidList: string;
  extraNotes: string;
  sampleText: string;
  emotionStrength: number;
  accentStrength: number;
  speakingRate: number;
  volume: number;
  stability: number;
  expressiveness: number;
  referenceText: string;
  referenceAudioName: string;
  seed: string;
  advancedInstructionOverride: string;
};

export type VoiceRequestPayload = {
  model: "qwen3-tts" | "cosyvoice" | "cosyvoice3";
  mode: VoiceDesignMode;
  language: string;
  speaker?: string | null;
  text: string;
  instruct?: string;
  prompt?: string;
  referenceAudio?: string | null;
  voiceDesign: VoiceDesignProfile;
  accentDialect: VoiceDesignOption | null;
};

export const DEFAULT_SAMPLE_TEXT =
  "Hello, this is my character voice. I am speaking clearly at a natural pace so you can hear the tone, age, pitch, and emotion of the voice.";

export const SPEAKER_IDENTITIES: SpeakerIdentity[] = ["man", "woman", "child", "adult", "elderly_person"];
export const VOICE_AGE_RANGES: VoiceAgeRange[] = ["child", "teen", "young_adult", "adult", "middle_aged", "elderly"];
export const VOICE_GENDER_PRESENTATIONS: VoiceGenderPresentation[] = ["male", "female", "neutral_androgynous"];
export const VOICE_TONES = [
  "warm",
  "calm",
  "bright",
  "serious",
  "playful",
  "confident",
  "gentle",
  "authoritative",
  "dramatic",
  "friendly",
  "professional",
  "mysterious",
  "energetic",
  "sad",
  "excited",
  "angry",
  "nervous",
  "robotic",
  "storyteller",
  "documentary narrator",
  "commercial announcer",
  "conversational",
] as const;
export const VOICE_PACES: VoicePace[] = ["very_slow", "slow", "medium", "fast", "very_fast"];
export const VOICE_PITCHES: VoicePitch[] = ["very_low", "low", "medium", "high", "very_high"];
export const VOICE_ENERGIES: VoiceEnergy[] = ["low", "medium", "high", "very_high"];
export const VOICE_TIMBRES = ["smooth", "rough", "breathy", "raspy", "clear", "deep", "soft", "sharp", "mellow", "nasal", "airy", "resonant"] as const;
export const DELIVERY_STYLES = [
  "narration",
  "dialogue",
  "commercial",
  "audiobook",
  "podcast",
  "training video",
  "character acting",
  "newsreader",
  "assistant voice",
  "game NPC",
  "meditation",
  "educational explainer",
  "customer support",
] as const;

export const QWEN_OFFICIAL_PRESETS: VoiceDesignOption[] = [
  { id: "Vivian", label: "Vivian", speaker: "Vivian", language: "Chinese", kind: "preset_speaker", detail: "Bright, slightly edgy young female voice" },
  { id: "Serena", label: "Serena", speaker: "Serena", language: "Chinese", kind: "preset_speaker", detail: "Warm, gentle young female voice" },
  { id: "Uncle_Fu", label: "Uncle_Fu", speaker: "Uncle_Fu", language: "Chinese", kind: "preset_speaker", detail: "Seasoned male voice with low mellow timbre" },
  { id: "Dylan", label: "Dylan", speaker: "Dylan", language: "Chinese", kind: "preset_speaker", detail: "Youthful Beijing male voice" },
  { id: "Eric", label: "Eric", speaker: "Eric", language: "Chinese", kind: "preset_speaker", detail: "Lively Chengdu/Sichuan male voice" },
  { id: "Ryan", label: "Ryan", speaker: "Ryan", language: "English", kind: "preset_speaker", detail: "Dynamic English male voice" },
  { id: "Aiden", label: "Aiden", speaker: "Aiden", language: "English", kind: "preset_speaker", detail: "Sunny American male voice" },
  { id: "Ono_Anna", label: "Ono_Anna", speaker: "Ono_Anna", language: "Japanese", kind: "preset_speaker", detail: "Playful Japanese female voice" },
  { id: "Sohee", label: "Sohee", speaker: "Sohee", language: "Korean", kind: "preset_speaker", detail: "Warm Korean female voice" },
];

export const QWEN_OFFICIAL_DIALECTS: VoiceDesignOption[] = [
  { id: "qwen_beijing_dylan", label: "Beijing Chinese via Dylan", speaker: "Dylan", language: "Chinese", kind: "official" },
  { id: "qwen_chengdu_eric", label: "Chengdu / Sichuan Chinese via Eric", speaker: "Eric", language: "Chinese", kind: "official" },
  { id: "qwen_american_aiden", label: "American English via Aiden", speaker: "Aiden", language: "English", kind: "official" },
  { id: "qwen_general_english_ryan", label: "General English male voice via Ryan", speaker: "Ryan", language: "English", kind: "official" },
  { id: "qwen_japanese_ono_anna", label: "Japanese character voice via Ono_Anna", speaker: "Ono_Anna", language: "Japanese", kind: "official" },
  { id: "qwen_korean_sohee", label: "Korean character voice via Sohee", speaker: "Sohee", language: "Korean", kind: "official" },
];

const PROMPT_BASED_ENGLISH_ACCENTS = [
  "British English / Received Pronunciation",
  "Cockney / London English",
  "Australian English",
  "Irish English",
  "Scottish English",
  "South African English",
  "Nigerian English",
  "Kenyan English",
  "Indian English",
  "Singapore English",
  "Southern American English",
  "New York English",
  "Canadian English",
  "Neutral American English",
  "Neutral International English",
];

export const PROMPT_BASED_ACCENTS: VoiceDesignOption[] = PROMPT_BASED_ENGLISH_ACCENTS.map((label) => ({
  id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  label,
  language: "English",
  kind: "prompt_based",
  referenceRecommended: true,
  detail: "Prompt-based accent guidance — quality depends on model behavior and/or reference audio.",
}));

export const COSY_LANGUAGES = ["Chinese", "English", "Japanese", "Korean", "German", "Spanish", "French", "Italian", "Russian"] as const;

export const COSY_CHINESE_DIALECTS: VoiceDesignOption[] = [
  ["guangdong_cantonese", "Guangdong / Cantonese / 广东话", "请用广东话表达。"],
  ["dongbei", "Dongbei / Northeastern Mandarin / 东北话", "请用东北话表达。"],
  ["gansu", "Gansu / 甘肃话", "请用甘肃话表达。"],
  ["guizhou", "Guizhou / 贵州话", "请用贵州话表达。"],
  ["henan", "Henan / 河南话", "请用河南话表达。"],
  ["hubei", "Hubei / 湖北话", "请用湖北话表达。"],
  ["hunan", "Hunan / 湖南话", "请用湖南话表达。"],
  ["jiangxi", "Jiangxi / 江西话", "请用江西话表达。"],
  ["minnan", "Minnan / 闽南话", "请用闽南话表达。"],
  ["ningxia", "Ningxia / 宁夏话", "请用宁夏话表达。"],
  ["shanxi", "Shanxi / 山西话", "请用山西话表达。"],
  ["shaanxi", "Shaanxi / 陕西话", "请用陕西话表达。"],
  ["shandong", "Shandong / 山东话", "请用山东话表达。"],
  ["shanghai", "Shanghai / 上海话", "请用上海话表达。"],
  ["sichuan", "Sichuan / 四川话", "请用四川话表达。"],
  ["tianjin", "Tianjin / 天津话", "请用天津话表达。"],
  ["yunnan", "Yunnan / 云南话", "请用云南话表达。"],
  ["chongqing", "Chongqing / 重庆话", "请用重庆话表达。"],
  ["xian", "Xi'an / 西安话", "请用西安话表达。"],
].map(([id, label, instruction]) => ({
  id,
  label,
  language: "Chinese",
  kind: "chinese_dialect",
  instruction,
  detail: "Officially documented/common CosyVoice Chinese dialect instruction.",
}));

export const voiceModels = {
  qwen3tts: {
    label: "Qwen3-TTS",
    strengths: ["Natural-language voice design", "Fictional/persona voices", "Preset speaker voices"],
    modes: ["voice_design", "custom_voice", "voice_clone"] as VoiceDesignMode[],
    officialPresets: QWEN_OFFICIAL_PRESETS,
    officialDialects: QWEN_OFFICIAL_DIALECTS,
    promptBasedAccents: PROMPT_BASED_ACCENTS,
  },
  cosyvoice: {
    label: "CosyVoice",
    strengths: ["Multilingual generation", "Chinese dialect instruction", "Reference-audio workflows"],
    modes: ["instruct", "zero_shot_reference"] as VoiceDesignMode[],
    officialDialects: COSY_CHINESE_DIALECTS,
    promptBasedAccents: PROMPT_BASED_ACCENTS,
    languages: COSY_LANGUAGES,
  },
} as const;

function label(value: string): string {
  return value.replace(/_/g, " ");
}

function selectedAccent(profile: VoiceDesignProfile): VoiceDesignOption | null {
  const options = [
    ...QWEN_OFFICIAL_PRESETS,
    ...QWEN_OFFICIAL_DIALECTS,
    ...COSY_CHINESE_DIALECTS,
    ...PROMPT_BASED_ACCENTS,
  ];
  return options.find((item) => item.id === profile.accentDialectId || item.speaker === profile.accentDialectId) || null;
}

function avoidDefaults(profile: VoiceDesignProfile): string[] {
  const avoid = ["unstable speaker identity", "randomly changing age", "rewriting the text", "muddy pronunciation"];
  if (profile.genderPresentation === "male") avoid.push("female timbre", "feminine pitch");
  if (profile.genderPresentation === "female") avoid.push("male timbre", "masculine bass");
  if (profile.ageRange === "adult" || profile.ageRange === "middle_aged" || profile.ageRange === "elderly") avoid.push("childlike voice");
  if (profile.ageRange === "child" || profile.ageRange === "teen") avoid.push("adult tone", "elderly tone");
  return avoid;
}

export function defaultVoiceDesignProfile(overrides: Partial<VoiceDesignProfile> = {}): VoiceDesignProfile {
  const base: VoiceDesignProfile = {
    model: "qwen3tts",
    mode: "voice_design",
    modelVersion: "cosyvoice3",
    speakerIdentity: "man",
    ageRange: "adult",
    genderPresentation: "male",
    language: "English",
    accentDialectId: "neutral_american_english",
    qwenPresetSpeaker: "Aiden",
    tone: "calm",
    pace: "medium",
    pitch: "medium",
    energy: "medium",
    timbre: "clear",
    deliveryStyle: "dialogue",
    useCaseContext: "character voice",
    avoidList: "",
    extraNotes: "",
    sampleText: DEFAULT_SAMPLE_TEXT,
    emotionStrength: 50,
    accentStrength: 50,
    speakingRate: 1,
    volume: 1,
    stability: 70,
    expressiveness: 55,
    referenceText: "",
    referenceAudioName: "",
    seed: "",
    advancedInstructionOverride: "",
  };
  return { ...base, ...overrides };
}

export function buildQwenVoiceDesignPrompt(profile: VoiceDesignProfile): string {
  if (profile.advancedInstructionOverride.trim()) return profile.advancedInstructionOverride.trim();
  const accent = selectedAccent(profile);
  const accentText = accent?.label || profile.language;
  const avoid = [...avoidDefaults(profile), ...profile.avoidList.split(",").map((item) => item.trim()).filter(Boolean)];
  return [
    `Design a consistent ${label(profile.ageRange)} ${label(profile.genderPresentation)} speaker voice.`,
    `Use ${accentText}, ${profile.timbre} timbre, ${label(profile.pitch)} pitch, ${label(profile.energy)} energy, ${profile.tone} tone, ${label(profile.pace)} pace, and ${profile.deliveryStyle} delivery.`,
    `The use case is ${profile.useCaseContext || "character voice"} with ${profile.expressiveness}% expressiveness and ${profile.stability}% stability/consistency.`,
    profile.extraNotes ? `Additional voice notes: ${profile.extraNotes}.` : "",
    `Avoid ${avoid.join(", ")}.`,
    "Speak the provided text exactly and keep the speaker identity stable.",
  ].filter(Boolean).join(" ");
}

export function buildQwenCustomVoiceConfig(profile: VoiceDesignProfile): VoiceRequestPayload {
  const preset = QWEN_OFFICIAL_PRESETS.find((item) => item.speaker === profile.qwenPresetSpeaker) || QWEN_OFFICIAL_PRESETS[0];
  return {
    model: "qwen3-tts",
    mode: "custom_voice",
    language: preset.language || profile.language,
    speaker: preset.speaker || null,
    text: profile.sampleText || DEFAULT_SAMPLE_TEXT,
    instruct: `Use ${preset.detail || preset.label} with ${profile.tone} tone, ${label(profile.pace)} pace, ${profile.deliveryStyle} delivery, and clear articulation.`,
    referenceAudio: null,
    voiceDesign: profile,
    accentDialect: preset,
  };
}

export function buildCosyVoiceInstructionPrompt(profile: VoiceDesignProfile): string {
  if (profile.advancedInstructionOverride.trim()) return profile.advancedInstructionOverride.trim();
  const accent = selectedAccent(profile);
  const base = "You are a helpful assistant.";
  const traits =
    profile.language === "Chinese" && accent?.kind === "chinese_dialect"
      ? `${accent.instruction || ""}请使用${label(profile.ageRange)}${label(profile.genderPresentation)}声音，语速${label(profile.pace)}，语气${profile.tone}，音色${profile.timbre}，表达${profile.deliveryStyle}。`
      : `Please speak with ${accent?.label || profile.language} guidance, ${label(profile.ageRange)} ${label(profile.genderPresentation)} voice, ${profile.tone} tone, ${label(profile.pace)} pace, ${label(profile.pitch)} pitch, ${profile.timbre} timbre, ${profile.deliveryStyle} style, and clear articulation.`;
  const reference = accent?.referenceRecommended ? " Best results require matching reference audio." : "";
  const notes = profile.extraNotes ? ` ${profile.extraNotes}` : "";
  return `${base} ${traits}${reference}${notes}<|endofprompt|>`;
}

export function buildVoiceRequestPayload(profile: VoiceDesignProfile): VoiceRequestPayload {
  const accentDialect = selectedAccent(profile);
  if (profile.model === "qwen3tts") {
    if (profile.mode === "custom_voice") return buildQwenCustomVoiceConfig(profile);
    return {
      model: "qwen3-tts",
      mode: profile.mode,
      language: profile.language,
      speaker: null,
      text: profile.sampleText || DEFAULT_SAMPLE_TEXT,
      instruct: buildQwenVoiceDesignPrompt(profile),
      referenceAudio: profile.referenceAudioName || null,
      voiceDesign: profile,
      accentDialect,
    };
  }
  return {
    model: profile.modelVersion,
    mode: profile.mode,
    language: profile.language,
    text: profile.sampleText || DEFAULT_SAMPLE_TEXT,
    prompt: buildCosyVoiceInstructionPrompt(profile),
    referenceAudio: profile.referenceAudioName || null,
    voiceDesign: profile,
    accentDialect,
  };
}

export function voiceDesignWarnings(profile: VoiceDesignProfile): string[] {
  const text = `${profile.extraNotes} ${profile.avoidList}`.toLowerCase();
  const warnings: string[] = [];
  if (profile.genderPresentation === "male" && /\b(female|woman|girl|feminine)\b/.test(text)) warnings.push("Extra notes mention female/feminine terms while Male is selected.");
  if (profile.genderPresentation === "female" && /\b(male|man|boy|masculine)\b/.test(text)) warnings.push("Extra notes mention male/masculine terms while Female is selected.");
  if ((profile.ageRange === "adult" || profile.ageRange === "middle_aged" || profile.ageRange === "elderly") && /\b(child|kid|teen)\b/.test(text)) warnings.push("Extra notes mention child/teen terms while an adult age range is selected.");
  if ((profile.ageRange === "child" || profile.ageRange === "teen") && /\b(adult|middle aged|senior|elderly|old)\b/.test(text)) warnings.push("Extra notes mention adult/senior terms while a child or teen age range is selected.");
  const accent = selectedAccent(profile);
  if (accent?.referenceRecommended) warnings.push("This accent is prompt-guided. For best accuracy, use a matching reference voice.");
  return warnings;
}

export function accentOptionsForModel(profile: VoiceDesignProfile): VoiceDesignOption[] {
  if (profile.model === "qwen3tts") return [...QWEN_OFFICIAL_DIALECTS, ...PROMPT_BASED_ACCENTS];
  return profile.language === "Chinese" ? [...COSY_CHINESE_DIALECTS, ...PROMPT_BASED_ACCENTS] : PROMPT_BASED_ACCENTS;
}

export function statusForAccent(profile: VoiceDesignProfile): VoiceDesignOption | null {
  return selectedAccent(profile);
}
