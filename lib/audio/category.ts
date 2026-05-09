export type AudioCategory = 'music' | 'effects' | 'voice' | 'dubbing' | 'extracted' | 'uncategorized';

const ALIASES: Record<string, AudioCategory> = {
  music: 'music',
  bgm: 'music',
  song: 'music',
  soundtrack: 'music',
  effects: 'effects',
  effect: 'effects',
  sfx: 'effects',
  sound_effects: 'effects',
  soundeffects: 'effects',
  voice: 'voice',
  vocal: 'voice',
  vocals: 'voice',
  tts: 'voice',
  narration: 'voice',
  voiceover: 'voice',
  voice_over: 'voice',
  dubbing: 'dubbing',
  dub: 'dubbing',
  voice_dubbing: 'dubbing',
  extracted: 'extracted',
  extraction: 'extracted',
  audio_extraction: 'extracted',
  uncategorized: 'uncategorized',
  other: 'uncategorized',
  misc: 'uncategorized',
};

export function normalizeAudioCategory(raw: unknown): AudioCategory {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return ALIASES[key] || 'uncategorized';
}

export function isAudioCategory(value: unknown): value is AudioCategory {
  return ['music', 'effects', 'voice', 'dubbing', 'extracted', 'uncategorized'].includes(String(value));
}
