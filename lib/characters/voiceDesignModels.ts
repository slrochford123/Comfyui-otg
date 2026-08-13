export type VoiceDesignModelId = "qwen3tts" | "cosyvoice" | "ltxvoice" | "unnaturalvoices";
export type VoiceDesignMode = "voice_design" | "custom_voice" | "voice_clone" | "instruct" | "zero_shot_reference";
export type SpeakerIdentity = "man" | "woman" | "child" | "adult" | "elderly_person";
export type VoiceAgeRange = "child" | "teen" | "teenager" | "young_adult" | "adult" | "middle_aged" | "elderly";
export type VoiceGenderPresentation = "male" | "female" | "neutral_androgynous";
export type VoicePace = "very_slow" | "slow" | "medium" | "fast" | "very_fast";
export type VoicePitch = "very_low" | "low" | "medium" | "high" | "very_high";
export type VoiceEnergy = "low" | "medium" | "high" | "very_high";

export type VoiceDesignOptionKind =
  | "official"
  | "prompt_based"
  | "preset_speaker"
  | "chinese_dialect"
  | "ltx_dialect";

export type VoiceDesignOption = {
  id: string;
  label: string;
  detail?: string;
  language?: string;
  speaker?: string;
  kind: VoiceDesignOptionKind;
  instruction?: string;
  promptLabel?: string;
  auditionLine?: string;
  enabled?: boolean;
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
  model: "qwen3-tts" | "cosyvoice" | "cosyvoice3" | "ltx-voice";
  mode: VoiceDesignMode;
  language: string;
  speaker?: string | null;
  text: string;
  instruct?: string;
  prompt?: string;
  referenceAudio?: string | null;
  voiceDesign: VoiceDesignProfile;
  accentDialect: VoiceDesignOption | null;
  ltxAuditionPrompt?: string;
};

export const DEFAULT_VOICE_SAMPLE_TEXT =
  "Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.";

export const DEFAULT_SAMPLE_TEXT = DEFAULT_VOICE_SAMPLE_TEXT;

export const LTX_VOICE_NEGATIVE_PROMPT =
  "singing, music, background noise, background noises, sound effects, sound effect, ambience, crowd noise, overlapping voices, multiple speakers, choir, instrumental, soundtrack, reverb, echo, muffled speech, distorted speech, whispering, mumbling";

export const DEFAULT_LTX_VOICE_DIALECT_ID = "general_american";

