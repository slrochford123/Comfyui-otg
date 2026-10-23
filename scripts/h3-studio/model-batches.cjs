#!/usr/bin/env node
'use strict';

// Offline proposal only. This module has no network, worker or download client.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
// Historical filename-only metadata, not live installation or qualification evidence.
const INVENTORY = 'scripts/h3-studio/fixtures/stage1c-inventory-20261023.json';
const CONFLICTS = [3294020, 3390388, 3385432];
// Owner review numbers: Category 8 contains only an already cross-listed SELECT.
const CATEGORIES = ['Anime & 2D Animation', '3D Animation & CGI', 'Cinematic Styles', 'Photorealism',
  'Camera Movement & Editing', 'Human Motion', 'Combat & Action', 'Vehicles & Chase Sequences',
  'Superpowers & Visual Effects', 'Fantasy & Science Fiction', 'Character Consistency & Anatomy',
  'Quality Repair & Enhancement', 'Speed & Performance Optimization', 'Horror & Specialized Genres',
  'Artistic & Experimental Styles', 'Environment & World Styles'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function index(rows, label) {
  const result = new Map();
  for (const row of rows) {
    requireThat(Number.isSafeInteger(row.versionId) && !result.has(row.versionId), `${label}: duplicate/invalid version`);
    result.set(row.versionId, row);
  }
  return result;
}
function primary(files) {
  const choices = files.filter(f => f.primary && /\.safetensors$/i.test(f.name));
  requireThat(choices.length === 1, 'Exactly one upstream primary model file required');
  const f = choices[0];
  requireThat(path.basename(f.name) === f.name && !/[\\\x00-\x1f]/.test(f.name), 'Unsafe upstream filename');
  requireThat(Number.isSafeInteger(f.bytes) && f.bytes > 0 && /^[a-f\d]{64}$/i.test(f.sha256), 'Missing declared bytes/SHA256');
  return f;
}
function createManifest(ledger, provenance, inventory, inputs = []) {
  requireThat(Number.isFinite(Date.parse(inventory.observedAt)) && inventory.observedAt === provenance.observedAt, 'Inventory/provenance timestamp mismatch');
  requireThat(inventory.mode === 'read-only-metadata-no-weights', 'Unexpected inventory mode');
  for (const host of ['rtx3090', 'rtx5060ti']) requireThat(inventory.workers[host]?.error === null, 'Inventory unavailable');
  const decisions = index(ledger.decisions, 'ledger');
  const undecided = index(ledger.unreviewedCatalogVersions, 'undecided');
  for (const id of undecided.keys()) requireThat(!decisions.has(id), 'Undecided version already decided');
  const counts = { SELECT: 0, MAYBE: 0, SKIP: 0, UNDECIDED: undecided.size };
  for (const row of decisions.values()) {
    requireThat(['SELECT', 'MAYBE', 'SKIP'].includes(row.decision), 'Invalid owner decision');
    counts[row.decision]++;
  }
  requireThat(JSON.stringify(counts) === JSON.stringify({ SELECT: 60, MAYBE: 4, SKIP: 76, UNDECIDED: 13 }), 'Owner decision totals changed; re-review proposal');
  const upstream = index(provenance.entries, 'provenance');
  const observed = index(inventory.entries, 'inventory');
  requireThat(upstream.size === 60 && observed.size === 60, 'Expected all 60 selected upstream versions');
  const selected = [];
  for (const decision of decisions.values()) {
    if (decision.decision !== 'SELECT') continue;
    const p = upstream.get(decision.versionId), i = observed.get(decision.versionId);
    requireThat(p?.modelId === decision.modelId && i?.modelId === decision.modelId && i.decision === 'SELECT', 'Model/version identity mismatch');
    const file = primary(p.files), observedFile = primary(i.metadata.files);
    requireThat(JSON.stringify(file) === JSON.stringify(observedFile) && file.name === i.canonicalFilename, 'Upstream/inventory primary file mismatch');
    const source = `https://civitai.com/models/${decision.modelId}?modelVersionId=${decision.versionId}`;
    requireThat(p.source === source && i.url === source, 'Exact version source mismatch');
    requireThat(p.licenseMetadata && !p.licenseMetadata.error && JSON.stringify(p.licenseMetadata) === JSON.stringify(i.licenseMetadata), 'Missing/inconsistent license metadata');
    const conflict = Boolean(decision.fileNames && decision.fileNames !== file.name);
    requireThat(conflict === p.filenameConflict, 'Filename conflict flag mismatch');
    for (const host of ['rtx3090', 'rtx5060ti']) {
      const state = i.installed[host];
      requireThat(state && ['listed-not-hash-verified', 'not-located'].includes(state.status), 'Unresolved worker inventory');
      requireThat(Array.isArray(state.matches) && (state.matches.length > 0) === (state.status === 'listed-not-hash-verified'), 'Inventory status/matches mismatch');
      requireThat(state.matches.every(name => name.split('/').at(-1) === file.name), 'Inventory filename mismatch');
    }
    const local = i.installed.rtx3090.status !== 'not-located';
    const remote = i.installed.rtx5060ti.status !== 'not-located';
    selected.push({
      modelId: decision.modelId, versionId: decision.versionId, modelName: decision.modelName,
      ledgerVersionName: decision.versionName, upstreamVersionName: i.metadata.name,
      category: decision.category, catalogCategories: decision.catalogCategories, decision: 'SELECT',
      source, metadataSource: `https://civitai.com/api/v1/model-versions/${decision.versionId}`,
      ledgerFilename: decision.fileNames, file: { ...file, hashStatus: 'upstream-declared-not-locally-verified' },
      upstreamFiles: p.files, filenameConflict: conflict, installed: i.installed,
      action: local ? 'already-located' : remote ? 'proposed-transfer' : 'proposed-download',
      ...(remote && !local ? { transfer: { from: 'rtx5060ti', to: 'rtx3090', sourceMatches: i.installed.rtx5060ti.matches, destinationFilename: file.name } } : {}),
      rights: { status: 'review-required', upstreamRightsAttestation: inventory.upstreamRights,
        licenseMetadata: p.licenseMetadata, licenseReviewed: false, implicitAllLicenseGrant: false },
      runtimeQualified: false, approvedToExecute: false,
      holds: ['owner-batch-approval', 'exact-file-hash-verification-authority', 'license-and-upstream-rights-review', 'compatibility-and-canonical-policy-review',
        ...(conflict ? ['resolve-ledger-upstream-filename-conflict'] : [])],
    });
  }
  requireThat(JSON.stringify(selected.filter(x => x.filenameConflict).map(x => x.versionId).sort()) === JSON.stringify([...CONFLICTS].sort()), 'Conflict set changed');
  const downloads = selected.filter(x => x.action === 'proposed-download');
  const located = selected.filter(x => x.action !== 'proposed-download');
  const transfers = selected.filter(x => x.action === 'proposed-transfer');
  const bytes = downloads.reduce((n, x) => n + x.file.bytes, 0);
  requireThat(downloads.length === 53 && located.length === 7 && transfers.length === 1 && transfers[0].versionId === 3240881 && bytes === 15200132452, 'Snapshot proposal counts/bytes changed');
  requireThat(selected.every(x => CATEGORIES.includes(x.category)), 'Unknown owner category');
  return {
    schemaVersion: 1, mode: 'offline-proposal-no-execution', inventorySnapshotAt: inventory.observedAt,
    provenanceSnapshotAt: provenance.observedAt, inputs,
    sourceRecoverySnapshot: { path: '/home/shawn-rochford/AI/research/h3-phase3-20261023-y8YGow', sourceSha256: '9094bc05fc62621566c5b53886420a028c4577f0a8cdbfc25bdf7e2aeb613301' },
    counts: { ...counts, uniqueVersions: 153, proposedDownloads: 53, locatedVersions: 7, proposedTransfers: 1, filenameConflicts: 3 },
    storage: { declaredDownloadBytes: bytes, declaredTransferBytes: transfers[0].file.bytes,
      intended3090AdditionalBytes: bytes + transfers[0].file.bytes,
      minimumAdditionalOperationalHeadroomBytes: 20 * 1024 ** 3, temporarySpace: 'Reserve at least one full batch in addition to final assets; recheck free space before any authorized execution. Shared NFS storage is counted once.' },
    rightsPolicy: 'SELECT is a retained owner choice, not a download, license, hash, installation or runtime grant. Permission flags and the owner attestation do not grant all licenses or establish upstream rights. Every entry requires its own review, including dependencies. MAYBE/SKIP/UNDECIDED are not an install queue; SKIP never authorizes removal.',
    batches: CATEGORIES.map((category, n) => {
      const entries = downloads.filter(x => x.category === category);
      return { id: `category-${String(n + 1).padStart(2, '0')}`, category, versionIds: entries.map(x => x.versionId),
        crossListedSelectedVersionIds: selected.filter(x => x.category !== category && x.catalogCategories?.includes(category)).map(x => x.versionId),
        count: entries.length, declaredBytes: entries.reduce((sum, x) => sum + x.file.bytes, 0), approvedToExecute: false };
    }),
    downloads, transfers, locatedVersions: located,
    conflicts: selected.filter(x => x.filenameConflict),
    retainedDecisions: { MAYBE: ledger.decisions.filter(x => x.decision === 'MAYBE'), SKIP: ledger.decisions.filter(x => x.decision === 'SKIP'), UNDECIDED: ledger.unreviewedCatalogVersions },
  };
}
const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
function markdown(manifest) {
  const m = manifest;
  const lines = ['# H3 Phase 3 model batches and TEST recovery packaging', '',
    'Generated offline by `scripts/h3-studio/model-batches.cjs --write-docs`; do not edit the generated JSON/Markdown by hand.', '',
    `Inventory and provenance snapshot: **${m.inventorySnapshotAt}**. This is historical filename/byte metadata, not current worker state or physical qualification.`, '',
    `Retained decisions: 60 SELECT, 4 MAYBE, 76 SKIP, 13 UNDECIDED (153 unique versions). Proposal: **53 unique downloads / ${m.storage.declaredDownloadBytes} declared bytes**, plus **one PBR transfer / ${m.storage.declaredTransferBytes} bytes** from 5060 Ti to 3090. Seven distinct selected versions were located across the two workers.`, '',
    m.rightsPolicy, '',
    'All rows below have rights status `review-required`, local hash status `unverified`, runtime qualification `false`, and execution approval `false`. The JSON preserves each exact permission flag, declared source SHA256, all upstream files, worker filename matches and original non-SELECT decisions. Alternate files/training ZIPs are metadata only; each download proposes exactly the upstream primary safetensors file.', '',
    '## Category batches', '', '| Batch | Owner category | Unique downloads | Declared bytes |', '|---|---|---:|---:|',
    ...m.batches.map(b => `| ${b.id} | ${cell(b.category)} | ${b.count} | ${b.declaredBytes} |`), '',
    'Batch numbers retain all 16 owner review categories. Each version appears in one owner category download batch; cross-listed selections remain in JSON. Category 8 has no new download: Extreme Enduro remains in Category 5. Empty categories introduce no download. Run batches sequentially only after separate approval, fresh storage checks, conflict resolution, license review and authorized hash verification. Reserve batch-sized temporary space plus 20 GiB operational headroom; count shared NFS capacity once.', ''];
  function rows(title, entries) {
    lines.push(`## ${title}`, '', '| Category / model | Exact Civitai version | Upstream primary filename | Declared bytes | Declared SHA256 |', '|---|---|---|---:|---|');
    for (const e of entries) lines.push(`| ${cell(e.category)} / ${cell(e.modelName)}${e.filenameConflict ? ' **CONFLICT HOLD**' : ''} | [${e.versionId}](${e.source}) | ${cell(e.file.name)} | ${e.file.bytes} | \`${e.file.sha256}\` |`);
    lines.push('');
  }
  rows('53 proposed downloads (no execution)', m.downloads);
  rows('One proposed PBR transfer (no execution)', m.transfers);
  rows('Seven located versions (listed, not hash verified)', m.locatedVersions);
  lines.push('## Three filename conflicts', '', '| Version | Original ledger filename | Actual upstream primary filename |', '|---|---|---|',
    ...m.conflicts.map(e => `| ${e.versionId} | ${cell(e.ledgerFilename)} | ${cell(e.file.name)} |`), '',
    'Keep both names as evidence. No alias, rename, enablement or automatic resolution is authorized.', '',
    '## TEST package helper: owner workflow after the main build', '',
    'The default command only prints a plan. **Packaging has not been run.** The helper never builds, activates, restarts, downloads, reads/copies live data, or changes Git/app version 2.0.1. It pins Node 22.23.4 and rollback `test3001-h3-trim-admin-center-20261022T194500Z`.', '',
    'For a future authorized build, after all agents finish source edits, record the complete source inputs BEFORE that build (including dirty and untracked source). Store the receipt outside source and outside runtime data/config. Then the owner runs the main build with Node 22.23.4. Source changes after the receipt require a new receipt and rebuild. The package command requires both that receipt and an explicit successful-build attestation:', '',
    '```sh',
    'NODE=/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node',
    '$NODE scripts/h3-studio/package-test-candidate.cjs',
    '# Future owner steps only; not executed by this implementation:',
    '$NODE scripts/h3-studio/package-test-candidate.cjs --record-build-inputs /absolute/research/build-inputs.json',
    '# Owner completes the main build, then explicitly authorizes packaging.',
    '$NODE scripts/h3-studio/package-test-candidate.cjs --package --build-complete --build-inputs /absolute/research/build-inputs.json --candidate test3001-h3-phase3-YYYYMMDDTHHMMSSZ',
    '```', '',
    'A new candidate is created exclusively under the TEST releases directory. Existing candidates, changed current/rollback links, wrong roots, runtime versions, data/env paths, stale/incomplete builds, secrets and external asset symlinks are refused. Required standalone, static, public, workflow, script, library and config assets are copied additively. A complete source manifest and recovery-source copy include dirty/untracked source, with explicit exclusions for Git internals, dependencies, build output, runtime data, secrets, model weights, caches and archives. Excluded paths carry reasons, never contents/hashes. TEST `.env.local` and `data` are symlinks only; no live data or secret values enter the package.', '',
    'Native SQLite and Sharp are probed with Node 22.23.4 against the source dependencies and the completed candidate (in-memory SQLite and a 2x2 PNG only). Failed candidates retain `DO_NOT_ACTIVATE`; no cleanup, overwrite or retry into an old directory occurs. Source drift during copying invalidates the package.', '',
    'The package copies the existing guarded `activate_test_release.py` and `systemd_runtime.py` into `owner-activation/`, with hashes and explicit forward/rollback instructions in `OWNER_TEST_ONLY.md`. These helpers are supplied for a separately authorized owner action; the packaging process never invokes them. The expected rollback is checked again before completing packaging. Packaging success is not activation or runtime acceptance.', '',
    `Recovery baseline: \`${m.sourceRecoverySnapshot.path}\`, source SHA256 \`${m.sourceRecoverySnapshot.sourceSha256}\`. No model-weight hashes were computed to generate this proposal.`, '');
  return lines.join('\n');
}
function loadManifest() {
  const files = ['lib/h3Stage1cLedger.json', 'lib/h3Stage1cProvenance.json', INVENTORY];
  const bytes = files.map(f => fs.readFileSync(path.join(ROOT, f)));
  return createManifest(...bytes.map(b => JSON.parse(b)), files.map((file, i) => ({ file, sha256: sha(bytes[i]) })));
}
function main(args) {
  requireThat(args.length === 0 || (args.length === 1 && ['--write-docs', '--check-docs'].includes(args[0])), 'Usage: model-batches.cjs [--write-docs|--check-docs] (proposal only)');
  const manifest = loadManifest();
  const outputs = { 'H3_PHASE3_MODEL_BATCHES.json': JSON.stringify(manifest, null, 2) + '\n', 'H3_PHASE3_MODEL_BATCHES.md': markdown(manifest) };
  if (args[0] === '--write-docs') {
    for (const [name, value] of Object.entries(outputs)) {
      const destination = path.join(ROOT, 'docs', name);
      requireThat(!fs.existsSync(destination) || !fs.lstatSync(destination).isSymbolicLink(), 'Refusing symlinked generated document');
      fs.writeFileSync(destination, value);
    }
    process.stdout.write('Generated Phase 3 proposal JSON/Markdown. No downloads or transfers.\n');
  } else if (args[0] === '--check-docs') {
    for (const [name, value] of Object.entries(outputs)) requireThat(fs.readFileSync(path.join(ROOT, 'docs', name), 'utf8') === value, `Generated document stale: ${name}`);
    process.stdout.write('Generated Phase 3 proposal documents match inputs.\n');
  } else process.stdout.write(outputs['H3_PHASE3_MODEL_BATCHES.json']);
}
module.exports = { createManifest, markdown, loadManifest, primary, main };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`Proposal refused: ${error.message}\n`); process.exitCode = 1; } }
