import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ownerKey:'qa-owner',username:'qa-owner',deviceId:'qa-device',scope:'user'}));
vi.mock('@/lib/ownerKey', () => ({getOwnerContext:async()=>auth,SessionInvalidError:class extends Error {}}));
vi.mock('@/lib/sessionUser',()=>({requireSessionUser:async()=>auth}));
let root:string;
let route:typeof import('../../../app/api/file/route');
const originalEnv={...process.env};
beforeEach(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'otg-owner-media-'));
  vi.resetModules();
  process.env.OTG_DATA_DIR=root; process.env.OTG_DATA_ROOT=root;
  process.env.OTG_PERSISTENT_DATA_ROOT=path.join(root,'persistent');
  route=await import('../../../app/api/file/route');
});
afterEach(()=>{process.env={...originalEnv};fs.rmSync(root,{recursive:true,force:true});});
function file(owner:string) { const p=path.join(root,'background_removal',owner,'portrait.png'); fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from('89504e470d0a1a0a','hex'));return p; }
function get(p:string){return route.GET(new NextRequest('http://localhost/api/file?path='+encodeURIComponent(p)));}
describe('owner-scoped saved portrait delivery',()=>{
  it('serves saved Asset candidates without widening the owner boundary',async()=>{
    const own=path.join(root,'assets-saved-for-later',auth.ownerKey,'qa.png');
    const other=path.join(root,'assets-saved-for-later','another-owner','qa.png');
    for(const p of [own,other]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from('89504e470d0a1a0a','hex'));}
    const r=await get(own);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('image/png');
    expect((await get(other)).status).toBe(404);
    const link=path.join(path.dirname(own),'escape.png');fs.symlinkSync(other,link);
    expect((await get(link)).status).toBe(404);
  });
  it('serves only the current owner dialogue output root',async()=>{
    const own=path.join(root,'production_audio_dub_previews',auth.ownerKey,'qa','result.mp4');
    const other=path.join(root,'production_audio_dub_previews','another-owner','qa','result.mp4');
    for(const p of [own,other]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'QA');}
    const response=await get(own);expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('video/mp4');
    expect((await get(other)).status).toBe(404);
  });
  it.each(['samples','outputs'])('scopes voice-library %s by the full owner prefix',async kind=>{
    const own=path.join(root,'uploads','voices',kind,auth.ownerKey+'__v_qa','reference.wav');
    const other=path.join(root,'uploads','voices',kind,'another-owner__v_qa','reference.wav');
    for(const p of [own,other]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'RIFF');}
    expect((await get(own)).status).toBe(200);expect((await get(other)).status).toBe(404);
  });
  it('does not expose a sibling owner with a similar name or the shared outputs parent',async()=>{
    for(const dir of ['qa-owner-other__v_qa','']){
      const p=path.join(root,'uploads','voices','outputs',dir,'reference.flac');
      fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fLaC');
      expect((await get(p)).status).toBe(404);
    }
  });
  it('rejects a voice-ID directory symlink into another owner namespace',async()=>{
    const parent=path.join(root,'uploads','voices','outputs');
    const other=path.join(parent,'another-owner__v_qa');
    fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'voice.flac'),'fLaC');
    const link=path.join(parent,auth.ownerKey+'__v_escape');fs.symlinkSync(other,link,'dir');
    expect((await get(path.join(link,'voice.flac'))).status).toBe(404);
  });
  it('retains owner checks for the legacy voice URL',async()=>{
    const voice=await import('@/app/api/characters/voice-file/route');
    const own=file(auth.ownerKey),other=file('another-owner');
    const request=(p:string)=>new NextRequest('http://localhost/api/characters/voice-file?path='+encodeURIComponent(path.relative(root,p)));
    expect((await voice.GET(request(own))).status).toBe(200);
    expect((await voice.GET(request(other))).status).toBe(404);
  });
  it('serves the existing background-removal portrait with image MIME',async()=>{const r=await get(file(auth.ownerKey));expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('image/png');expect((await r.arrayBuffer()).byteLength).toBe(8);});
  it('resolves a legacy data root to the same owner image',async()=>{file(auth.ownerKey);const r=await get('/var/lib/otg/data/background_removal/qa-owner/portrait.png');expect(r.status).toBe(200);});
  it('denies a different owner even when the file exists',async()=>{const r=await get(file('another-owner'));expect(r.status).toBe(404);expect(await r.text()).not.toContain(root);});
  it('denies a symlink escaping the owner directory',async()=>{const other=file('another-owner');const own=file(auth.ownerKey);const link=path.join(path.dirname(own),'escape.png');fs.symlinkSync(other,link);expect((await get(link)).status).toBe(404);});
  it('denies traversal and missing files',async()=>{file(auth.ownerKey);expect((await get(path.join(root,'background_removal','qa-owner','..','another-owner','portrait.png'))).status).toBe(404);expect((await get('background_removal/qa-owner/missing.png')).status).toBe(404);});
});