export const LTX_VOICE_DIALECTS = [
  { id: "african_american_vernacular", label: "African American Vernacular", promptLabel: "African American Vernacular", kind: "ltx_dialect", auditionLine: "Ayo, this voice right here got rhythm and heart. I am speaking clear, strong, and alive, with real feeling in every word.", enabled: true },
  { id: "arabic", label: "Arabic", promptLabel: "Arabic", kind: "ltx_dialect", auditionLine: "Marhaba, my friend. This voice speaks with warmth, strength, and clear emotion, carrying rich rhythm in every word today.", enabled: true },
  { id: "australian", label: "Australian", promptLabel: "Australian", kind: "ltx_dialect", auditionLine: "G'day, mate. This is my voice, easy and bright, speaking clear with Aussie rhythm, warm feeling, and cheeky charm.", enabled: true },
  { id: "belizean_kriol", label: "Belizean Kriol", promptLabel: "Belizean Kriol", kind: "ltx_dialect", auditionLine: "Eh bwai, dis da mi voice. I di talk clear and strong, wid Belize rhythm, warm heart, and plenty feeling.", enabled: true },
  { id: "british", label: "British", promptLabel: "British", kind: "ltx_dialect", auditionLine: "Hello, this is my voice. I am speaking with a composed British tone, clear rhythm, careful feeling, and confident expression.", enabled: true },
  { id: "chicago", label: "Chicago", promptLabel: "Chicago", kind: "ltx_dialect", auditionLine: "Hey, this is my voice. I am speaking direct and clear, with Chicago energy, city rhythm, and strong honest feeling.", enabled: true },
  { id: "essex", label: "Essex", promptLabel: "Essex", kind: "ltx_dialect", auditionLine: "Oi, listen up. This is my voice, bright and confident, speaking clear with Essex attitude, rhythm, and proper feeling.", enabled: true },
  { id: "french", label: "French", promptLabel: "French", kind: "ltx_dialect", auditionLine: "Bonjour, my friend. This voice speaks with French elegance, soft rhythm, warm emotion, and clear feeling in every word.", enabled: true },
  { id: "general_american", label: "General American", promptLabel: "General American", kind: "ltx_dialect", auditionLine: "Hello, this is my voice. I am speaking clearly with a natural American sound, steady tone, and controlled emotion.", enabled: true },
  { id: "german", label: "German", promptLabel: "German", kind: "ltx_dialect", auditionLine: "Hallo, my friend. This voice is clear, steady, and precise, with strong tone, careful rhythm, and controlled emotion.", enabled: true },
  { id: "ghanaian", label: "Ghanaian", promptLabel: "Ghanaian", kind: "ltx_dialect", auditionLine: "Ei, chale, this is my voice. I am speaking clearly with Ghanaian warmth, bright rhythm, strong energy, and real feeling.", enabled: true },
  { id: "guyanese", label: "Guyanese", promptLabel: "Guyanese", kind: "ltx_dialect", auditionLine: "Ay bai, dis is meh voice. I talking clear and strong, wid Guyanese rhythm, warm feeling, and real character inside.", enabled: true },
  { id: "indian", label: "Indian", promptLabel: "Indian", kind: "ltx_dialect", auditionLine: "Hello, my friend. This is my voice. Please listen carefully to the tone, emotion, rhythm, and clear expression in every word.", enabled: true },
  { id: "italian", label: "Italian", promptLabel: "Italian", kind: "ltx_dialect", auditionLine: "Ciao, my friend. This-a voice speaks with heart, warm rhythm, open emotion, and clear feeling in every single word.", enabled: true },
  { id: "jamaican", label: "Jamaican", promptLabel: "Jamaican", kind: "ltx_dialect", auditionLine: "Wah gwaan, mi friend. Dis ya voice bright like Kingston morning; mi talk wid heart, rhythm, and clear Jamaican feeling.", enabled: true },
  { id: "london_cockney", label: "London Cockney", promptLabel: "London Cockney", kind: "ltx_dialect", auditionLine: "Oi, listen here. This is me voice, clear as day, with London bite, warm feeling, and proper character in every word.", enabled: true },
  { id: "manchester_mancunian", label: "Manchester Mancunian", promptLabel: "Manchester Mancunian", kind: "ltx_dialect", auditionLine: "Alright, mate. This is my voice, plain spoken and clear, with Manchester rhythm, grounded tone, and real feeling.", enabled: true },
  { id: "nigerian_naija", label: "Nigerian Naija", promptLabel: "Nigerian Naija", kind: "ltx_dialect", auditionLine: "Hello o, this is my voice. I am speaking clearly with Naija energy, strong rhythm, confidence, and plenty feeling.", enabled: true },
  { id: "northern_irish", label: "Northern Irish", promptLabel: "Northern Irish", kind: "ltx_dialect", auditionLine: "Here now, this is my voice. I am speaking clear and firm, with Northern Irish rhythm, sharp tone, and strong feeling.", enabled: true },
  { id: "portuguese_brazilian", label: "Portuguese Brazilian", promptLabel: "Portuguese Brazilian", kind: "ltx_dialect", auditionLine: "Ola, meu amigo. This voice is warm, musical, and clear, with Brazilian rhythm, bright emotion, and open feeling.", enabled: true },
  { id: "russian", label: "Russian", promptLabel: "Russian", kind: "ltx_dialect", auditionLine: "Hello, my friend. This voice is strong, serious, and clear, with deep tone, steady rhythm, and powerful emotion.", enabled: true },
  { id: "singapore_singlish", label: "Singapore Singlish", promptLabel: "Singapore Singlish", kind: "ltx_dialect", auditionLine: "Hello lah, this is my voice. I speak clear-clear, with Singapore rhythm, confident tone, and steady emotion, can.", enabled: true },
  { id: "spanish", label: "Spanish", promptLabel: "Spanish", kind: "ltx_dialect", auditionLine: "Hola, my friend. This is my voice, warm and clear, with Spanish rhythm, bright tone, and strong emotion in every word.", enabled: true },
  { id: "texan", label: "Texan", promptLabel: "Texan", kind: "ltx_dialect", auditionLine: "Howdy, this is my voice. I am speaking clear and steady, with Texas warmth, confidence, and a strong honest feeling.", enabled: true },
  { id: "trinidadian", label: "Trinidadian", promptLabel: "Trinidadian", kind: "ltx_dialect", auditionLine: "Ay, dis is meh voice. Ah speaking clear and lively, wid Trini rhythm, warm feeling, and plenty character inside.", enabled: true },
  { id: "welsh", label: "Welsh", promptLabel: "Welsh", kind: "ltx_dialect", auditionLine: "Hello, this is my voice, it is. I am speaking clear, with Welsh warmth, musical rhythm, and feeling in every word.", enabled: true },
  { id: "west_country", label: "West Country", promptLabel: "West Country", kind: "ltx_dialect", auditionLine: "Alright, me lover, this be my voice. I be speaking clear and warm, with West Country heart and steady feeling.", enabled: true },
  { id: "yorkshire", label: "Yorkshire", promptLabel: "Yorkshire", kind: "ltx_dialect", auditionLine: "Ey up, this is me voice. I am speaking plain, warm, and clear, with Yorkshire heart and nowt fancy hiding the feeling.", enabled: true },
] as const satisfies readonly VoiceDesignOption[];

