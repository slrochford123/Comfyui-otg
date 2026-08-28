/* OTG_VOICE_EFFECTS_BACKEND_P1 */

export type VoiceEffectCategory =
  | "space_distance"
  | "machine_digital"
  | "creature_alien";

export type VoiceEffectIntensity = "subtle" | "medium" | "strong";

export type VoiceEffectPreset = {
  id: string;
  label: string;
  category: VoiceEffectCategory;
  description: string;
  preferredEngine: "ffmpeg" | "pedalboard" | "rubberband";
  filterByIntensity: Record<VoiceEffectIntensity, string>;
};

export const VOICE_EFFECT_CATEGORIES: Array<{
  id: VoiceEffectCategory;
  label: string;
  description: string;
}> = [
  {
    id: "space_distance",
    label: "Space / Distance",
    description: "Echo, distance, room, cave, radio, dream, and underwater style voice placement.",
  },
  {
    id: "machine_digital",
    label: "Machine / Digital",
    description: "Robot, broken robot, glitch, bitcrush, circuit buzz, and synthetic machine effects.",
  },
  {
    id: "creature_alien",
    label: "Creature / Alien",
    description: "Monster, demon, alien, tiny creature, kraken, and mutant modulation effects.",
  },
];

export const VOICE_EFFECT_PRESETS: readonly VoiceEffectPreset[] = [
  {
    id: "far_away_voice",
    label: "Far Away Voice",
    category: "space_distance",
    description: "Makes the voice sound distant, thinner, and slightly echoing.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "highpass=f=180,lowpass=f=6200,aecho=0.8:0.22:90:0.18,volume=-1.5dB,loudnorm=I=-18:TP=-1.5:LRA=12",
      medium: "highpass=f=220,lowpass=f=5200,aecho=0.8:0.30:140:0.28,volume=-2.5dB,loudnorm=I=-19:TP=-1.5:LRA=13",
      strong: "highpass=f=260,lowpass=f=4200,aecho=0.8:0.42:220:0.38,volume=-4dB,loudnorm=I=-20:TP=-1.5:LRA=14",
    },
  },
  {
    id: "cave_echo",
    label: "Cave Echo",
    category: "space_distance",
    description: "Large echo and low resonance for cave or tunnel voices.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "bass=g=2:f=120,aecho=0.8:0.35:120:0.25,loudnorm=I=-17:TP=-1.5:LRA=12",
      medium: "bass=g=4:f=110,aecho=0.8:0.48:180|260:0.32|0.18,loudnorm=I=-18:TP=-1.5:LRA=13",
      strong: "bass=g=6:f=95,aecho=0.8:0.60:240|420:0.42|0.25,loudnorm=I=-19:TP=-1.5:LRA=14",
    },
  },
  {
    id: "haunted_room",
    label: "Haunted Room",
    category: "space_distance",
    description: "Thin ghostly room echo with tremolo instability.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "highpass=f=240,lowpass=f=5000,aecho=0.8:0.35:80:0.22,tremolo=f=4:d=0.18,loudnorm=I=-17:TP=-1.5:LRA=12",
      medium: "highpass=f=280,lowpass=f=4200,aecho=0.8:0.48:90|160:0.30|0.18,tremolo=f=5:d=0.30,loudnorm=I=-18:TP=-1.5:LRA=13",
      strong: "highpass=f=320,lowpass=f=3600,aecho=0.8:0.58:110|220:0.38|0.24,tremolo=f=6:d=0.42,loudnorm=I=-19:TP=-1.5:LRA=14",
    },
  },
  {
    id: "old_radio_distance",
    label: "Old Radio Distance",
    category: "space_distance",
    description: "Band-limited old radio voice with crackly crushed texture.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "highpass=f=280,lowpass=f=3800,equalizer=f=1200:t=q:w=1:g=4,acrusher=bits=12:mix=0.10,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "highpass=f=320,lowpass=f=3200,equalizer=f=1200:t=q:w=1:g=6,acrusher=bits=10:mix=0.18,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "highpass=f=380,lowpass=f=2600,equalizer=f=1000:t=q:w=1:g=8,acrusher=bits=8:mix=0.28,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
  {
    id: "dream_reverb",
    label: "Dream Reverb",
    category: "space_distance",
    description: "Soft dreamy echo with mild chorus movement.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "chorus=0.35:0.55:35:0.20:0.25:1.2,aecho=0.8:0.22:90:0.15,loudnorm=I=-17:TP=-1.5:LRA=12",
      medium: "chorus=0.45:0.65:40|55:0.25|0.18:0.30|0.38:1.4|1.7,aecho=0.8:0.30:130:0.24,loudnorm=I=-18:TP=-1.5:LRA=13",
      strong: "chorus=0.55:0.75:45|65|90:0.32|0.24|0.18:0.35|0.45|0.55:1.6|1.9|2.2,aecho=0.8:0.42:180:0.34,loudnorm=I=-18:TP=-1.5:LRA=14",
    },
  },
  {
    id: "underwater_distance",
    label: "Underwater Distance",
    category: "space_distance",
    description: "Muffled, low, wavy underwater distance effect.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "lowpass=f=3600,highpass=f=90,aphaser=in_gain=0.7:out_gain=0.8:delay=3:decay=0.35:speed=0.4,loudnorm=I=-17:TP=-1.5:LRA=12",
      medium: "lowpass=f=2500,highpass=f=80,aphaser=in_gain=0.7:out_gain=0.8:delay=4:decay=0.45:speed=0.55,aecho=0.8:0.25:80:0.18,loudnorm=I=-18:TP=-1.5:LRA=13",
      strong: "lowpass=f=1800,highpass=f=70,aphaser=in_gain=0.8:out_gain=0.8:delay=5:decay=0.55:speed=0.7,aecho=0.8:0.35:120:0.25,loudnorm=I=-19:TP=-1.5:LRA=14",
    },
  },

  {
    id: "clean_robot",
    label: "Clean Robot",
    category: "machine_digital",
    description: "Synthetic robot tone without heavy damage.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "afftfilt=real='hypot(re,im)*cos(0)':imag='hypot(re,im)*sin(0)',chorus=0.35:0.55:35:0.18:0.25:1.2,acompressor,loudnorm=I=-16:TP=-1.5:LRA=9",
      medium: "afftfilt=real='hypot(re,im)*cos(0)':imag='hypot(re,im)*sin(0)',chorus=0.45:0.65:35|55:0.22|0.18:0.25|0.35:1.4|1.8,acompressor,loudnorm=I=-16:TP=-1.5:LRA=9",
      strong: "afftfilt=real='hypot(re,im)*cos(0)':imag='hypot(re,im)*sin(0)',chorus=0.55:0.75:30|50|70:0.30|0.24|0.18:0.25|0.35|0.45:1.5|1.9|2.3,acompressor,loudnorm=I=-16:TP=-1.5:LRA=9",
    },
  },
  {
    id: "broken_robot",
    label: "Broken Robot",
    category: "machine_digital",
    description: "Damaged robot with bitcrush and choppy modulation.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "acrusher=bits=10:mix=0.18,tremolo=f=12:d=0.22,highpass=f=120,lowpass=f=7000,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "acrusher=bits=8:mix=0.32,tremolo=f=18:d=0.38,highpass=f=150,lowpass=f=6000,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "acrusher=bits=6:mix=0.48,tremolo=f=24:d=0.55,highpass=f=180,lowpass=f=5000,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
  {
    id: "buzzing_circuit",
    label: "Buzzing Circuit",
    category: "machine_digital",
    description: "Electrical buzz and circuit-like vibration.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "acrusher=bits=10:mix=0.16,tremolo=f=22:d=0.20,highpass=f=140,lowpass=f=6500,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "acrusher=bits=8:mix=0.28,tremolo=f=28:d=0.35,highpass=f=160,lowpass=f=5600,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "acrusher=bits=6:mix=0.42,tremolo=f=34:d=0.50,highpass=f=180,lowpass=f=4700,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
  {
    id: "glitching_cyborg",
    label: "Glitching Cyborg",
    category: "machine_digital",
    description: "Half-human, half-machine glitch effect.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "acrusher=bits=11:mix=0.14,vibrato=f=5:d=0.18,tremolo=f=9:d=0.18,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "acrusher=bits=9:mix=0.26,vibrato=f=6:d=0.32,tremolo=f=14:d=0.30,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "acrusher=bits=7:mix=0.40,vibrato=f=7:d=0.48,tremolo=f=19:d=0.45,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
  {
    id: "war_machine",
    label: "War Machine",
    category: "machine_digital",
    description: "Heavy metallic command voice.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "asetrate=44100*0.92,aresample=44100,atempo=1.087,bass=g=3:f=95,acrusher=bits=13:mix=0.12,acompressor=threshold=0.16:ratio=2.2,loudnorm=I=-16:TP=-1.5:LRA=9",
      medium: "asetrate=44100*0.84,aresample=44100,atempo=1.19,bass=g=5:f=90,acrusher=bits=11:mix=0.20,acompressor=threshold=0.13:ratio=3,loudnorm=I=-16:TP=-1.5:LRA=9",
      strong: "asetrate=44100*0.76,aresample=44100,atempo=1.315,bass=g=7:f=85,acrusher=bits=9:mix=0.30,acompressor=threshold=0.10:ratio=4,loudnorm=I=-17:TP=-1.5:LRA=10",
    },
  },
  {
    id: "bitcrushed_toy",
    label: "Bitcrushed Toy",
    category: "machine_digital",
    description: "Small digital toy voice effect.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "asetrate=44100*1.08,aresample=44100,atempo=0.926,acrusher=bits=10:mix=0.16,treble=g=2:f=6000,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "asetrate=44100*1.18,aresample=44100,atempo=0.847,acrusher=bits=8:mix=0.30,treble=g=4:f=6000,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "asetrate=44100*1.32,aresample=44100,atempo=0.758,acrusher=bits=6:mix=0.45,treble=g=5:f=6500,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },

  {
    id: "alien_modulation",
    label: "Alien Modulation",
    category: "creature_alien",
    description: "Strange alien vibrato, tremolo, and chorus movement.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "vibrato=f=5:d=0.25,tremolo=f=8:d=0.20,chorus=0.35:0.55:35:0.18:0.25:1.3,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "vibrato=f=7:d=0.45,tremolo=f=11:d=0.35,chorus=0.45:0.65:40|55:0.25|0.20:0.30|0.42:1.6|2.0,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "vibrato=f=9:d=0.65,tremolo=f=14:d=0.50,chorus=0.55:0.75:35|55|75:0.34|0.26|0.20:0.35|0.50|0.62:1.7|2.1|2.5,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
  {
    id: "demonic_distortion",
    label: "Demonic Distortion",
    category: "creature_alien",
    description: "Lower, darker, gritty demonic voice.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "asetrate=44100*0.90,aresample=44100,atempo=1.111,bass=g=3:f=100,acrusher=bits=13:mix=0.12,acompressor=threshold=0.15:ratio=2.5,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "asetrate=44100*0.82,aresample=44100,atempo=1.22,bass=g=5:f=90,acrusher=bits=11:mix=0.24,acompressor=threshold=0.12:ratio=3.5,loudnorm=I=-17:TP=-1.5:LRA=11",
      strong: "asetrate=44100*0.74,aresample=44100,atempo=1.351,bass=g=8:f=80,acrusher=bits=9:mix=0.38,acompressor=threshold=0.09:ratio=4.5,loudnorm=I=-18:TP=-1.5:LRA=12",
    },
  },
  {
    id: "monster_deep_voice",
    label: "Monster Deep Voice",
    category: "creature_alien",
    description: "Large deep monster voice with heavy low body.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "asetrate=44100*0.88,aresample=44100,atempo=1.136,bass=g=4:f=95,lowpass=f=9000,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "asetrate=44100*0.76,aresample=44100,atempo=1.315,bass=g=7:f=85,lowpass=f=8000,acompressor=threshold=0.14:ratio=2.5,loudnorm=I=-17:TP=-1.5:LRA=11",
      strong: "asetrate=44100*0.66,aresample=44100,atempo=1.515,bass=g=10:f=75,lowpass=f=7000,acompressor=threshold=0.11:ratio=3.4,loudnorm=I=-18:TP=-1.5:LRA=12",
    },
  },
  {
    id: "tiny_creature",
    label: "Tiny Creature",
    category: "creature_alien",
    description: "Higher, smaller, faster creature voice.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "asetrate=44100*1.12,aresample=44100,atempo=0.893,treble=g=2:f=6500,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "asetrate=44100*1.25,aresample=44100,atempo=0.80,treble=g=4:f=6500,acompressor=threshold=0.16:ratio=2,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "asetrate=44100*1.42,aresample=44100,atempo=0.704,treble=g=5:f=7000,acrusher=bits=12:mix=0.10,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
  {
    id: "kraken_underwater_beast",
    label: "Kraken / Underwater Beast",
    category: "creature_alien",
    description: "Deep underwater monster voice.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "asetrate=44100*0.88,aresample=44100,atempo=1.136,bass=g=5:f=80,lowpass=f=4200,aphaser=in_gain=0.7:out_gain=0.8:delay=3:decay=0.35:speed=0.4,loudnorm=I=-17:TP=-1.5:LRA=11",
      medium: "asetrate=44100*0.78,aresample=44100,atempo=1.282,bass=g=8:f=70,lowpass=f=3200,aphaser=in_gain=0.7:out_gain=0.8:delay=4:decay=0.48:speed=0.55,aecho=0.8:0.25:90:0.18,loudnorm=I=-18:TP=-1.5:LRA=12",
      strong: "asetrate=44100*0.68,aresample=44100,atempo=1.471,bass=g=11:f=60,lowpass=f=2400,aphaser=in_gain=0.8:out_gain=0.8:delay=5:decay=0.60:speed=0.7,aecho=0.8:0.35:150:0.25,loudnorm=I=-19:TP=-1.5:LRA=13",
    },
  },
  {
    id: "wah_wah_mutant",
    label: "Wah-Wah Mutant",
    category: "creature_alien",
    description: "Mutant voice with moving filter and modulation.",
    preferredEngine: "ffmpeg",
    filterByIntensity: {
      subtle: "tremolo=f=2.2:d=0.20,aphaser=in_gain=0.7:out_gain=0.8:delay=3:decay=0.30:speed=0.5,chorus=0.35:0.55:35:0.15:0.20:1.2,loudnorm=I=-16:TP=-1.5:LRA=10",
      medium: "tremolo=f=2.8:d=0.35,aphaser=in_gain=0.7:out_gain=0.8:delay=4:decay=0.42:speed=0.7,chorus=0.45:0.65:35|50:0.22|0.18:0.28|0.38:1.4|1.8,loudnorm=I=-16:TP=-1.5:LRA=10",
      strong: "tremolo=f=3.4:d=0.50,aphaser=in_gain=0.8:out_gain=0.8:delay=5:decay=0.55:speed=0.9,chorus=0.55:0.75:30|48|70:0.30|0.22|0.18:0.32|0.45|0.58:1.6|2.0|2.4,loudnorm=I=-17:TP=-1.5:LRA=11",
    },
  },
] as const;

export function findVoiceEffectPreset(effectId: string): VoiceEffectPreset | null {
  return VOICE_EFFECT_PRESETS.find((preset) => preset.id === effectId) ?? null;
}

export function getVoiceEffectFilter(effectId: string, intensity: VoiceEffectIntensity): string | null {
  return findVoiceEffectPreset(effectId)?.filterByIntensity[intensity] ?? null;
}

export function isVoiceEffectIntensity(value: unknown): value is VoiceEffectIntensity {
  return value === "subtle" || value === "medium" || value === "strong";
}