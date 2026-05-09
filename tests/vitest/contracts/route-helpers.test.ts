import { describe, expect, it } from 'vitest';
import { jsonError, jsonOk, readJsonBody, withNoStore } from '@/lib/http/routeHelpers';

describe('route helpers', () => {
  it('adds no-store headers', () => {
    const headers = withNoStore({ 'x-test': '1' });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-test')).toBe('1');
  });

  it('parses valid JSON bodies', async () => {
    const req = new Request('http://test.local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    await expect(readJsonBody<{ hello: string }>(req)).resolves.toEqual({ ok: true, value: { hello: 'world' } });
  });

  it('rejects invalid JSON bodies', async () => {
    const req = new Request('http://test.local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    const result = await readJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('emits normalized ok and error responses', async () => {
    const ok = jsonOk({ value: 1 });
    await expect(ok.json()).resolves.toMatchObject({ ok: true, value: 1 });

    const err = jsonError('nope', { status: 418, code: 'teapot' });
    expect(err.status).toBe(418);
    await expect(err.json()).resolves.toMatchObject({ ok: false, error: 'nope', code: 'teapot' });
  });
});