export function getLtxDialectSampleText(accentDialectId: string): string {
  return LTX_VOICE_DIALECTS.find((dialect) => dialect.id === accentDialectId)?.auditionLine || DEFAULT_VOICE_SAMPLE_TEXT;
}

export function isLtxDialectSampleText(sampleText: string): boolean {
  const normalized = sampleText.trim();
  if (!normalized) return false;
  return normalized === DEFAULT_VOICE_SAMPLE_TEXT || LTX_VOICE_DIALECTS.some((dialect) => dialect.auditionLine === normalized);
}

export const SPEAKER_IDENTITIES: SpeakerIdentity[] = ["man", "woman", "child", "adult", "elderly_person"];
export const VOICE_AGE_RANGES: VoiceAgeRange[] = ["child", "teenager", "young_adult", "adult", "elderly"];
export const VOICE_GENDER_PRESENTATIONS: VoiceGenderPresentation[] = ["male", "female", "neutral_androgynous"];
export const VOICE_TONES = [
  "warm",
  "calm",
  "bright",
  "serious",
  "playful",
  "confident",
  "fearful",
  "gentle",
  "authoritative",
  "villainous",
  "heroic",
  "dramatic",
  "friendly",
  "professional",
  "mysterious",
  "comedic",
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
  detail: "Prompt-based accent guidance Ã¢â‚¬â€ quality depends on model behavior and/or reference audio.",
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
    description: "English-only voice design for Qwen3-TTS. Accent and language controls are hidden in Character Builder.",
    strengths: ["Natural-language voice design", "Fictional/persona voices", "Preset speaker voices"],
    modes: ["voice_design", "custom_voice", "voice_clone"] as VoiceDesignMode[],
    officialPresets: QWEN_OFFICIAL_PRESETS,
    officialDialects: QWEN_OFFICIAL_DIALECTS,
    promptBasedAccents: PROMPT_BASED_ACCENTS,
  },
  cosyvoice: {
    label: "CosyVoice",
    description: "English-only voice design for CosyVoice in Character Builder. Accent and language controls are hidden.",
    strengths: ["Multilingual generation", "Chinese dialect instruction", "Reference-audio workflows"],
    modes: ["instruct", "zero_shot_reference"] as VoiceDesignMode[],
    officialDialects: COSY_CHINESE_DIALECTS,
    promptBasedAccents: PROMPT_BASED_ACCENTS,
    languages: COSY_LANGUAGES,
  },
  ltxvoice: {
    label: "LTX Voice",
    description: "Experimental accent-capable voice generation using LTX video audio. Creates a hidden 1080p / 1 FPS / 10-second LTX audition clip and returns audio only.",
    strengths: ["Accent-capable audition prompts", "Stylized dialect lines", "Audio-first hidden LTX clip"],
    modes: ["voice_design"] as VoiceDesignMode[],
    officialDialects: LTX_VOICE_DIALECTS,
    promptBasedAccents: [],
    languages: ["English"],
  },
  unnaturalvoices: {
    label: "Unnatural Voices",
    description: "Fixed LTX creature, fantasy, robot, animal, alien, and elemental voice presets. Patch 1 adds registry and selection UI only.",
    strengths: ["Creature presets", "Robot/fantasy voices", "Audio-only LTX later"],
    modes: ["voice_design"] as VoiceDesignMode[],
    officialDialects: [],
    promptBasedAccents: [],
    languages: ["English"],
  },
} as const;

