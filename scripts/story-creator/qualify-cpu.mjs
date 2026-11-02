import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error('Usage: node qualify-cpu.mjs RUNTIME_ROOT NEW_EVIDENCE_DIRECTORY');
await fs.mkdir(output, { recursive: false, mode: 0o700 });

function call(endpoint, data, timeout = 240000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ jobId: randomUUID(), ...data }));
    const started = performance.now();
    const request = http.request({ socketPath: path.join(root, 'worker.sock'), path: endpoint, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (!result.ok) throw new Error(result.error || `HTTP ${response.statusCode}`);
          resolve({ ...result, deliveredSeconds: (performance.now() - started) / 1000 });
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(timeout, () => request.destroy(new Error('Qualification operation timed out.')));
    request.end(body);
  });
}

function wordErrorRate(expected, actual) {
  const tokens = value => value.toLowerCase().match(/[a-z0-9]+/g) || [];
  const a = tokens(expected), b = tokens(actual);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1,
      previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length] / Math.max(1, a.length);
}

const results = { device: 'cpu', gpuInferencePerformed: false, paidApiCalls: false, results: [], limitations: [
  'ASR back-check is not a subjective listening evaluation.',
  'Process-local cold/warm runs do not flush OS disk caches.',
  'Dedicated GPU compatibility remains untested until that card is installed.',
] };
const embedding = await call('/embed', { texts: ['Mara was brought up by her grandmother Elin.', 'Mara owns a red bicycle.'] });
results.embedding = { model: embedding.model, dimensions: embedding.vectors.map(v => v.length), elapsedSeconds: embedding.elapsedSeconds };

for (const engine of ['kokoro', 'bark']) {
  const text = engine === 'kokoro'
    ? 'Mara opens the cafe door. Elin smiles and says, welcome back. We can develop the next scene together.'
    : 'Hello. I am ready to help you tell your story.';
  for (const temperature of ['cold', 'warm']) {
    try {
      const result = await call('/tts', { engine, voice: 'female', text });
      const file = `${engine}-${temperature}.wav`;
      await fs.writeFile(path.join(output, file), Buffer.from(result.audio, 'base64'), { mode: 0o600 });
      const transcript = await call('/transcribe', { audio: result.audio, language: 'en' });
      const { audio, ...metrics } = result;
      const row = { engine, temperature, text, file, ...metrics, transcript: transcript.text,
        transcriptionSeconds: transcript.elapsedSeconds, wordErrorRate: wordErrorRate(text, transcript.text) };
      results.results.push(row);
      console.log(JSON.stringify(row));
    } catch (error) {
      const row = { engine, temperature, status: 'failed', error: String(error.message) };
      results.results.push(row);
      console.log(JSON.stringify(row));
      break; // No uncontrolled retry loop or fake warm result.
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
  }
}
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
