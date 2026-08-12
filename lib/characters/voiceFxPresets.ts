export type SimpleVoiceFxSettings = {
  voiceType: "Human" | "Monster" | "Robot" | "Ghost" | "Alien" | "Creature";
  voiceSize: number;
  roughness: number;
  space: "Dry" | "Room" | "Cave" | "Void";
  transmission: "Clean" | "Radio" | "Broken" | "Glitch";
  intensity: number;
};

export type VoiceFxParam = {
  id: string;
  label: string;
  type: "slider" | "select" | "toggle";
  min?: number;
  max?: number;
  value: number | string | boolean;
  unit?: string;
  options?: string[];
};

export type VoiceFxControlGroup = {
  group: string;
  params: VoiceFxParam[];
};

export type VoiceFxChainStep = {
  effect: string;
  [key: string]: unknown;
};

export type VoiceFxPresetDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  simpleControls: Partial<SimpleVoiceFxSettings>;
  controls: VoiceFxControlGroup[];
  chain: VoiceFxChainStep[];
};

export const DEFAULT_SIMPLE_VOICE_FX: SimpleVoiceFxSettings = {
  voiceType: "Human",
  voiceSize: 50,
  roughness: 12,
  space: "Dry",
  transmission: "Clean",
  intensity: 35,
};

export const VOICE_FX_CATEGORIES = [
  "Monsters",
  "Small / Strange",
  "Sci-Fi",
  "Supernatural",
  "Creatures",
  "Utility",
] as const;

function safetyChain(): VoiceFxChainStep[] {
  return [
    { effect: "Limiter", enabled: true, ceilingDb: -1 },
    { effect: "Normalize", enabled: true, target: "voice-safe" },
  ];
}

const outputSafety: VoiceFxControlGroup = {
  group: "Output Safety",
  params: [
    { id: "compressor", label: "Compressor", type: "toggle", value: true },
    { id: "limiter", label: "Limiter", type: "toggle", value: true },
    { id: "normalize", label: "Normalize", type: "toggle", value: true },
  ],
};

