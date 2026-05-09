import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mediaCategoryFromName, repairGalleryMetadata, scanGalleryDirectory, sidecarPathFor } from '@/lib/gallery/metadata';

describe('gallery metadata', () => {
  it('classifies media by extension', () => {
    expect(mediaCategoryFromName('a.png')).toBe('image');
    expect(mediaCategoryFromName('a.mp4')).toBe('video');
    expect(mediaCategoryFromName('a.wav')).toBe('audio');
    expect(mediaCategoryFromName('a.txt')).toBe('unknown');
  });

  it('repairs missing sidecars and detects broken/orphan sidecars', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otg-gallery-'));
    const media = path.join(dir, 'clip.mp4');
    fs.writeFileSync(media, 'video');
    fs.writeFileSync(path.join(dir, 'orphan.png.json'), '{bad');

    let scan = scanGalleryDirectory(dir);
    expect(scan.missingSidecars).toContain(media);
    expect(scan.orphanSidecars.length).toBe(1);
    expect(scan.brokenSidecars.length).toBe(1);

    const metadata = repairGalleryMetadata(media, { ownerKey: 'alice' });
    expect(metadata.ownerKey).toBe('alice');
    expect(fs.existsSync(sidecarPathFor(media))).toBe(true);

    scan = scanGalleryDirectory(dir);
    expect(scan.missingSidecars).not.toContain(media);
  });
});
