import { randomBytes } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ admin: true, status: 403 }));
vi.mock('@/app/api/admin/_requireAdmin', () => ({ requireAdmin: async () => state.admin ? { ok: true, username: 'qa' } : { ok: false, status: state.status, error: 'Not authorized' } }));
// Actual PROD topology: web process is on the 5060 host, not the 3090 host.
vi.mock('node:os', () => ({ hostname: () => 'slr-5060-web-host' }));
const original = { ...process.env };
beforeEach(() => {
  state.admin = true; state.status = 403;
  process.env.OTG_ENV = 'test'; process.env.OTG_GPU_CONTROLS_ENABLED = '1';
  process.env.OTG_GPU_CONTROLS_ALLOWED_ORIGINS = 'http://localhost:3001';
  for (const env of ['TEST', 'PROD']) for (const target of ['3090', '5060TI']) {
    process.env[`OTG_MAINTENANCE_${env}_${target}_URL`] = `http://${env.toLowerCase()}-${target.toLowerCase()}.invalid:8801/maintenance`;
    process.env[`OTG_MAINTENANCE_${env}_${target}_TOKEN`] = randomBytes(48).toString('hex');
    delete process.env[`OTG_MAINTENANCE_${env}_${target}_TOKEN_FILE`];
  }
});
afterEach(() => { process.env = { ...original }; vi.unstubAllGlobals(); });
function req(body: unknown) {
  return new NextRequest('http://localhost:3001/api/admin/gpu-controls', { method: 'POST', headers: { origin: 'http://localhost:3001', 'content-type': 'application/json', 'x-otg-gpu-control': '1' }, body: JSON.stringify(body) });
}
function result(input: any) {
  return { ok: true, ...input, status: { host: input.target === '3090' ? 'gpu-3090-host' : 'gpu-5060-host',
    services: { comfy8188: { state: 'active', http: 'ready' }, h38189: input.target === '3090' ? { state: 'active', http: 'ready' } : { state: 'not-installed', http: 'not-applicable' } },
    gpu: { name: input.target === '3090' ? 'NVIDIA RTX 3090' : 'NVIDIA RTX 5060 Ti', usedMiB: 500, totalMiB: 24000 } } };
}
describe('host-independent maintenance authorization and routing', () => {
  it.each(['3090', '5060ti'])('denies Standard user for %s before worker access', async target => {
    state.admin = false; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    expect((await POST(req({ target, action: 'reset' }))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies unauthenticated status', async () => {
    state.admin = false; state.status = 401;
    const { GET } = await import('@/app/api/admin/gpu-controls/route');
    expect((await GET(new NextRequest('http://localhost:3001/api/admin/gpu-controls?target=3090'))).status).toBe(401);
  });
  it.each([['test', '3090'], ['test', '5060ti'], ['prod', '3090'], ['prod', '5060ti']])('%s %s uses only its explicitly configured endpoint', async (environment, target) => {
    process.env.OTG_ENV = environment;
    const fetcher = vi.fn(async (_url: any, options: any) => Response.json(result(JSON.parse(options.body))));
    vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    const response = await POST(req({ target, action: 'reset' }));
    expect(response.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`http://${environment}-${target}.invalid:8801/maintenance`);
    expect(JSON.parse(options.body)).toMatchObject({ target, environment, action: 'reset_comfy' });
    const token = process.env[`OTG_MAINTENANCE_${environment.toUpperCase()}_${target.toUpperCase()}_TOKEN`];
    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(await response.text()).not.toContain(token!);
  });
  it.each([{ target: 'arbitrary-host', action: 'reset' }, { target: '3090', action: 'shell' }, { target: '3090', action: 'reset', service: 'arbitrary' }])('rejects arbitrary target/action/service', async body => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    expect((await POST(req(body))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it('never falls back to TEST credentials or local helpers in PROD', async () => {
    process.env.OTG_ENV = 'prod'; delete process.env.OTG_MAINTENANCE_PROD_3090_TOKEN;
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    expect((await POST(req({ target: '3090', action: 'reset' }))).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses an authenticated worker with the wrong target identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, o: any) => Response.json(result({ ...JSON.parse(o.body), target: '5060ti' }))));
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    expect((await POST(req({ target: '3090', action: 'reset' }))).status).toBe(503);
  });
  it('does not echo private upstream failures', async () => {
    const token = process.env.OTG_MAINTENANCE_TEST_3090_TOKEN!;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: token }, { status: 401 })));
    const { POST } = await import('@/app/api/admin/gpu-controls/route'); const r = await POST(req({ target: '3090', action: 'reset' }));
    expect(r.status).toBe(503); expect(await r.text()).not.toContain(token);
  });
  it('refuses busy workers without a second endpoint call', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false }, { status: 409 })); vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    expect((await POST(req({ target: '3090', action: 'reset' }))).status).toBe(409); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['reset', 'inactive', 'ready'],
    ['free', 'failed', 'offline'],
    ['free', 'inactive', 'unmanaged'],
  ])('does not report %s success with contradictory worker state %s/%s', async (action, workerState, http) => {
    vi.stubGlobal('fetch', vi.fn(async (_u, options: any) => {
      const body=result(JSON.parse(options.body));
      body.status.services.comfy8188={state:workerState,http};
      return Response.json(body);
    }));
    const {POST}=await import('@/app/api/admin/gpu-controls/route');
    expect((await POST(req({target:'3090',action}))).status).toBe(503);
  });
  it('serializes double taps for the same target', async () => {
    let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
    const fetcher = vi.fn(async (_u: any, o: any) => { await gate; return Response.json(result(JSON.parse(o.body))); }); vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('@/app/api/admin/gpu-controls/route');
    const first = POST(req({ target: '3090', action: 'reset' }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect((await POST(req({ target: '3090', action: 'reset' }))).status).toBe(409);
    finish(); expect((await first).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