export const VOICE_FX_PRESET_DEFINITIONS: VoiceFxPresetDefinition[] = [
  {
    id: "demon",
    name: "Demon",
    category: "Monsters",
    description: "A low, intimidating voice with growl, rumble, dark tone, and controlled distortion.",
    simpleControls: { voiceType: "Monster", voiceSize: 82, roughness: 72, space: "Cave", transmission: "Clean", intensity: 78 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: -8, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 88 },
        { id: "speed", label: "Speed", type: "slider", min: 70, max: 130, value: 92, unit: "%" },
      ] },
      { group: "Texture", params: [
        { id: "growl", label: "Growl", type: "slider", min: 0, max: 100, value: 78 },
        { id: "rumble", label: "Rumble", type: "slider", min: 0, max: 100, value: 65 },
      ] },
      { group: "Tone", params: [
        { id: "bass", label: "Bass", type: "slider", min: 0, max: 100, value: 80 },
        { id: "brightness", label: "Brightness", type: "slider", min: 0, max: 100, value: 25 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "distortion", label: "Distortion", type: "slider", min: 0, max: 100, value: 35 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: -8 },
      { effect: "Formant Shift", body: "large" },
      { effect: "EQ", lowBoost: true, darkTopEnd: true },
      { effect: "Growl Layer", mix: 0.55 },
      { effect: "Rumble Layer", mix: 0.45 },
      { effect: "Distortion", amount: 0.35 },
      ...safetyChain(),
    ],
  },
  {
    id: "dragon",
    name: "Dragon",
    category: "Monsters",
    description: "Huge fantasy creature voice with low pitch, large body, growl, rumble, and dark cave space.",
    simpleControls: { voiceType: "Creature", voiceSize: 95, roughness: 68, space: "Cave", transmission: "Clean", intensity: 82 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: -7, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 94 },
      ] },
      { group: "Texture", params: [
        { id: "growl", label: "Growl", type: "slider", min: 0, max: 100, value: 70 },
        { id: "rumble", label: "Rumble", type: "slider", min: 0, max: 100, value: 82 },
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 28 },
      ] },
      { group: "Tone", params: [
        { id: "bass", label: "Bass", type: "slider", min: 0, max: 100, value: 88 },
        { id: "brightness", label: "Brightness", type: "slider", min: 0, max: 100, value: 22 },
      ] },
      { group: "Space", params: [
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 58 },
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 66 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: -7 },
      { effect: "Formant Shift", body: "large" },
      { effect: "EQ", bassBoost: true, darkTopEnd: true },
      { effect: "Growl Layer", mix: 0.5 },
      { effect: "Rumble Layer", mix: 0.6 },
      { effect: "Dark Cave Reverb", size: "large" },
      ...safetyChain(),
    ],
  },
  {
    id: "giant",
    name: "Giant",
    category: "Monsters",
    description: "Massive body, slower delivery, strong bass, and broad room resonance.",
    simpleControls: { voiceType: "Monster", voiceSize: 100, roughness: 35, space: "Room", transmission: "Clean", intensity: 70 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: -9, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 100 },
        { id: "speed", label: "Speed", type: "slider", min: 70, max: 130, value: 86, unit: "%" },
      ] },
      { group: "Tone", params: [
        { id: "bass", label: "Bass", type: "slider", min: 0, max: 100, value: 90 },
        { id: "warmth", label: "Warm", type: "slider", min: 0, max: 100, value: 55 },
      ] },
      { group: "Space", params: [
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 35 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: -9 },
      { effect: "Formant Shift", body: "giant" },
      { effect: "EQ", lowShelf: "strong" },
      { effect: "Room Reverb", mix: 0.25 },
      ...safetyChain(),
    ],
  },
  {
    id: "beast",
    name: "Beast",
    category: "Monsters",
    description: "Animalistic grit with growl, rumble, reduced brightness, and strong compression.",
    simpleControls: { voiceType: "Creature", voiceSize: 78, roughness: 82, space: "Room", transmission: "Broken", intensity: 80 },
    controls: [
      { group: "Texture", params: [
        { id: "growl", label: "Growl", type: "slider", min: 0, max: 100, value: 86 },
        { id: "rumble", label: "Rumble", type: "slider", min: 0, max: 100, value: 58 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "distortion", label: "Distortion", type: "slider", min: 0, max: 100, value: 42 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Growl Layer", mix: 0.7 },
      { effect: "Rumble Layer", mix: 0.35 },
      { effect: "EQ", darkTopEnd: true },
      { effect: "Compression", mode: "strong" },
      ...safetyChain(),
    ],
  },
  {
    id: "zombie",
    name: "Zombie",
    category: "Monsters",
    description: "Slow damaged undead delivery with rasp, low-pass darkness, and unstable texture.",
    simpleControls: { voiceType: "Monster", voiceSize: 64, roughness: 88, space: "Dry", transmission: "Broken", intensity: 68 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: -3, unit: "st" },
        { id: "speed", label: "Speed", type: "slider", min: 70, max: 130, value: 84, unit: "%" },
      ] },
      { group: "Texture", params: [
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 55 },
        { id: "growl", label: "Growl", type: "slider", min: 0, max: 100, value: 45 },
      ] },
      { group: "Movement", params: [
        { id: "wobble", label: "Wobble", type: "slider", min: 0, max: 100, value: 28 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: -3 },
      { effect: "Time Stretch", speed: 0.84 },
      { effect: "Breath Layer", mix: 0.45 },
      { effect: "Pitch Wobble", amount: 0.28 },
      ...safetyChain(),
    ],
  },
  {
    id: "goblin",
    name: "Goblin",
    category: "Small / Strange",
    description: "Small sharp character voice with pitch-up, nasal tone, light distortion, and pitch wobble.",
    simpleControls: { voiceType: "Creature", voiceSize: 22, roughness: 46, space: "Dry", transmission: "Clean", intensity: 62 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: 5, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 20 },
      ] },
      { group: "Tone", params: [
        { id: "nasal", label: "Nasal / Thin", type: "slider", min: 0, max: 100, value: 72 },
      ] },
      { group: "Movement", params: [
        { id: "wobble", label: "Wobble", type: "slider", min: 0, max: 100, value: 38 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "distortion", label: "Distortion", type: "slider", min: 0, max: 100, value: 18 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: 5 },
      { effect: "Formant Shift", body: "small" },
      { effect: "Nasal EQ", amount: 0.72 },
      { effect: "Light Distortion", amount: 0.18 },
      { effect: "Pitch Wobble", amount: 0.38 },
      ...safetyChain(),
    ],
  },
  {
    id: "fairy",
    name: "Fairy",
    category: "Small / Strange",
    description: "Small bright voice with airy texture, light chorus, sparkle, and safe output control.",
    simpleControls: { voiceType: "Human", voiceSize: 18, roughness: 8, space: "Room", transmission: "Clean", intensity: 48 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: 4, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 18 },
      ] },
      { group: "Texture", params: [
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 18 },
      ] },
      { group: "Movement", params: [
        { id: "chorus", label: "Chorus", type: "slider", min: 0, max: 100, value: 34 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: 4 },
      { effect: "Formant Shift", body: "tiny" },
      { effect: "Air EQ", brightness: 0.65 },
      { effect: "Chorus", mix: 0.34 },
      ...safetyChain(),
    ],
  },
  {
    id: "gremlin",
    name: "Gremlin",
    category: "Small / Strange",
    description: "Twitchy small creature with pitch wobble, buzz, rasp, and broken texture.",
    simpleControls: { voiceType: "Creature", voiceSize: 24, roughness: 72, space: "Dry", transmission: "Broken", intensity: 74 },
    controls: [
      { group: "Texture", params: [
        { id: "buzz", label: "Buzz", type: "slider", min: 0, max: 100, value: 58 },
        { id: "static", label: "Static", type: "slider", min: 0, max: 100, value: 25 },
      ] },
      { group: "Movement", params: [
        { id: "wobble", label: "Wobble", type: "slider", min: 0, max: 100, value: 65 },
        { id: "tremolo", label: "Tremolo", type: "slider", min: 0, max: 100, value: 35 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: 3 },
      { effect: "Buzz Layer", mix: 0.58 },
      { effect: "Pitch Wobble", amount: 0.65 },
      { effect: "Tremolo", amount: 0.35 },
      ...safetyChain(),
    ],
  },
  {
    id: "robot",
    name: "Robot",
    category: "Sci-Fi",
    description: "Mechanical voice with monotone placeholder, modulation, bitcrush, telephone EQ, compressor, and limiter.",
    simpleControls: { voiceType: "Robot", voiceSize: 50, roughness: 35, space: "Dry", transmission: "Glitch", intensity: 70 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: 0, unit: "st" },
      ] },
      { group: "Movement", params: [
        { id: "tremolo", label: "Tremolo", type: "slider", min: 0, max: 100, value: 18 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "bitcrush", label: "Bitcrush", type: "slider", min: 0, max: 100, value: 46 },
        { id: "glitch", label: "Glitch", type: "slider", min: 0, max: 100, value: 24 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Flatten", mode: "monotone-placeholder" },
      { effect: "Ring Modulation", mode: "placeholder" },
      { effect: "Bitcrush", amount: 0.46 },
      { effect: "Bandpass / Telephone EQ" },
      { effect: "Compressor", mode: "medium" },
      ...safetyChain(),
    ],
  },
  {
    id: "broken_ai",
    name: "Broken AI",
    category: "Sci-Fi",
    description: "Synthetic damaged assistant voice with glitch, static, bitcrush, and unstable modulation.",
    simpleControls: { voiceType: "Robot", voiceSize: 48, roughness: 55, space: "Dry", transmission: "Glitch", intensity: 76 },
    controls: [
      { group: "Texture", params: [
        { id: "static", label: "Static", type: "slider", min: 0, max: 100, value: 38 },
        { id: "buzz", label: "Buzz", type: "slider", min: 0, max: 100, value: 42 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "glitch", label: "Glitch", type: "slider", min: 0, max: 100, value: 62 },
        { id: "bitcrush", label: "Bitcrush", type: "slider", min: 0, max: 100, value: 45 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Flatten", mode: "soft" },
      { effect: "Static Layer", mix: 0.38 },
      { effect: "Glitch Gate", amount: 0.62 },
      { effect: "Bitcrush", amount: 0.45 },
      ...safetyChain(),
    ],
  },
  {
    id: "alien",
    name: "Alien",
    category: "Sci-Fi",
    description: "Unfamiliar extraterrestrial voice with formant shift, phaser, chorus, and wide space.",
    simpleControls: { voiceType: "Alien", voiceSize: 58, roughness: 28, space: "Void", transmission: "Clean", intensity: 66 },
    controls: [
      { group: "Voice Body", params: [
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 62 },
      ] },
      { group: "Movement", params: [
        { id: "chorus", label: "Chorus", type: "slider", min: 0, max: 100, value: 46 },
        { id: "phaser", label: "Phaser", type: "slider", min: 0, max: 100, value: 52 },
      ] },
      { group: "Space", params: [
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 80 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Formant Shift", body: "otherworldly" },
      { effect: "Phaser", mix: 0.52 },
      { effect: "Chorus", mix: 0.46 },
      { effect: "Stereo Width", amount: 0.8 },
      ...safetyChain(),
    ],
  },
  {
    id: "cyborg",
    name: "Cyborg",
    category: "Sci-Fi",
    description: "Human voice with controlled machine layer, compression, light bitcrush, and clean limiter.",
    simpleControls: { voiceType: "Robot", voiceSize: 55, roughness: 28, space: "Dry", transmission: "Clean", intensity: 55 },
    controls: [
      { group: "Texture", params: [
        { id: "buzz", label: "Buzz", type: "slider", min: 0, max: 100, value: 34 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "bitcrush", label: "Bitcrush", type: "slider", min: 0, max: 100, value: 22 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Machine Layer", mix: 0.34 },
      { effect: "Bitcrush", amount: 0.22 },
      { effect: "Compressor", mode: "medium" },
      ...safetyChain(),
    ],
  },
  {
    id: "radio_comms",
    name: "Radio Comms",
    category: "Sci-Fi",
    description: "Compressed radio signal with telephone EQ, static layer, sample-rate crush, and limiter.",
    simpleControls: { voiceType: "Human", voiceSize: 50, roughness: 38, space: "Dry", transmission: "Radio", intensity: 62 },
    controls: [
      { group: "Texture", params: [
        { id: "static", label: "Static", type: "slider", min: 0, max: 100, value: 42 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "radio", label: "Radio", type: "slider", min: 0, max: 100, value: 82 },
        { id: "bitcrush", label: "Bitcrush", type: "slider", min: 0, max: 100, value: 34 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Telephone EQ", range: "300-3400Hz" },
      { effect: "Static Layer", mix: 0.42 },
      { effect: "Compression", mode: "strong" },
      { effect: "Bitcrush / Sample Rate Crush", amount: 0.34 },
      ...safetyChain(),
    ],
  },
  {
    id: "ghost",
    name: "Ghost",
    category: "Supernatural",
    description: "Breathy haunted voice with whisper layer, high-pass, reverb, reverse delay placeholder, width, and limiter.",
    simpleControls: { voiceType: "Ghost", voiceSize: 46, roughness: 24, space: "Void", transmission: "Clean", intensity: 66 },
    controls: [
      { group: "Texture", params: [
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 68 },
      ] },
      { group: "Space", params: [
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 72 },
        { id: "echo", label: "Echo", type: "slider", min: 0, max: 100, value: 38 },
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 86 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Whisper / Breath Layer", mix: 0.68 },
      { effect: "High-pass", cutoffHz: 140 },
      { effect: "Reverb", mix: 0.72 },
      { effect: "Reverse Delay", mode: "placeholder" },
      { effect: "Stereo Width", amount: 0.86 },
      ...safetyChain(),
    ],
  },
  {
    id: "spirit",
    name: "Spirit",
    category: "Supernatural",
    description: "Softer spectral voice with airy tone, chorus, wide reverb, and gentle compression.",
    simpleControls: { voiceType: "Ghost", voiceSize: 44, roughness: 12, space: "Void", transmission: "Clean", intensity: 48 },
    controls: [
      { group: "Texture", params: [
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 42 },
      ] },
      { group: "Movement", params: [
        { id: "chorus", label: "Chorus", type: "slider", min: 0, max: 100, value: 36 },
      ] },
      { group: "Space", params: [
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 58 },
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 78 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Air EQ", brightness: 0.5 },
      { effect: "Chorus", mix: 0.36 },
      { effect: "Wide Reverb", mix: 0.58 },
      ...safetyChain(),
    ],
  },
  {
    id: "possessed",
    name: "Possessed",
    category: "Supernatural",
    description: "Dual-layer unstable voice with octave shadow, tremolo, distortion, and dark space.",
    simpleControls: { voiceType: "Monster", voiceSize: 72, roughness: 70, space: "Cave", transmission: "Broken", intensity: 82 },
    controls: [
      { group: "Movement", params: [
        { id: "tremolo", label: "Tremolo", type: "slider", min: 0, max: 100, value: 48 },
        { id: "wobble", label: "Wobble", type: "slider", min: 0, max: 100, value: 42 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "distortion", label: "Distortion", type: "slider", min: 0, max: 100, value: 44 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Octave Shadow", mix: 0.45 },
      { effect: "Tremolo", amount: 0.48 },
      { effect: "Distortion", amount: 0.44 },
      { effect: "Dark Reverb", mix: 0.35 },
      ...safetyChain(),
    ],
  },
  {
    id: "void_entity",
    name: "Void Entity",
    category: "Supernatural",
    description: "Large empty-space voice with deep formant, wide reverb, low rumble, and restrained brightness.",
    simpleControls: { voiceType: "Ghost", voiceSize: 90, roughness: 40, space: "Void", transmission: "Clean", intensity: 74 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: -6, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 86 },
      ] },
      { group: "Texture", params: [
        { id: "rumble", label: "Rumble", type: "slider", min: 0, max: 100, value: 70 },
      ] },
      { group: "Space", params: [
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 82 },
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 90 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: -6 },
      { effect: "Formant Shift", body: "void" },
      { effect: "Rumble Layer", mix: 0.7 },
      { effect: "Void Reverb", mix: 0.82 },
      ...safetyChain(),
    ],
  },
  {
    id: "insectoid",
    name: "Insectoid",
    category: "Creatures",
    description: "Thin chittering creature voice with buzz, tremolo, phaser, and narrow tone.",
    simpleControls: { voiceType: "Creature", voiceSize: 35, roughness: 58, space: "Dry", transmission: "Glitch", intensity: 66 },
    controls: [
      { group: "Texture", params: [
        { id: "buzz", label: "Buzz", type: "slider", min: 0, max: 100, value: 78 },
      ] },
      { group: "Movement", params: [
        { id: "tremolo", label: "Tremolo", type: "slider", min: 0, max: 100, value: 62 },
        { id: "phaser", label: "Phaser", type: "slider", min: 0, max: 100, value: 36 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Buzz Layer", mix: 0.78 },
      { effect: "Tremolo", amount: 0.62 },
      { effect: "Phaser", mix: 0.36 },
      ...safetyChain(),
    ],
  },
  {
    id: "aquatic",
    name: "Aquatic",
    category: "Creatures",
    description: "Muffled underwater-like character with soft formant, width, chorus, and cave-like ambience.",
    simpleControls: { voiceType: "Creature", voiceSize: 55, roughness: 20, space: "Cave", transmission: "Clean", intensity: 52 },
    controls: [
      { group: "Tone", params: [
        { id: "bass", label: "Bass", type: "slider", min: 0, max: 100, value: 52 },
        { id: "brightness", label: "Brightness", type: "slider", min: 0, max: 100, value: 18 },
      ] },
      { group: "Movement", params: [
        { id: "chorus", label: "Chorus", type: "slider", min: 0, max: 100, value: 35 },
      ] },
      { group: "Space", params: [
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 58 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Muffled EQ", brightness: 0.18 },
      { effect: "Chorus", mix: 0.35 },
      { effect: "Stereo Width", amount: 0.58 },
      ...safetyChain(),
    ],
  },
  {
    id: "reptilian",
    name: "Reptilian",
    category: "Creatures",
    description: "Dry hiss-forward voice with thin brightness, breath texture, and controlled rasp.",
    simpleControls: { voiceType: "Creature", voiceSize: 50, roughness: 44, space: "Dry", transmission: "Clean", intensity: 55 },
    controls: [
      { group: "Texture", params: [
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 48 },
      ] },
      { group: "Tone", params: [
        { id: "nasal", label: "Nasal / Thin", type: "slider", min: 0, max: 100, value: 46 },
        { id: "brightness", label: "Brightness", type: "slider", min: 0, max: 100, value: 55 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Breath / Hiss Layer", mix: 0.48 },
      { effect: "Thin EQ", amount: 0.46 },
      ...safetyChain(),
    ],
  },
  {
    id: "swarm_voice",
    name: "Swarm Voice",
    category: "Creatures",
    description: "Layered many-voice creature texture with chorus, phaser, buzz, and limiter.",
    simpleControls: { voiceType: "Creature", voiceSize: 60, roughness: 70, space: "Void", transmission: "Glitch", intensity: 78 },
    controls: [
      { group: "Texture", params: [
        { id: "buzz", label: "Buzz", type: "slider", min: 0, max: 100, value: 70 },
      ] },
      { group: "Movement", params: [
        { id: "chorus", label: "Chorus", type: "slider", min: 0, max: 100, value: 80 },
        { id: "phaser", label: "Phaser", type: "slider", min: 0, max: 100, value: 45 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Multi-Voice Layer", count: "placeholder" },
      { effect: "Buzz Layer", mix: 0.7 },
      { effect: "Chorus", mix: 0.8 },
      { effect: "Phaser", mix: 0.45 },
      ...safetyChain(),
    ],
  },
  {
    id: "deep_voice",
    name: "Deep Voice",
    category: "Utility",
    description: "Clean deeper voice with low pitch, larger formant, bass support, limiter, and normalize.",
    simpleControls: { voiceType: "Human", voiceSize: 78, roughness: 10, space: "Dry", transmission: "Clean", intensity: 45 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: -4, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 72 },
      ] },
      { group: "Tone", params: [
        { id: "bass", label: "Bass", type: "slider", min: 0, max: 100, value: 62 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: -4 },
      { effect: "Formant Shift", body: "larger" },
      { effect: "EQ", bassBoost: "light" },
      ...safetyChain(),
    ],
  },
  {
    id: "high_voice",
    name: "High Voice",
    category: "Utility",
    description: "Clean higher voice with smaller formant, light brightness, limiter, and normalize.",
    simpleControls: { voiceType: "Human", voiceSize: 28, roughness: 8, space: "Dry", transmission: "Clean", intensity: 42 },
    controls: [
      { group: "Voice Body", params: [
        { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, value: 4, unit: "st" },
        { id: "formant", label: "Body Size / Formant", type: "slider", min: 0, max: 100, value: 28 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Pitch Shift", semitones: 4 },
      { effect: "Formant Shift", body: "smaller" },
      ...safetyChain(),
    ],
  },
  {
    id: "whisper",
    name: "Whisper",
    category: "Utility",
    description: "Soft whisper-like texture with breath layer, high-pass, light compression, limiter, and normalize.",
    simpleControls: { voiceType: "Human", voiceSize: 48, roughness: 22, space: "Dry", transmission: "Clean", intensity: 35 },
    controls: [
      { group: "Texture", params: [
        { id: "breath", label: "Breath", type: "slider", min: 0, max: 100, value: 72 },
      ] },
      { group: "Tone", params: [
        { id: "brightness", label: "Brightness", type: "slider", min: 0, max: 100, value: 45 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Whisper / Breath Layer", mix: 0.72 },
      { effect: "High-pass", cutoffHz: 150 },
      { effect: "Light Compression" },
      ...safetyChain(),
    ],
  },
  {
    id: "telephone",
    name: "Telephone",
    category: "Utility",
    description: "Narrow telephone-band voice with compression, optional radio noise, limiter, and normalize.",
    simpleControls: { voiceType: "Human", voiceSize: 50, roughness: 18, space: "Dry", transmission: "Radio", intensity: 44 },
    controls: [
      { group: "Damage / Degradation", params: [
        { id: "radio", label: "Radio", type: "slider", min: 0, max: 100, value: 65 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Telephone EQ", range: "300-3400Hz" },
      { effect: "Compression", mode: "medium" },
      ...safetyChain(),
    ],
  },
  {
    id: "helmet",
    name: "Helmet",
    category: "Utility",
    description: "Contained helmet comms voice with resonance, radio tone, compression, and limiter.",
    simpleControls: { voiceType: "Human", voiceSize: 55, roughness: 24, space: "Room", transmission: "Radio", intensity: 50 },
    controls: [
      { group: "Space", params: [
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 24 },
      ] },
      { group: "Damage / Degradation", params: [
        { id: "radio", label: "Radio", type: "slider", min: 0, max: 100, value: 50 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Helmet Resonance", amount: 0.35 },
      { effect: "Radio EQ", amount: 0.5 },
      { effect: "Compression", mode: "medium" },
      ...safetyChain(),
    ],
  },
  {
    id: "cave",
    name: "Cave",
    category: "Utility",
    description: "Natural cave ambience with echo, reverb, width, limiter, and normalize.",
    simpleControls: { voiceType: "Human", voiceSize: 54, roughness: 15, space: "Cave", transmission: "Clean", intensity: 48 },
    controls: [
      { group: "Space", params: [
        { id: "echo", label: "Echo", type: "slider", min: 0, max: 100, value: 44 },
        { id: "reverb", label: "Reverb", type: "slider", min: 0, max: 100, value: 62 },
        { id: "width", label: "Width", type: "slider", min: 0, max: 100, value: 52 },
      ] },
      outputSafety,
    ],
    chain: [
      { effect: "Echo", amount: 0.44 },
      { effect: "Cave Reverb", amount: 0.62 },
      { effect: "Stereo Width", amount: 0.52 },
      ...safetyChain(),
    ],
  },
];

export function voiceFxPresetsForCategory(category: string): VoiceFxPresetDefinition[] {
  return VOICE_FX_PRESET_DEFINITIONS.filter((preset) => preset.category === category);
}

export function findVoiceFxPresetDefinition(id: string): VoiceFxPresetDefinition {
  return VOICE_FX_PRESET_DEFINITIONS.find((preset) => preset.id === id) || VOICE_FX_PRESET_DEFINITIONS[0];
}
