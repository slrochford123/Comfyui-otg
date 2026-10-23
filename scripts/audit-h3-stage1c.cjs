#!/usr/bin/env node
/* READ ONLY. No model download, hashing sweep, inference, Comfy mutation or service operation. */
const fs = require("node:fs");
const ledger = require("../lib/h3Stage1cLedger.json");
const selected = ledger.decisions.filter(d => d.decision === "SELECT");
const hosts = { rtx3090: "http://100.75.162.64:8189", rtx5060ti: "http://100.98.212.116:8188" };
async function json(url) { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function main() {
  const workers = {};
  for (const [host, base] of Object.entries(hosts)) {
    try {
      const [info, queue] = await Promise.all([json(`${base}/object_info/LoraLoaderModelOnly`), json(`${base}/queue`)]);
      workers[host] = { files: info.LoraLoaderModelOnly.input.required.lora_name[0], running: queue.queue_running.length, pending: queue.queue_pending.length };
    } catch (error) { workers[host] = { files: [], error: error.message }; }
  }
  const metadata = new Map(); const models = new Map(); let cursor = 0;
  // Public metadata only, never downloadUrl or image/prompt assets. Bounded concurrency.
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (;;) {
      const i = cursor++; if (i >= selected.length) return;
      const entry = selected[i];
      try {
        const version = await json(`https://civitai.com/api/v1/model-versions/${entry.versionId}`);
        if (version.id !== entry.versionId || version.modelId !== entry.modelId) throw new Error("Identity mismatch");
        metadata.set(entry.versionId, { name: version.name, baseModel: version.baseModel, files: (version.files || []).map(f => ({ name: f.name, primary: f.primary, bytes: Math.round(f.sizeKB * 1024), sha256: f.hashes?.SHA256 || null })) });
      } catch (error) { metadata.set(entry.versionId, { error: error.message }); }
      if (!models.has(entry.modelId)) {
        // Store the in-flight promise as well to avoid duplicate metadata requests.
        models.set(entry.modelId, json(`https://civitai.com/api/v1/models/${entry.modelId}`).then(m => ({
          source: `https://civitai.com/models/${entry.modelId}`, allowCommercialUse: m.allowCommercialUse ?? null,
          allowNoCredit: m.allowNoCredit ?? null, allowDerivatives: m.allowDerivatives ?? null, allowDifferentLicense: m.allowDifferentLicense ?? null,
          licenses: m.licenses ?? null,
        })).catch(error => ({ error: error.message })));
      }
    }
  }));
  const entries = [];
  for (const entry of selected) {
    const detail = metadata.get(entry.versionId);
    const canonical = detail.files?.find(f => f.primary) || (detail.files?.length === 1 ? detail.files[0] : null);
    const filename = canonical?.name || entry.fileNames;
    const installed = Object.fromEntries(Object.entries(workers).map(([host, w]) => [host, {
      status: w.error ? "inventory-unavailable" : !filename ? "filename-unresolved" : w.files.some(f => f === filename || f.split("/").at(-1) === filename) ? "listed-not-hash-verified" : "not-located",
      matches: filename ? w.files.filter(f => f === filename || f.split("/").at(-1) === filename) : [],
    }]));
    entries.push({ ...entry, metadata: detail, licenseMetadata: await models.get(entry.modelId), canonicalFilename: filename, installed, runtimeQualified: false, licenseReviewed: false });
  }
  process.stdout.write(JSON.stringify({ observedAt: new Date().toISOString(), mode: "read-only-metadata-no-weights", upstreamRights: "owner-attested-2026-10-23-not-independently-reviewed",
    counts: ledger.decisionTotals, undecided: ledger.unreviewedCount,
    workers: Object.fromEntries(Object.entries(workers).map(([host, w]) => [host, { error: w.error || null, running: w.running, pending: w.pending }])), entries }, null, 2) + "\n");
}
main().catch(() => { process.stderr.write("Read-only H3 metadata audit failed. No worker state was changed.\n"); process.exitCode = 1; });
