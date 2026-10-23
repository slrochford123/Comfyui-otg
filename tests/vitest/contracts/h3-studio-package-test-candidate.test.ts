import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../../../scripts/h3-studio/package-test-candidate.cjs');
const rollback = 'test3001-h3-edit-simple-20261023T165500Z';
let temporary: string, source: string, policy: any;
function put(file: string, value = 'fixture') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function links(root: string) { fs.symlinkSync(policy.env, path.join(root, '.env.local')); fs.symlinkSync(policy.data, path.join(root, 'data')); }
function fixtureBuild() {
  for (const file of pkg.BUILD_FILES) put(path.join(source, file), file.endsWith('package.json') ? '{"version":"2.0.1"}' : file.endsWith('BUILD_ID') ? 'fixture-build' : '{}');
  fs.mkdirSync(path.join(source, '.next/standalone/node_modules'), { recursive: true });
  put(path.join(source, '.next/static/chunks/fixture.js'));
  for (const asset of pkg.ASSETS) put(path.join(source, asset, 'fixture.js'));
  for (const helper of ['activate_test_release.py', 'systemd_runtime.py']) put(path.join(source, 'scripts/deploy', helper));
}
function receipt() {
  return { schemaVersion: 1, source, nodeVersion: policy.nodeVersion, appVersion: policy.appVersion,
    expectedCurrent: policy.expectedCurrent, capturedAt: '2020-01-01T00:00:00Z', ...pkg.sourceManifest(source) };
}

