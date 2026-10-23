import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const batches = require('../../../scripts/h3-studio/model-batches.cjs');
const ledger = require('../../../lib/h3Stage1cLedger.json');
const provenance = require('../../../lib/h3Stage1cProvenance.json');
const inventory = JSON.parse(fs.readFileSync(new URL('../../../scripts/h3-studio/fixtures/stage1c-inventory-20261023.json', import.meta.url), 'utf8'));
const make = (l = ledger, p = provenance, i = inventory) => batches.createManifest(l, p, i);

describe('H3 Phase 3 offline model batch proposal', () => {
  it('deduplicates by exact version and uses actual primary file bytes', () => {
    const m = make();
    expect(m.counts).toEqual({ SELECT: 60, MAYBE: 4, SKIP: 76, UNDECIDED: 13, uniqueVersions: 153, proposedDownloads: 53, locatedVersions: 7, proposedTransfers: 1, filenameConflicts: 3 });
    expect(new Set(m.downloads.map((x: any) => x.versionId)).size).toBe(53);
    expect(m.batches.flatMap((x: any) => x.versionIds)).toEqual(expect.arrayContaining(m.downloads.map((x: any) => x.versionId)));
    expect(m.batches.reduce((n: number, b: any) => n + b.count, 0)).toBe(53);
    expect(m.batches).toHaveLength(16);
    expect(m.batches[7]).toMatchObject({ id: 'category-08', category: 'Vehicles & Chase Sequences', versionIds: [], crossListedSelectedVersionIds: [3390388], count: 0 });
    expect(m.batches[15]).toMatchObject({ id: 'category-16', category: 'Environment & World Styles', versionIds: [3385432] });
    expect(m.storage.declaredDownloadBytes).toBe(15200132452);
    expect(m.storage.intended3090AdditionalBytes).toBe(15355242828);
    expect(m.downloads.every((x: any) => x.file.primary && x.file.hashStatus === 'upstream-declared-not-locally-verified')).toBe(true);
  });
  it('retains seven located versions and proposes only the one PBR transfer', () => {
    const m = make();
    expect(m.transfers.map((x: any) => x.versionId)).toEqual([3240881]);
    expect(m.transfers[0].transfer).toMatchObject({ from: 'rtx5060ti', to: 'rtx3090', destinationFilename: 'MiniMaxH3_Ref2V_PBRStyle_v1.0.safetensors' });
    expect(m.transfers[0].file.bytes).toBe(155110376);
    expect(m.locatedVersions.map((x: any) => x.versionId)).toEqual([3240881, 3395642, 3366092, 3268186, 3219346, 3219337, 3294126]);
    expect(m.downloads.some((x: any) => m.locatedVersions.some((y: any) => x.versionId === y.versionId))).toBe(false);
  });
  it('retains all three ledger/upstream conflicts without aliasing', () => {
    const m = make();
    expect(m.conflicts.map((x: any) => x.versionId)).toEqual([3294020, 3390388, 3385432]);
    for (const row of m.conflicts) {
      expect(row.file.name).not.toBe(row.ledgerFilename);
      expect(row.holds).toContain('resolve-ledger-upstream-filename-conflict');
      expect(row.approvedToExecute).toBe(false);
    }
  });
  it('retains original MAYBE/SKIP/UNDECIDED payloads and permission distinctions', () => {
    const m = make();
    for (const key of ['MAYBE', 'SKIP']) expect(m.retainedDecisions[key]).toEqual(ledger.decisions.filter((x: any) => x.decision === key));
    expect(m.retainedDecisions.UNDECIDED).toEqual(ledger.unreviewedCatalogVersions);
    expect(m.transfers[0].rights.licenseMetadata.allowCommercialUse).toEqual(['RentCivit', 'Rent']);
    for (const row of [...m.downloads, ...m.locatedVersions]) {
      expect(row.rights).toMatchObject({ status: 'review-required', licenseReviewed: false, implicitAllLicenseGrant: false });
      expect(row.runtimeQualified).toBe(false);
      expect(row.approvedToExecute).toBe(false);
    }
    expect(m.inventorySnapshotAt).toBe('2026-10-23T11:02:24.454Z');
  });
  it('is deterministic and its checked-in documents are reproducible', () => {
    expect(make()).toEqual(make());
    const m = batches.loadManifest();
    expect(JSON.parse(fs.readFileSync(new URL('../../../docs/H3_PHASE3_MODEL_BATCHES.json', import.meta.url), 'utf8'))).toEqual(m);
    expect(fs.readFileSync(new URL('../../../docs/H3_PHASE3_MODEL_BATCHES.md', import.meta.url), 'utf8')).toBe(batches.markdown(m));
  });
  it('records portable repository-relative input identities', () => {
    const m = batches.loadManifest();
    expect(m.inputs.map((input: any) => input.file)).toEqual([
      'lib/h3Stage1cLedger.json', 'lib/h3Stage1cProvenance.json',
      'scripts/h3-studio/fixtures/stage1c-inventory-20261023.json',
    ]);
    expect(m.inputs.every((input: any) => !path.isAbsolute(input.file) && /^[a-f0-9]{64}$/.test(input.sha256))).toBe(true);
  });
  it('checks documents from a relocated checkout without the private research directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-batch-portability-'));
    try {
      for (const file of [
        'scripts/h3-studio/model-batches.cjs', 'scripts/h3-studio/fixtures/stage1c-inventory-20261023.json',
        'lib/h3Stage1cLedger.json', 'lib/h3Stage1cProvenance.json',
        'docs/H3_PHASE3_MODEL_BATCHES.json', 'docs/H3_PHASE3_MODEL_BATCHES.md',
      ]) {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(new URL('../../../' + file, import.meta.url), target);
      }
      const result = execFileSync(process.execPath, [path.join(root, 'scripts/h3-studio/model-batches.cjs'), '--check-docs'], { cwd: os.tmpdir(), encoding: 'utf8' });
      expect(result).toContain('documents match inputs');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['duplicate', 'wrong-model', 'wrong-source', 'missing-hash', 'missing-license', 'conflict', 'old-inventory', 'worker-error', 'missing-file'])('refuses inconsistent evidence: %s', mutation => {
    const l = structuredClone(ledger), p = structuredClone(provenance), i = structuredClone(inventory);
    if (mutation === 'duplicate') l.decisions.push(l.decisions[0]);
    if (mutation === 'wrong-model') p.entries[0].modelId++;
    if (mutation === 'wrong-source') p.entries[0].source = 'https://civitai.com/models/1';
    if (mutation === 'missing-hash') p.entries[0].files[0].sha256 = null;
    if (mutation === 'missing-license') p.entries[0].licenseMetadata = null;
    if (mutation === 'conflict') p.entries[0].filenameConflict = true;
    if (mutation === 'old-inventory') i.observedAt = '2026-10-22T00:00:00Z';
    if (mutation === 'worker-error') i.workers.rtx3090.error = 'unavailable';
    if (mutation === 'missing-file') i.entries[0].canonicalFilename = 'other.safetensors';
    expect(() => make(l, p, i)).toThrow();
  });
  it('has no execution CLI and rejects download flags', () => {
    expect(() => batches.main(['--download'])).toThrow(/proposal only/);
    expect(() => batches.main(['--write-docs', '--execute'])).toThrow();
  });
});
