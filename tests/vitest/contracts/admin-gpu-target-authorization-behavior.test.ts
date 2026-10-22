import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const state=vi.hoisted(()=>({admin:true}));
vi.mock('@/app/api/admin/_requireAdmin',()=>({requireAdmin:async()=>state.admin?{ok:true,status:200,email:'qa@invalid.test',username:'qa'}:{ok:false,status:403,error:'Not authorized'}}));
const original={...process.env};
beforeEach(()=>{state.admin=true;process.env.OTG_GPU_CONTROLS_ALLOWED_ORIGINS='http://localhost:3001';});
afterEach(()=>{process.env={...original};vi.unstubAllGlobals();});
function req(body:unknown){return new NextRequest('http://localhost:3001/api/admin/gpu-controls',{method:'POST',headers:{origin:'http://localhost:3001','content-type':'application/json','x-otg-gpu-control':'1'},body:JSON.stringify(body)});}
describe('GPU maintenance authorization and fixed targeting',()=>{
 it.each(['3090','5060ti'])('denies Standard-user POST for %s before contacting workers',async target=>{state.admin=false;const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {POST}=await import('@/app/api/admin/gpu-controls/route');expect((await POST(req({target,action:'reset'}))).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
 it('rejects an arbitrary target before contacting a worker',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {POST}=await import('@/app/api/admin/gpu-controls/route');expect((await POST(req({target:'arbitrary-host',action:'reset'}))).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
 it('maps 5060 reset to the fixed remote agent and keeps the credential server-side',async()=>{process.env.OTG_TEST_MAINTENANCE_5060_TOKEN='qa-unit-test-not-a-runtime-token';const fetcher=vi.fn(async()=>Response.json({ok:true,status:{host:'qa-worker',target:'5060ti'}}));vi.stubGlobal('fetch',fetcher);const {POST}=await import('@/app/api/admin/gpu-controls/route');const r=await POST(req({target:'5060ti',action:'reset'}));expect(r.status).toBe(200);expect(fetcher.mock.calls[0][0]).toBe('http://100.98.212.116:8799/maintenance');expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({action:'reset_comfy'});expect(await r.text()).not.toContain('qa-unit-test');});
 it('rejects a remote action outside the allowlist',async()=>{const {POST}=await import('@/app/api/admin/gpu-controls/route');expect((await POST(req({target:'5060ti',action:'shell'}))).status).toBe(400);});
 it('denies a Standard-user status request',async()=>{state.admin=false;const {GET}=await import('@/app/api/admin/gpu-controls/route');expect((await GET(new NextRequest('http://localhost:3001/api/admin/gpu-controls?target=5060ti'))).status).toBe(403);});
 it('describes remote service failure without misleading local sudoers instructions',async()=>{
  process.env.OTG_TEST_MAINTENANCE_5060_TOKEN='qa-unit-test-not-a-runtime-token';
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Connection refused');}));
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {const {GET}=await import('@/app/api/admin/gpu-controls/route');const r=await GET(new NextRequest('http://localhost:3001/api/admin/gpu-controls?target=5060ti'));expect(r.status).toBe(503);const body=await r.text();expect(body).toContain('remote TEST maintenance service');expect(body).not.toContain('sudoers');expect(body).not.toContain('qa-unit-test');}
  finally {log.mockRestore();}
 });
});
