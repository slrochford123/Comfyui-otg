import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_H3_STUDIO_PLAN, H3_STUDIO_WORKFLOWS, automaticH3Plan, parseH3StudioPlan, type H3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { H3_STUDIO_ASSET_FIELDS } from "@/lib/h3StudioIdentity";
import { inspectH3StudioInventory, matchesH3StudioInventoryAsset, readH3StudioEvidence, type H3StudioInventory } from "@/lib/h3StudioRegistry";
import { h3CandidateBackends, parseH3TargetBackend } from "@/lib/h3GpuRouting";
import { assertH3PlannerCapabilityIdentity, h3PlannerSchema } from "@/lib/h3StudioPlanner";
import { parseSimpleVideoEdit } from "@/lib/h3SimpleVideoEdit";
const base = { ...DEFAULT_H3_STUDIO_PLAN, prompt: "A test kite", originalPrompt: "A test kite" };
function installed(plan: H3StudioPlan): H3StudioInventory {
  const graph = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: new Date().toISOString() }, null).graph;
  const files = Object.values(graph).flatMap(n => H3_STUDIO_ASSET_FIELDS[n.class_type] ? [String(n.inputs[H3_STUDIO_ASSET_FIELDS[n.class_type]])] : []);
  return { backend: plan.backend, nodes: new Set(Object.values(graph).map(n => n.class_type)), models: new Set([String(graph['30'].inputs.unet_name)]), files: new Set(files), loras: new Set(files), observedAt: new Date().toISOString(),
    device: { gpuName: plan.backend === 'rtx5060ti' ? 'NVIDIA GeForce RTX 5060 Ti' : 'NVIDIA GeForce RTX 3090', totalVramBytes: 16 * 1024 ** 3, freeVramBytes: 1024 ** 3, totalRamBytes: 64 * 1024 ** 3, observedAt: new Date().toISOString() } };
}
beforeEach(() => vi.stubEnv('OTG_ENV', 'prod'));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('H3 explicitly selected dual-GPU architecture', () => {
  it.each(['rtx3090', 'rtx5060ti'] as const)('compiles every Auto/Manual workflow, MP size and orientation for %s', backend => {
    for (const workflow of H3_STUDIO_WORKFLOWS) for (const quality of ['0.2','0.6','1'] as const) for (const orientation of ['landscape','portrait'] as const) {
      const plan = automaticH3Plan({ ...base, backend, workflowId: workflow.id, quality, orientation });
      const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), installed(plan), null);
      expect(result.manifest.executable).toBe(true);expect(result.manifest.gpu).toBe(backend);
      expect(result.graph['24'].inputs.steps).toBe(8);
      if (workflow.id === 'native-r2v') {
        expect(result.graph['omni_vsa'].inputs.selection).toBe('vsa'); expect(result.graph['36']).toBeUndefined();
      } else {
        expect(result.graph['41'].inputs.enabled).toBe(true);
        expect(String(result.graph['36'].inputs.lora_name)).toMatch(workflow.family === 'Ref2VA' ? /ref2v_turbo_8step/ : /fl2v_turbo_8step/);
      }
    }
  });
  it('never interprets web-host identity as the requested GPU or silently switches', () => {
    const plan = automaticH3Plan({ ...base, backend: 'rtx5060ti' });const inv = installed(plan);
    inv.device!.gpuName = 'NVIDIA GeForce RTX 3090';
    expect(compileH3StudioPlan(plan,h3StudioPreviewInput(plan),inv,null).manifest.blockedReasons).toContain('LIVE_5060TI_CAPACITY_CHECK_REQUIRED');
    expect(() => compileH3StudioPlan(plan,{ ...h3StudioPreviewInput(plan),backend:'rtx3090' },inv,null)).toThrow(/No fallback/);
    expect(() => compileH3StudioPlan(plan,h3StudioPreviewInput(plan),{ ...inv,backend:'rtx3090' },null)).toThrow();
  });
  it('keeps exact target in request and qualification identities', () => {
    const a = automaticH3Plan(base), b = { ...a,backend:'rtx5060ti' as const };
    expect(compileH3StudioPlan(a,h3StudioPreviewInput(a),installed(a),null).manifest.qualificationFingerprint).not.toBe(compileH3StudioPlan(b,h3StudioPreviewInput(b),installed(b),null).manifest.qualificationFingerprint);
    expect(() => parseH3StudioPlan({ ...base,backend:undefined })).toThrow();
    const old = { ...base };delete old.backend;expect(parseH3StudioPlan(old).backend).toBe('rtx3090');
  });
  it.each(['http://arbitrary:8188','auto','local','rtx5090',null])('rejects arbitrary targets %s', backend => {
    expect(() => parseH3TargetBackend(backend)).toThrow();expect(() => parseH3StudioPlan({ ...base,backend })).toThrow();
  });
  it('pins legacy, Realism, swap and Ref Mods selections but preserves old unpinned jobs', () => {
    const targets = ['rtx3090','rtx5060ti'] as const;
    expect(h3CandidateBackends('rtx5060ti',targets)).toEqual(['rtx5060ti']);expect(h3CandidateBackends(undefined,targets)).toEqual(targets);
    expect(h3CandidateBackends('rtx3090',['rtx3090-comfy-kitchen','rtx5060ti'],id => id === 'rtx5060ti' ? 'rtx5060ti' : 'rtx3090')).toEqual(['rtx3090-comfy-kitchen']);
  });
  it('makes source edit retries target-specific without adding duration or approval controls', () => {
    const a = parseSimpleVideoEdit({ sourceId:'11111111-1111-1111-1111-111111111111',prompt:'Change the lighting',quality:'0.2',requestId:'fixture-request',backend:'rtx3090' });
    const { requestFingerprint: _fingerprint,...request } = a;
    const b = parseSimpleVideoEdit({ ...request,backend:'rtx5060ti' });
    expect(a.requestFingerprint).not.toBe(b.requestFingerprint);
  });
  it('binds the OpenAI strict capability schema to the selected GPU without a paid call', () => {
    const plan = automaticH3Plan({ ...base,backend:'rtx5060ti' });const capability = { id:'installed-5060',plan,qualificationFingerprint:'a'.repeat(64),installedWorkflow:true };
    const schema = h3PlannerSchema([capability],plan.originalPrompt);
    expect(schema.properties.plan.anyOf[0].properties.backend).toEqual({ type:'string',enum:['rtx5060ti'] });
    expect(() => assertH3PlannerCapabilityIdentity({ ...plan,backend:'rtx3090' },[capability])).toThrow();
  });
  it('queries only the selected fixed worker, not both or a client-supplied address', async () => {
    const fetcher = vi.fn(async (url:string) => Response.json(url.endsWith('object_info') ? {} : { devices:[{ name:'RTX 5060 Ti',vram_total:16 * 1024 ** 3,vram_free:1024 ** 3 }],system:{ ram_total:64 * 1024 ** 3 } }));
    vi.stubGlobal('fetch',fetcher);const inventory = await inspectH3StudioInventory(undefined,'rtx5060ti');
    expect(inventory.backend).toBe('rtx5060ti');expect(inventory.device!.gpuName).toBe('RTX 5060 Ti');
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('http://100.98.212.116:8188/'))).toBe(true);
    expect(readH3StudioEvidence('rtx5060ti')).toBeNull();
  });
  it('requires a fresh remote file identity check, not a manually refreshed installation timestamp', () => {
    const asset = { filename:'fixture',bytes:42,sha256:'a'.repeat(64) };
    const inv:H3StudioInventory = { backend:'rtx5060ti',nodes:new Set(),models:new Set(),loras:new Set(),observedAt:new Date().toISOString(),assets:{ fixture:asset } };
    expect(matchesH3StudioInventoryAsset(inv,'fixture',42)).toBe(false);
    inv.remoteAssetVerification = { backend:'rtx5060ti',hashesVerified:true,checkedAt:new Date().toISOString() };
    expect(matchesH3StudioInventoryAsset(inv,'fixture',42)).toBe(false);
    inv.remoteAssetVerification.verifiedFiles = ['fixture'];
    expect(matchesH3StudioInventoryAsset(inv,'fixture',42)).toBe(true);
    inv.remoteAssetVerification.checkedAt = new Date(Date.now()-25*60*60_000).toISOString();expect(matchesH3StudioInventoryAsset(inv,'fixture',42)).toBe(false);
  });
});
