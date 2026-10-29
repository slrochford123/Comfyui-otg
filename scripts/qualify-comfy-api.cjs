// Isolated HTTP/application qualification. No GPU inference or live data/services.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const root = path.resolve(process.argv[2] || '');
assert(/^\/home\/shawn-rochford\/AI\/research\/comfy-api-reliability-20261029-[A-Za-z0-9]+$/.test(root));
const source = path.resolve(__dirname, '..'), candidate = path.join(root, 'qa-candidate'), data = path.join(root, 'qa-data');
const report = { startedAt: new Date().toISOString(), kind: 'real HTTP against built application with controlled synthetic worker', gpuInferencePerformed: false, checks: [] };
let app, worker, sockets;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = name => report.checks.push({ name, passed: true });
async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const exited = once(app, 'exit'); app.kill('SIGTERM');
  const timer = setTimeout(() => app.kill('SIGKILL'), 8000);
  await exited; clearTimeout(timer);
}
(async () => {
  assert(!fs.existsSync(candidate), 'Use a new research root for a fresh qualification');
  fs.cpSync(path.join(source, '.next/standalone'), candidate, { recursive: true });
  fs.cpSync(path.join(source, '.next/static'), path.join(candidate, '.next/static'), { recursive: true });
  for (const directory of ['public', 'config', 'comfy_workflows', 'workflows', 'lib', 'scripts']) {
    if (fs.existsSync(path.join(source, directory))) fs.cpSync(path.join(source, directory), path.join(candidate, directory), { recursive: true });
  }
  fs.mkdirSync(data, { mode: 0o700 });
  const clip = path.join(root, 'qa-original.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x96:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-shortest', clip]);
  const video = fs.readFileSync(clip), image = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: 'green' } }).png().toBuffer();
  const promptId = crypto.randomUUID(); let mode = 'running', queueReads = 0, submissions = 0;
  worker = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://worker').pathname;
    res.setHeader('content-type', 'application/json');
    if (route === '/queue') { queueReads++; if (mode === 'offline') { res.writeHead(503); return res.end('{}'); }
      return res.end(JSON.stringify({ queue_running: mode === 'running' ? [[0, promptId]] : [], queue_pending: [] })); }
    if (route.startsWith('/history')) return res.end(JSON.stringify(mode === 'completed' ? { [promptId]: { status: { completed: true, status_str: 'success' }, outputs: { '5': { videos: [{ filename: 'qa.mp4', type: 'output', subfolder: '' }] } } } } : {}));
    if (route === '/view') { res.setHeader('content-type', 'video/mp4'); res.setHeader('content-length', video.length); return res.end(video); }
    if (route === '/prompt') { submissions++; res.writeHead(500); return res.end('{}'); }
    res.writeHead(404); res.end('{}');
  });
  sockets = new WebSocketServer({ server: worker });
  sockets.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'progress', data: { prompt_id: promptId, node: 'sampler', value: 4, max: 8 } }));
    const metadata = Buffer.from(JSON.stringify({ prompt_id: promptId, image_type: 'image/png', step: 4, total: 8 }));
    const header = Buffer.alloc(8); header.writeUInt32BE(4); header.writeUInt32BE(metadata.length, 4);
    socket.send(Buffer.concat([header, metadata, image]));
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  const upstream = `http://127.0.0.1:${worker.address().port}`;
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', AUTH_SECRET: crypto.randomBytes(48).toString('hex'),
    OTG_ENV: 'test', OTG_DATA_DIR: data, PORT: '3310', HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1',
    COMFYUI_BASE_URL: upstream, OTG_AUDIO_ISOLATED_DEV: '1' };
  const log = fs.openSync(path.join(root, 'qa-server.log'), 'a', 0o600), base = 'http://127.0.0.1:3310';
  async function startApp() {
    app = spawn(process.execPath, ['server.js'], { cwd: candidate, env, stdio: ['ignore', log, log] });
    for (let i = 0; i < 80; i++) { if (app.exitCode !== null) throw Error('QA server exited');
      try { if ((await fetch(base + '/api/healthz')).ok) return; } catch {} await sleep(100); }
    throw Error('QA startup timed out');
  }
  await startApp();
  async function account() {
    const username = 'comfyqa_' + crypto.randomBytes(4).toString('hex'), password = crypto.randomBytes(24).toString('base64url');
    const headers = { 'content-type': 'application/json' };
    assert((await fetch(base + '/api/auth/signup', { method: 'POST', headers, body: JSON.stringify({ username, email: username + '@test.invalid', password }) })).ok);
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ identifier: username, password }) }); assert(response.ok);
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); assert(cookie);
    return { username, cookie };
  }
  const owner = await account(), other = await account();
  const get = (route, user = owner, options = {}) => fetch(base + route, { ...options, headers: { cookie: user.cookie, ...options.headers } });
  const stateFile = path.join(data, 'content_state', owner.username + '.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const state = { status: 'running', promptId, comfyBaseUrl: upstream, comfyClientId: 'qa-saved-client', startedAt: Date.now(), totalNodes: 8 };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const metaDir = path.join(data, 'prompt_request_meta', owner.username); fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(metaDir, promptId + '.json'), JSON.stringify({ promptId, ownerKey: owner.username, comfyBaseUrl: upstream, comfyClientId: state.comfyClientId, totalNodes: 8 }));
  assert.equal((await fetch(base + '/api/progress')).status, 401);
  assert.equal((await fetch(base + '/api/comfy-events')).status, 401);
  assert.equal((await get('/api/progress?promptId=' + promptId, other)).status, 404);
  assert.equal((await get('/api/comfy-events?clientId=forged')).status, 400); check('real authentication and cross-owner/raw-socket refusal');
  let progress = await (await get('/api/progress')).json(); assert.equal(progress.status, 'running');
  await sleep(300); progress = await (await get('/api/progress')).json();
  assert(progress.approximatePreview?.imageUrl.startsWith('data:image/png;base64,')); check('binary preview delivered through authenticated progress API');
  for (const socket of sockets.clients) socket.close(); await sleep(900);
  progress = await (await get('/api/progress')).json(); assert(progress.approximatePreview); check('real WebSocket reconnection retains preview');
  mode = 'offline'; progress = await (await get('/api/progress')).json();
  assert.equal(progress.status, 'reconnecting'); assert.equal(progress.retryable, true);
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).status, 'running'); check('upstream outage is recoverable without falsifying idle or failure');
  mode = 'running'; for (const socket of sockets.clients) socket.send(JSON.stringify({ type: 'execution_success', data: { prompt_id: promptId } }));
  await sleep(100); progress = await (await get('/api/progress')).json(); assert.equal(progress.prompt_complete, false); check('worker completion alone does not mean media delivery');
  mode = 'completed'; progress = await (await get('/api/progress')).json(); assert.equal(progress.prompt_complete, true);
  const file = progress.fileName; assert(file);
  const download = await get('/api/gallery/file?name=' + encodeURIComponent(file) + '&scope=user&download=1'); assert(download.ok);
  const delivered = Buffer.from(await download.arrayBuffer()); assert(delivered.equals(video));
  const range = await get('/api/gallery/file?name=' + encodeURIComponent(file) + '&scope=user', owner, { headers: { range: 'bytes=0-31' } });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32); check('actual video imported and downloaded byte-exactly, including range requests');
  const streamAbort = new AbortController(); const stream = await get('/api/comfy-events', owner, { signal: streamAbort.signal });
  const reader = stream.body.getReader(); let events = '';
  for (let i = 0; i < 3 && !events.includes('execution_complete'); i++) events += new TextDecoder().decode((await reader.read()).value);
  assert(events.includes('execution_complete')); streamAbort.abort();
  await sleep(200); const reads = queueReads; await sleep(2300); assert.equal(queueReads, reads); check('verified-completion notification and disconnected stream cleanup');
  await stopApp(); fs.writeFileSync(stateFile, JSON.stringify({ ...state, startedAt: Date.now() }));
  await startApp(); progress = await (await get('/api/progress')).json();
  assert.equal(progress.prompt_complete, true); assert.equal(submissions, 0); check('application restart rehydrates original result without resubmitting');
  check('original 1-second/24-frame video bytes and audio preserved');
  report.passed = true;
})().catch(error => { report.passed = false; report.error = String(error.stack || error); process.exitCode = 1; }).finally(async () => {
  await stopApp(); if (sockets) for (const socket of sockets.clients) socket.terminate();
  if (sockets) sockets.close(); if (worker) { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(root, 'http-qualification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, report: path.join(root, 'http-qualification.json') }));
});
