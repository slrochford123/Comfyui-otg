import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import Database from 'better-sqlite3';

describe('supported Node22 SDK and native module boundary', () => {
  it('uses Node22 with a functioning native SQLite ABI', () => {
    expect(Number(process.versions.node.split('.')[0])).toBe(22);
    const db = new Database(':memory:');
    expect(db.prepare('select 1 n').get()).toEqual({ n: 1 }); db.close();
  });
  it('uses the actual OpenAI SDK for Responses transport without paid API calls', async () => {
    let sent: any;
    const client = new OpenAI({ apiKey: randomBytes(32).toString('hex'), maxRetries: 0,
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ id: 'resp_qa', object: 'response', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'QA transport passed.', annotations: [] }] }] });
      } });
    const result = await client.responses.create({ model: 'qa-transport-only', input: 'Harmless fixture' });
    expect(sent.input).toBe('Harmless fixture'); expect(result.output_text).toBe('QA transport passed.');
  });
  it('supports actual SDK SSE streaming on Node22', async () => {
    const events = [
      { type: 'response.output_text.delta', delta: 'QA' },
      { type: 'response.completed', response: { id: 'resp_qa', status: 'completed', output: [] } },
    ];
    const client = new OpenAI({ apiKey: randomBytes(32).toString('hex'), maxRetries: 0,
      fetch: async () => new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }) });
    const stream = await client.responses.create({ model: 'qa-transport-only', input: 'QA', stream: true });
    const received = []; for await (const event of stream) received.push(event.type);
    expect(received).toEqual(events.map(e => e.type));
  });
  it('supports SDK audio multipart upload without exposing a key', async () => {
    let multipart = false;
    const client = new OpenAI({ apiKey: randomBytes(32).toString('hex'), maxRetries: 0,
      fetch: async (_url, init) => { multipart = init?.body instanceof FormData; return Response.json({ text: 'Synthetic QA transcript.' }); } });
    const file = await toFile(Buffer.from('RIFFsynthetic-transport-fixture'), 'qa.wav', { type: 'audio/wav' });
    expect((await client.audio.transcriptions.create({ file, model: 'qa-transport-only' })).text).toBe('Synthetic QA transcript.');
    expect(multipart).toBe(true);
  });
  it('decodes and resizes a safe image with the patched Sharp/libvips runtime', async () => {
    const input = await sharp({ create: { width: 17, height: 13, channels: 4, background: '#552277' } }).png().toBuffer();
    const output = await sharp(input).resize(9, 7).jpeg().toBuffer();
    expect(await sharp(output).metadata()).toMatchObject({ width: 9, height: 7, format: 'jpeg' });
  });
  it('recovers from unsupported image bytes', async () => {
    await expect(sharp(Buffer.from('harmless-invalid-image')).metadata()).rejects.toThrow();
  });
});
