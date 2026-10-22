import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configurationPath, dataRoot, runtimePath, voicePython, qualificationEnvironment } from '@/lib/runtime/configPaths';
import { h3LoraDeletionLocation, h3LoraBackendRoot } from '@/lib/h3LoraCatalogServer';
const previous = { ...process.env };
beforeEach(() => {
  process.env.OTG_ENV = 'prod'; process.env.OTG_DATA_DIR = '/var/lib/otg';
  delete process.env.OTG_RUNTIME_ROOT; delete process.env.OTG_CONFIG_ROOT;
});
afterEach(() => { process.env = { ...previous }; });
describe('PROD paths are not TEST host paths', () => {
  it('uses stable persistent default paths', () => {
    expect(runtimePath('voice-dubbing')).toBe('/var/lib/otg/runtime/voice-dubbing');
    expect(configurationPath('moss-image-qualified.json')).toBe('/var/lib/otg/config/moss-image-qualified.json');
    expect(voicePython('voice-dubbing')).not.toMatch(/runtime\/test|shawn-rochford|C:\\/);
  });
  it('preserves deliberate runtime and configuration overrides', () => {
    process.env.OTG_RUNTIME_ROOT = '/opt/slr/runtime'; process.env.OTG_CONFIG_ROOT = '/etc/otg';
    expect(runtimePath('Applio')).toBe('/opt/slr/runtime/Applio');
    expect(configurationPath('ltx-studios-qualified.json')).toBe('/etc/otg/ltx-studios-qualified.json');
  });
  it('fails closed when a deployed process has no explicit environment', () => {
    delete process.env.OTG_ENV; process.env.NODE_ENV='production';
    expect(qualificationEnvironment()).toBeNull();
  });
  it('preserves the actual TEST runtime through explicit configuration', () => {
    process.env.OTG_ENV = 'test'; process.env.OTG_RUNTIME_ROOT = '/srv/slr-test';
    expect(runtimePath('voice-dubbing')).toBe('/srv/slr-test/voice-dubbing');
    expect(dataRoot()).toBe('/var/lib/otg');
  });
  it('does not leave developer TEST filesystem defaults in critical consumers', () => {
    for (const f of ['app/api/admin/gpu-controls/route.ts','lib/images/mossQualification.ts','app/api/ltx-studios/catalog/route.ts','app/api/voice/dub/route.ts','app/api/production/audio/analyze-clip/route.ts','lib/workers/voiceGpuFileLease.ts','lib/h3LoraCatalogServer.ts','app/api/background-angle-plate/route.ts','app/api/edit-video/swap-characters/submit/route.ts']) {
      const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(text, f).not.toContain('/home/shawn-rochford/');
    }
  });
  it.each(['rtx3090', 'rtx5060ti'] as const)('never infers local LoRA deletion for %s', backend => {
    delete process.env.OTG_H3_LORA_LOCAL_BACKEND;
    expect(() => h3LoraDeletionLocation(backend)).toThrow('local H3 LoRA backend');
  });
  it('routes PROD LoRA deletion independently from the logical GPU name', () => {
    process.env.OTG_H3_LORA_LOCAL_BACKEND='rtx5060ti';
    process.env.OTG_H3_RTX3090_SSH_HOST='prod-3090-dependency-host';
    expect(h3LoraDeletionLocation('rtx3090')).toEqual({kind:'remote',host:'prod-3090-dependency-host'});
    expect(h3LoraDeletionLocation('rtx5060ti')).toEqual({kind:'local'});
    process.env.OTG_H3_LORA_LOCAL_BACKEND='rtx3090';
    process.env.OTG_H3_RTX5060TI_SSH_HOST='test-5060-dependency-host';
    expect(h3LoraDeletionLocation('rtx3090')).toEqual({kind:'local'});
    expect(h3LoraDeletionLocation('rtx5060ti')).toEqual({kind:'remote',host:'test-5060-dependency-host'});
  });
  it('rejects absent or option-shaped LoRA SSH aliases and has no TEST home default', () => {
    process.env.OTG_H3_LORA_LOCAL_BACKEND='rtx5060ti';
    delete process.env.OTG_H3_RTX3090_SSH_HOST;
    expect(() => h3LoraDeletionLocation('rtx3090')).toThrow('remote H3 LoRA host');
    process.env.OTG_H3_RTX3090_SSH_HOST='-oProxyCommand=unsafe';
    expect(() => h3LoraDeletionLocation('rtx3090')).toThrow('remote H3 LoRA host');
    delete process.env.OTG_H3_LORA_ROOT_RTX3090;
    expect(h3LoraBackendRoot('rtx3090')).toBe('/opt/slr-studios/workers/3090/models/loras/MiniMax-H3');
  });
  it('does not mislabel a generic local Gallery output as the 3090 source', async () => {
    delete process.env.OTG_ADMIN_GALLERY_3090_ROOT;
    delete process.env.OTG_ADMIN_GALLERY_3090_URL;
    process.env.OTG_COMFY_OUTPUT_DIR='/var/lib/otg/comfy-5060-output';
    const {resolveLocalAdminGalleryFile}=await import('@/lib/adminGallerySources');
    await expect(resolveLocalAdminGalleryFile('comfy-3090','qa.png')).rejects.toThrow('not configured');
  });
  it('never accepts a TEST proof as PROD MOSS qualification', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-proof-'));
    process.env.OTG_MOSS_QUALIFICATION_FILE = path.join(root, 'proof.json');
    const { mossWorkflowFingerprint, mossPhysicallyQualified } = await import('@/lib/images/mossQualification');
    const record = { environment: 'test', targets: { '3090': { fingerprint: mossWorkflowFingerprint('3090'), androidPreview: true, promptId: 'synthetic-proof' } } };
    fs.writeFileSync(process.env.OTG_MOSS_QUALIFICATION_FILE, JSON.stringify(record));
    expect(mossPhysicallyQualified('3090')).toBe(false);
    process.env.OTG_ENV = 'test'; expect(mossPhysicallyQualified('3090')).toBe(true);
    fs.rmSync(root, { recursive: true });
  });
});
