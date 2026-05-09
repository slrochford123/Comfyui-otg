import { describe, expect, it } from 'vitest';
import { normalizeAudioCategory } from '@/lib/audio/category';

describe('audio category normalization', () => {
  it('normalizes common aliases', () => {
    expect(normalizeAudioCategory('SFX')).toBe('effects');
    expect(normalizeAudioCategory('voice over')).toBe('voice');
    expect(normalizeAudioCategory('BGM')).toBe('music');
    expect(normalizeAudioCategory('audio-extraction')).toBe('extracted');
  });

  it('falls back to uncategorized', () => {
    expect(normalizeAudioCategory('???')).toBe('uncategorized');
  });
});