function label(value: string): string {
  return value.replace(/_/g, " ");
}

function selectedAccent(profile: VoiceDesignProfile): VoiceDesignOption | null {
  const options: VoiceDesignOption[] = [
    ...QWEN_OFFICIAL_PRESETS,
    ...QWEN_OFFICIAL_DIALECTS,
    ...COSY_CHINESE_DIALECTS,
    ...PROMPT_BASED_ACCENTS,
    ...LTX_VOICE_DIALECTS,
  ];
  return options.find((item) => item.id === profile.accentDialectId || item.speaker === profile.accentDialectId) || null;
}

function avoidDefaults(profile: VoiceDesignProfile): string[] {
  const avoid = ["unstable speaker identity", "randomly changing age", "rewriting the text", "muddy pronunciation"];
  if (profile.genderPresentation === "male") avoid.push("female timbre", "feminine pitch");
  if (profile.genderPresentation === "female") avoid.push("male timbre", "masculine bass");
  if (profile.ageRange === "adult" || profile.ageRange === "middle_aged" || profile.ageRange === "elderly") avoid.push("childlike voice");
  if (profile.ageRange === "child" || profile.ageRange === "teen" || profile.ageRange === "teenager") avoid.push("adult tone", "elderly tone");
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
      ? `${accent.instruction || ""}Ã¨Â¯Â·Ã¤Â½Â¿Ã§â€Â¨${label(profile.ageRange)}${label(profile.genderPresentation)}Ã¥Â£Â°Ã©Å¸Â³Ã¯Â¼Å’Ã¨Â¯Â­Ã©â‚¬Å¸${label(profile.pace)}Ã¯Â¼Å’Ã¨Â¯Â­Ã¦Â°â€${profile.tone}Ã¯Â¼Å’Ã©Å¸Â³Ã¨â€°Â²${profile.timbre}Ã¯Â¼Å’Ã¨Â¡Â¨Ã¨Â¾Â¾${profile.deliveryStyle}Ã£â‚¬â€š`
      : `Please speak with ${accent?.label || profile.language} guidance, ${label(profile.ageRange)} ${label(profile.genderPresentation)} voice, ${profile.tone} tone, ${label(profile.pace)} pace, ${label(profile.pitch)} pitch, ${profile.timbre} timbre, ${profile.deliveryStyle} style, and clear articulation.`;
  const reference = accent?.referenceRecommended ? " Best results require matching reference audio." : "";
  const notes = profile.extraNotes ? ` ${profile.extraNotes}` : "";
  return `${base} ${traits}${reference}${notes}<|endofprompt|>`;
}

