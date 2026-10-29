// Non-disruptive worker qualification. A cancel probe uses a fresh never-submitted
// UUID and requires cancelled:false. No real job, service, or memory changes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(process.argv[2] || '');
assert(/^\/home\/shawn-rochford\/AI\/research\/comfy-api-reliability-20261029-[A-Za-z0-9]+$/.test(root));
(async () => {
  const rows = [];
  for (const [id, base] of [['rtx3090', 'http://100.75.162.64:8189'], ['rtx5060ti', 'http://100.98.212.116:8188']]) {
    const get = endpoint => fetch(base + endpoint, { signal: AbortSignal.timeout(8000), redirect: 'error' }).then(async response => {
      assert(response.ok, `${id} ${endpoint}: HTTP ${response.status}`); return response.json();
    });
    const [queue, stats, nodes] = await Promise.all([get('/queue'), get('/system_stats'),
      Promise.all(['MiniMaxH3ReferenceToVideo', 'ModelPreviewOverrideKJ'].map(async name => ({ name, registered: Boolean((await get('/object_info/' + name))[name]) }))),
    ]);
    assert(Array.isArray(queue.queue_running) && Array.isArray(queue.queue_pending));
    const probe = randomUUID();
    assert(![...queue.queue_running, ...queue.queue_pending].some(row => row[1] === probe));
    const cancelRoute = await fetch(base + '/api/jobs/' + probe + '/cancel', { method: 'POST', signal: AbortSignal.timeout(8000), redirect: 'error' });
    const cancelResult = await cancelRoute.json();
    assert(cancelRoute.ok && cancelResult.cancelled === false, 'Atomic cancel no-op probe failed');
    rows.push({ id, base, running: queue.queue_running.length, pending: queue.queue_pending.length,
      devices: (stats.devices || []).map(device => ({ name: device.name, vramTotal: device.vram_total, vramFree: device.vram_free })),
      comfyVersion: stats.system?.comfyui_version || null, nodes,
      atomicCancelRoute: { status: cancelRoute.status, supported: true, probeTargetNeverSubmitted: true, cancelled: false } });
  }
  const report = { checkedAt: new Date().toISOString(), noWorkloadChanges: true, gpuInferencePerformed: false, workers: rows };
  fs.writeFileSync(path.join(root, 'native-workers.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
})().catch(error => { console.error(String(error.message)); process.exitCode = 1; });
