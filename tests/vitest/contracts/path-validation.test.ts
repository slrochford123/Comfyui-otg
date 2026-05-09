import { describe, expect, it } from 'vitest';
import { normalizeRelativePath, resolveInsideRoot, safeFilename } from '@/lib/security/pathValidation';

describe('path validation', () => {
  it('normalizes safe relative paths', () => {
    expect(normalizeRelativePath('gallery/../image.png')).toBe('image.png');
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => normalizeRelativePath('../secret.txt')).toThrow(/traversal/i);
    expect(() => normalizeRelativePath('/etc/passwd')).toThrow(/absolute/i);
    expect(() => normalizeRelativePath('C:/secret.txt')).toThrow(/absolute Windows/i);
  });

  it('keeps resolved paths inside root', () => {
    const result = resolveInsideRoot('/tmp/otg', 'a/b.png');
    expect(result.relativePath).toBe('a/b.png');
    expect(result.absolutePath.replace(/\\/g, '/')).toContain('/tmp/otg');
  });

  it('sanitizes filenames', () => {
    expect(safeFilename('../bad file?.png')).toBe('.._bad_file_.png');
  });
});