export function buildVoiceRequestPayload(profile: VoiceDesignProfile): VoiceRequestPayload {
  const accentDialect = selectedAccent(profile);
  if (profile.model === "unnaturalvoices") {
    return {
      model: "ltx-voice",
      mode: "voice_design",
      language: "English",
      speaker: null,
      text: profile.sampleText || DEFAULT_SAMPLE_TEXT,
      prompt: profile.advancedInstructionOverride || "",
      referenceAudio: null,
      voiceDesign: { ...profile, language: "English", mode: "voice_design" },
      accentDialect: null,
    };
  }
  if (profile.model === "ltxvoice") {
    const ltxAuditionPrompt = buildLtxVoiceAuditionPrompt(profile);
    return {
      model: "ltx-voice",
      mode: "voice_design",
      language: "English",
      speaker: null,
      text: ltxSpokenLine(profile),
      prompt: ltxAuditionPrompt,
      referenceAudio: null,
      voiceDesign: { ...profile, language: "English", mode: "voice_design" },
      accentDialect,
      ltxAuditionPrompt,
    };
  }
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
  if ((profile.ageRange === "child" || profile.ageRange === "teen" || profile.ageRange === "teenager") && /\b(adult|middle aged|senior|elderly|old)\b/.test(text)) warnings.push("Extra notes mention adult/senior terms while a child or teen age range is selected.");
  const accent = selectedAccent(profile);
  if (accent?.referenceRecommended) warnings.push("This accent is prompt-guided. For best accuracy, use a matching reference voice.");
  return warnings;
}

export function accentOptionsForModel(profile: VoiceDesignProfile): VoiceDesignOption[] {
  if (profile.model === "unnaturalvoices") return [];
  if (profile.model === "ltxvoice") return [...LTX_VOICE_DIALECTS];
  if (profile.model === "qwen3tts") return [...QWEN_OFFICIAL_DIALECTS, ...PROMPT_BASED_ACCENTS];
  return profile.language === "Chinese" ? [...COSY_CHINESE_DIALECTS, ...PROMPT_BASED_ACCENTS] : PROMPT_BASED_ACCENTS;
}

export function statusForAccent(profile: VoiceDesignProfile): VoiceDesignOption | null {
  return selectedAccent(profile);
}

function ltxSpokenLine(profile: VoiceDesignProfile): string {
  const customSample = String(profile.sampleText || "").trim();
  if (customSample && !isLtxDialectSampleText(customSample)) return customSample;
  if (customSample) return customSample;
  return getLtxDialectSampleText(profile.accentDialectId);
}

function articleForLabel(label: string): "A" | "An" {
  return /^[aeiou]/i.test(label.trim()) ? "An" : "A";
}

export function buildLtxVoiceAuditionPrompt(input: Partial<VoiceDesignProfile> = {}): string {
  const profile = defaultVoiceDesignProfile({
    model: "ltxvoice",
    mode: "voice_design",
    language: "English",
    accentDialectId: DEFAULT_LTX_VOICE_DIALECT_ID,
    ...input,
  });
  const dialect = selectedAccent(profile) || LTX_VOICE_DIALECTS.find((item) => item.id === DEFAULT_LTX_VOICE_DIALECT_ID) || LTX_VOICE_DIALECTS[0];
  const dialectLabel = dialect.promptLabel || dialect.label;
  const spokenLine = ltxSpokenLine(profile);

  return [
    `${articleForLabel(dialectLabel)} ${dialectLabel} character voice is auditioning a dialect and accent showcase.`,
    `The ${label(profile.genderPresentation)} ${label(profile.ageRange)} speaker has a strong, recognizable ${dialectLabel} voice.`,
    `Voice direction: ${profile.tone} voice, ${label(profile.pace)} pace, ${label(profile.energy)} energy, ${label(profile.pitch)} pitch, ${profile.timbre} timbre, ${profile.deliveryStyle} delivery.`,
    "The voice should sound natural, clear, expressive, and emotionally alive.",
    "",
    `The ${dialectLabel} speaker clearly says exactly:`,
    `"${spokenLine}"`,
  ].join("\n");
}
