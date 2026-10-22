import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ owner: vi.fn(), gallery: vi.fn() }));
vi.mock('@/lib/ownerKey', () => ({ getOwnerContext: mock.owner, SessionInvalidError: class extends Error {} }));
vi.mock('@/app/api/gallery/delete/route', () => ({ POST: mock.gallery }));
const previous = { ...process.env };
let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-legacy-security-'));
  process.env.OTG_DATA_DIR = root; process.env.OTG_DATA_ROOT = root;
  for (const owner of ['owner_a','owner_b']) {
    fs.mkdirSync(path.join(root,'characters',owner), { recursive: true });
    fs.writeFileSync(path.join(root,'characters',owner,'fixture.wav'), 'synthetic QA');
    fs.writeFileSync(path.join(root,'characters',owner,'fixture.glb'), 'synthetic QA');
  }
});
afterAll(() => { process.env = { ...previous }; fs.rmSync(root, { recursive: true }); });
beforeEach(async () => {
  vi.clearAllMocks(); const { SessionInvalidError } = await import('@/lib/ownerKey');
  mock.owner.mockRejectedValue(new SessionInvalidError()); mock.gallery.mockResolvedValue(Response.json({ ok: true }));
});
function post(url: string, body = {}) { return new NextRequest('http://localhost:3001'+url,{method:'POST',headers:{'content-type':'application/json','x-otg-device-id':'owner_b'},body:JSON.stringify(body)}); }
describe('legacy media boundaries require the authenticated owner', () => {
  const routes: Array<[string, () => Promise<{POST: (r: NextRequest) => Promise<Response>}>]> = [
    ['Delete', () => import('@/app/api/Delete/route')],
    ['characters/voice-pack', () => import('@/app/api/characters/voice-pack/route')],
    ['characters/voice-preview', () => import('@/app/api/characters/voice-preview/route')],
    ['characters/3d-model', () => import('@/app/api/characters/3d-model/route')],
  ];
  it.each(routes)('blocks unauthenticated %s before processing', async (route, load) => {
    const module = await load();
    expect((await module.POST(post('/api/'+route))).status).toBe(401);
  });
  it('blocks unauthenticated legacy 3D downloads', async () => {
    const { GET } = await import('@/app/api/characters/3d-model/route');
    expect((await GET(new NextRequest('http://localhost:3001/api/characters/3d-model?path=fixture.glb'))).status).toBe(401);
  });
  it('cannot select another voice reference with a device header', async () => {
    mock.owner.mockResolvedValue({ ownerKey: 'owner_a' });
    const { POST } = await import('@/app/api/characters/voice-pack/route');
    expect((await POST(post('/api/characters/voice-pack',{characterId:'qa',indexVoiceReferencePath:path.join(root,'characters','owner_b','fixture.wav')}))).status).toBe(403);
  });
  it('cannot read another owner model with a path query', async () => {
    mock.owner.mockResolvedValue({ ownerKey: 'owner_a' });
    const { GET } = await import('@/app/api/characters/3d-model/route');
    const url='http://localhost:3001/api/characters/3d-model?path='+encodeURIComponent(path.join(root,'characters','owner_b','fixture.glb'));
    expect((await GET(new NextRequest(url))).status).toBe(403);
  });
  it('legacy Delete ignores worker filesystem fields and delegates only an owned Gallery name', async () => {
    mock.owner.mockResolvedValue({ ownerKey: 'owner_a' });
    const { POST } = await import('@/app/api/Delete/route');
    expect((await POST(post('/api/Delete',{filename:'qa.png',type:'../../../',subfolder:'private-user'}))).status).toBe(200);
    expect(await mock.gallery.mock.calls[0][0].json()).toEqual({name:'qa.png',deleteOriginals:false});
  });
  it('legacy Delete rejects path traversal rather than touching worker files', async () => {
    mock.owner.mockResolvedValue({ ownerKey:'owner_a' });
    const { POST } = await import('@/app/api/Delete/route');
    expect((await POST(post('/api/Delete',{filename:'../qa.png'}))).status).toBe(400); expect(mock.gallery).not.toHaveBeenCalled();
  });
  it('permits an owned voice file but not a symlink into another account', async () => {
    const { assertOwnerMediaFile } = await import('@/lib/ownerMediaAccess');
    expect(()=>assertOwnerMediaFile(path.join(root,'characters','owner_a','fixture.wav'),'owner_a')).not.toThrow();
    const link=path.join(root,'characters','owner_a','escape.wav');fs.symlinkSync(path.join(root,'characters','owner_b','fixture.wav'),link);
    expect(()=>assertOwnerMediaFile(link,'owner_a')).toThrow('Media is unavailable');
  });
});