describe('H3 Phase 3 TEST package guards (temporary fixtures only; no candidate packaged)', () => {
  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-package-unit-'));
    source = path.join(temporary, 'source');
    const releases = path.join(temporary, 'deploy/test/releases');
    policy = { ...pkg.POLICY, source, releases, current: path.join(temporary, 'deploy/test/current'), expectedCurrent: path.join(releases, rollback),
      env: path.join(temporary, 'runtime/test/config/app-env/.env.local'), data: path.join(temporary, 'runtime/test/data'), node: path.join(temporary, 'node') };
    put(path.join(source, 'package.json'), '{"version":"2.0.1"}');
    put(policy.env, 'private fixture env is never read');
    fs.mkdirSync(policy.data, { recursive: true });
    put(path.join(policy.expectedCurrent, 'server.js'));
    put(path.join(policy.expectedCurrent, '.next/BUILD_ID'));
    put(policy.node);
    links(policy.expectedCurrent);
    fs.symlinkSync(policy.expectedCurrent, policy.current);
  });
  afterEach(() => { fs.rmSync(temporary, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('prints a side-effect-free plan with pinned TEST links and fixed rollback', () => {
    const plan = pkg.plan();
    expect(plan).toMatchObject({ mode: 'plan-only-no-files-copied', appVersion: '2.0.1', nodeVersion: 'v22.23.4', activation: false, copyLiveData: false, modelWeights: false });
    expect(plan.fixedExpectedCurrentAndRollback).toBe('/home/shawn-rochford/AI/deploy/otg-test/releases/' + rollback);
    expect(plan.links).toEqual({ '.env.local': '/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local', data: '/home/shawn-rochford/AI/runtime/test/data' });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    pkg.main([]);
    expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual(plan);
  });
  it('accepts the exact source and verified rollback links, without reading local build data', () => {
    put(path.join(source, 'data/otg.db'), 'do not copy');
    expect(() => pkg.validateRoots(source, policy)).not.toThrow();
  });
  it('refuses a wrong source root', () => expect(() => pkg.validateRoots(temporary, policy)).toThrow(/source root/));
  it('refuses a symlinked source root', () => {
    const alias = path.join(temporary, 'alias'); fs.symlinkSync(source, alias);
    expect(() => pkg.validateRoots(alias, { ...policy, source: alias })).toThrow(/source root/);
  });
  it('refuses a moved current pointer', () => {
    const other = path.join(policy.releases, 'other'); fs.mkdirSync(other);
    fs.unlinkSync(policy.current); fs.symlinkSync(other, policy.current);
    expect(() => pkg.validateRoots(source, policy)).toThrow(/fixed verified rollback/);
  });
  it.each(['data', '.env.local'])('refuses wrong rollback %s links', name => {
    const file = path.join(policy.expectedCurrent, name); fs.unlinkSync(file); fs.symlinkSync(source, file);
    expect(() => pkg.validateRoots(source, policy)).toThrow(/Wrong TEST/);
  });
  it.each(['data', '.env.local'])('refuses wrong source %s links', name => {
    fs.symlinkSync(temporary, path.join(source, name));
    expect(() => pkg.validateRoots(source, policy)).toThrow(/Wrong source/);
  });
  it('refuses a source env file rather than copying it', () => {
    put(path.join(source, '.env.local'), 'private');
    expect(() => pkg.validateRoots(source, policy)).toThrow(/Wrong source/);
  });
  it('refuses redirected canonical TEST data or env targets', () => {
    fs.renameSync(policy.data, policy.data + '-real'); fs.symlinkSync(policy.data + '-real', policy.data);
    expect(() => pkg.validateRoots(source, policy)).toThrow(/Wrong TEST data target/);
    fs.unlinkSync(policy.data); fs.renameSync(policy.data + '-real', policy.data);
    fs.renameSync(policy.env, policy.env + '-real'); fs.symlinkSync(policy.env + '-real', policy.env);
    expect(() => pkg.validateRoots(source, policy)).toThrow(/Wrong TEST env target/);
  });
  it('refuses any app feature version change', () => {
    put(path.join(source, 'package.json'), '{"version":"2.0.2"}');
    expect(() => pkg.validateRoots(source, policy)).toThrow(/2.0.1/);
  });
  it('requires the exact Node 22.23.4 version and executable', () => {
    expect(() => pkg.validateRuntime('v22.23.4', policy.node, policy)).not.toThrow();
    expect(() => pkg.validateRuntime('v22.23.1', policy.node, policy)).toThrow(/22.23.4/);
    expect(() => pkg.validateRuntime('v20.20.2', policy.node, policy)).toThrow(/22.23.4/);
    expect(() => pkg.validateRuntime('v22.23.4', '/usr/bin/node', policy)).toThrow(/22.23.4/);
  });
  it.each(['../escape', '/absolute', rollback, 'other-20261023T120000Z', 'test3001-old'])('refuses unsafe or old candidate %s', name => {
    expect(() => pkg.candidatePath(name, policy)).toThrow();
  });
  it('refuses existing candidate directories and dangling symlinks', () => {
    const name = 'test3001-phase3-20261023T120000Z';
    const candidate = pkg.candidatePath(name, policy); fs.mkdirSync(candidate);
    expect(() => pkg.candidatePath(name, policy)).toThrow(/already exists/);
    const other = 'test3001-phase3-20261023T120001Z'; fs.symlinkSync('/missing', path.join(policy.releases, other));
    expect(() => pkg.candidatePath(other, policy)).toThrow(/already exists/);
  });
  it('includes changed/untracked/ignored source and hashes current contents without opening data, env or weights', () => {
    put(path.join(source, 'lib/new-untracked.ts'), 'new source');
    put(path.join(source, 'scripts/stage-existing-token.py'), '# source helper');
    for (const rel of ['data/otg.db', '.env.local', 'weights/model.safetensors', 'public/model.bin', 'config/credentials.json', '.next/build', 'node_modules/x/index.js']) put(path.join(source, rel), 'excluded');
    const read = vi.spyOn(fs, 'readFileSync');
    const first = pkg.sourceManifest(source);
    expect(first.files.map((x: any) => x.path)).toEqual(['lib/new-untracked.ts', 'package.json', 'scripts/stage-existing-token.py']);
    expect(read.mock.calls.every(([p]) => !String(p).includes('otg.db') && !String(p).includes('safetensors') && !String(p).includes('.env.local') && !String(p).includes('credentials'))).toBe(true);
    put(path.join(source, 'lib/new-untracked.ts'), 'modified source');
    expect(pkg.sourceManifest(source).sourceSha256).not.toBe(first.sourceSha256);
    expect(first.excluded.some((x: any) => x.path === 'data')).toBe(true);
  });
  it('refuses unreviewed external source symlinks', () => {
    fs.symlinkSync(policy.env, path.join(source, 'lib.ts'));
    expect(() => pkg.sourceManifest(source)).toThrow(/source symlink/);
  });
  it('accepts a complete build bound to the source receipt', () => {
    fixtureBuild(); const r = receipt();
    expect(pkg.validateBuild(source, r, pkg.sourceManifest(source), policy)).toBe('fixture-build');
  });
  it.each(['old', 'changed-source', 'missing', 'different-id', 'wrong-version', 'build-lock', 'future-receipt', 'wrong-receipt'])('refuses invalid or stale builds: %s', mutation => {
    fixtureBuild(); const r = receipt();
    if (mutation === 'old') r.capturedAt = new Date().toISOString();
    if (mutation === 'old') fs.utimesSync(path.join(source, '.next/BUILD_ID'), 1, 1);
    if (mutation === 'changed-source') put(path.join(source, 'lib/new.ts'));
    if (mutation === 'missing') fs.unlinkSync(path.join(source, '.next/routes-manifest.json'));
    if (mutation === 'different-id') put(path.join(source, '.next/standalone/.next/BUILD_ID'), 'other-build');
    if (mutation === 'wrong-version') put(path.join(source, '.next/standalone/package.json'), '{"version":"2.0.2"}');
    if (mutation === 'build-lock') put(path.join(source, '.next/lock'));
    if (mutation === 'future-receipt') r.capturedAt = '2099-01-01T00:00:00Z';
    if (mutation === 'wrong-receipt') r.source = temporary;
    expect(() => pkg.validateBuild(source, r, pkg.sourceManifest(source), policy)).toThrow();
  });
  it('excludes data, env and weights while keeping standalone native dependencies and static files', () => {
    const root = path.join(source, '.next/standalone');
    for (const rel of ['server.js', '.next/BUILD_ID', 'node_modules/sharp/package.json', 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'data/db', '.env.local', 'model.safetensors']) put(path.join(root, rel));
    const files = pkg.copyRecords(root, { standalone: true }).map((x: any) => x.to);
    expect(files).toContain('node_modules/sharp/package.json');
    // Native build/Release is part of installed dependencies, not application build output.
    expect(files).toContain('node_modules/better-sqlite3/build/Release/better_sqlite3.node');
    expect(files).toContain('.next/BUILD_ID');
    expect(files).not.toContain('.env.local'); expect(files).not.toContain('data/db'); expect(files).not.toContain('model.safetensors');
  });
  it('rejects absolute/external package symlinks and permits relative internal dependency links', () => {
    put(path.join(source, 'target.js'));
    fs.symlinkSync('target.js', path.join(source, 'internal.js'));
    expect(pkg.copyRecords(source).some((x: any) => x.link === 'target.js')).toBe(true);
    fs.symlinkSync(policy.env, path.join(source, 'external.js'));
    expect(() => pkg.copyRecords(source)).toThrow(/symlink refused/);
  });
  it('restricts receipt destinations and refuses env/data/source paths', () => {
    expect(pkg.receiptPath(path.join(temporary, 'receipt.json'), source, policy)).toBe(path.join(temporary, 'receipt.json'));
    for (const file of [path.join(source, 'receipt.json'), path.join(policy.data, 'receipt.json'), path.join(path.dirname(policy.env), 'receipt.json'), path.join(policy.releases, 'receipt.json'), 'relative.json']) expect(() => pkg.receiptPath(file, source, policy)).toThrow();
  });
  it('probes SQLite only in memory and Sharp only with a tiny generated image', () => {
    const run = vi.fn(() => 'native-ok');
    expect(pkg.nativePreflight(source, policy, run)).toMatchObject({ sqlite: 'in-memory-query-passed', sharp: '2x2-png-passed' });
    const [node, args, options] = run.mock.calls[0] as unknown as [string, string[], any];
    expect(node).toBe(policy.node); expect(args[0]).toBe('-e'); expect(args[1]).toContain(":memory:"); expect(args[1]).toContain('width:2,height:2');
    expect(options.env.AUTH_SECRET).toBeUndefined(); expect(options.timeout).toBe(30000);
    expect(() => pkg.nativePreflight(source, policy, () => 'bad')).toThrow(/native preflight/);
  });
  it('requires a successful-build attestation before any package action', () => {
    expect(() => pkg.packageCandidate({ source, name: 'test3001-phase3-20261023T120000Z', receipt: {}, buildComplete: false }, policy)).toThrow(/attestation/);
    expect(fs.readdirSync(policy.releases)).toEqual([rollback]);
  });
  it('supplies separately authorized owner forward/rollback instructions without invoking them', () => {
    const candidate = path.join(policy.releases, 'test3001-phase3-20261023T120000Z');
    const text = pkg.ownerInstructions(candidate, policy);
    expect(text).toContain(`--expected-current ${policy.expectedCurrent} --candidate ${candidate}`);
    expect(text).toContain(`--expected-current ${candidate} --candidate ${policy.expectedCurrent}`);
    expect(text).toContain('Packaging never runs them');
  });
});
