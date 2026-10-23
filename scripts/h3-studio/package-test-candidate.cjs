#!/usr/bin/env node
'use strict';

// Additive offline TEST packaging only. No build, install, activation or service calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const SOURCE = '/home/shawn-rochford/AI/runtime/promotion-major-20261022-DHQ6ZH/source';
const TEST = '/home/shawn-rochford/AI/deploy/otg-test';
const ROLLBACK = 'test3001-h3-edit-simple-20261023T165500Z';
const POLICY = Object.freeze({ source: SOURCE, releases: `${TEST}/releases`, current: `${TEST}/current`,
  expectedCurrent: `${TEST}/releases/${ROLLBACK}`,
  env: '/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',
  data: '/home/shawn-rochford/AI/runtime/test/data',
  node: '/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node', nodeVersion: 'v22.23.4', appVersion: '2.0.1' });
const ASSETS = ['public', 'comfy_workflows', 'scripts', 'lib', 'config', 'workflows'];
const HELPERS = ['activate_test_release.py', 'systemd_runtime.py'];
const BUILD_FILES = ['.next/BUILD_ID', '.next/required-server-files.json', '.next/routes-manifest.json', '.next/prerender-manifest.json', '.next/standalone/server.js', '.next/standalone/package.json', '.next/standalone/.next/BUILD_ID'];
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.next', '.cache', '__pycache__', '.gradle', '.venv', 'venv', '.patch-backups', 'coverage']);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const digest = records => sha(JSON.stringify(records));
function insist(ok, message) { if (!ok) throw new Error(message); }
function exists(file) { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function inside(root, file) { return file === root || file.startsWith(root + path.sep); }
function real(file) { return fs.realpathSync(file); }
function regular(file) { insist(fs.lstatSync(file).isFile(), 'Expected regular file: ' + file); }
function directory(file) { insist(fs.lstatSync(file).isDirectory(), 'Expected real directory: ' + file); }
function exclusion(rel) {
  const parts = rel.split('/'), name = parts.at(-1);
  if (EXCLUDED_DIRS.has(name)) return 'dependency/build/cache/Git metadata';
  if (parts[0] === 'data' || /^(?:test[-_]?data|uploads|secrets|backups|models|weights)$/i.test(name)) return 'runtime data/secrets/model storage';
  if ((parts.includes('build') || parts.includes('dist')) && !parts.includes('node_modules')) return 'generated build output';
  const sourceCode = /\.(?:[cm]?js|[jt]sx?|py|sh|ps1|md)$/i.test(name);
  if (/^(?:\.env(?:[.-]|$)|.*\.env(?:[.-]|$))/i.test(name) || (!sourceCode && /(?:secret|credentials?|tokens?)(?:[-_.]|$)/i.test(name)) || /\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(name)) return 'secret/environment material';
  if (/\.(?:safetensors|ckpt|gguf|ggml|pt|pth|onnx|bin|h5|pkl)$/i.test(name)) return 'model weights (never opened/hashed)';
  if (/\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/i.test(name)) return 'runtime database (never opened/hashed)';
  if (/\.(?:tar|tgz|gz|zip|7z|bak|log|tsbuildinfo|pyc)$/i.test(name)) return 'archive/cache/log';
  return null;
}
function sourceManifest(root) {
  const files = [], excluded = [];
  function walk(rel) {
    const absolute = path.join(root, rel);
    const why = exclusion(rel);
    if (why) { excluded.push({ path: rel, reason: why }); return; }
    const stat = fs.lstatSync(absolute);
    insist(!stat.isSymbolicLink(), 'Unreviewed source symlink: ' + rel);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) walk(rel ? `${rel}/${name}` : name);
    } else {
      insist(stat.isFile() && stat.size < 512 * 1024 ** 2, 'Unexpected source special/oversized file: ' + rel);
      const bytes = fs.readFileSync(absolute);
      files.push({ path: rel, bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 0o777 });
    }
  }
  for (const name of fs.readdirSync(root).sort()) walk(name);
  return { files, excluded, sourceSha256: digest(files) };
}
function gitState(root) {
  function git(args) { return cp.execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 ** 2 }).trimEnd(); }
  return { head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
    status: git(['status', '--porcelain=v1', '--untracked-files=all']) };
}
function validateRoots(source, policy = POLICY) {
  insist(path.resolve(source) === policy.source && real(source) === policy.source, 'Wrong source root');
  insist(real(policy.releases) === policy.releases, 'Wrong/symlinked TEST release root');
  insist(path.dirname(policy.expectedCurrent) === policy.releases && path.basename(policy.expectedCurrent) === ROLLBACK, 'Wrong fixed rollback release');
  insist(fs.lstatSync(policy.current).isSymbolicLink() && real(policy.current) === policy.expectedCurrent, 'Current TEST pointer differs from fixed verified rollback');
  directory(policy.expectedCurrent);
  insist(real(policy.expectedCurrent) === policy.expectedCurrent, 'Rollback release must not be a symlink');
  insist(real(policy.env) === policy.env && fs.lstatSync(policy.env).isFile(), 'Wrong TEST env target');
  insist(real(policy.data) === policy.data && fs.lstatSync(policy.data).isDirectory(), 'Wrong TEST data target');
  insist(JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version === policy.appVersion, 'App version must stay 2.0.1');
  for (const name of ['server.js', '.next/BUILD_ID']) regular(path.join(policy.expectedCurrent, name));
  validateLinks(policy.expectedCurrent, policy);
  for (const [name, target] of [['.env.local', policy.env], ['data', policy.data]]) {
    const file = path.join(source, name);
    if (!exists(file)) continue;
    // The existing source has local build data. Exclude it without reading/copying it.
    if (name === 'data' && fs.lstatSync(file).isDirectory()) continue;
    insist(fs.lstatSync(file).isSymbolicLink() && path.resolve(source, fs.readlinkSync(file)) === target && real(file) === target, 'Wrong source ' + name + ' link');
  }
}
function validateLinks(candidate, policy = POLICY) {
  for (const [name, expected] of [['.env.local', policy.env], ['data', policy.data]]) {
    const file = path.join(candidate, name);
    insist(fs.lstatSync(file).isSymbolicLink() && path.resolve(candidate, fs.readlinkSync(file)) === expected && real(file) === expected, 'Wrong TEST ' + name + ' link');
  }
}
function validateRuntime(version, executable, policy = POLICY) {
  insist(version === policy.nodeVersion && path.resolve(executable) === policy.node && real(executable) === real(policy.node), 'Runtime must be pinned Node 22.23.4');
}
function candidatePath(name, policy = POLICY) {
  insist(typeof name === 'string' && /^test3001-[a-z0-9-]+-\d{8}T\d{6}Z$/.test(name) && name !== ROLLBACK, 'Expected new timestamped TEST candidate name');
  const candidate = path.join(policy.releases, name);
  insist(!exists(candidate), 'Candidate already exists; refusing overwrite/reuse');
  return candidate;
}
function receiptPath(file, source, policy) {
  insist(path.isAbsolute(file), 'Build-input receipt must have an absolute path');
  const canonical = path.join(real(path.dirname(file)), path.basename(file));
  const runtimeRoot = path.dirname(policy.data);
  insist(canonical === file && !inside(source, file) && !inside(policy.releases, file) && !inside(runtimeRoot, file), 'Receipt must be outside source, releases, TEST runtime data/config');
  return file;
}
function captureInputs(source, policy = POLICY) {
  return { schemaVersion: 1, source, capturedAt: new Date().toISOString(), nodeVersion: policy.nodeVersion,
    appVersion: policy.appVersion, expectedCurrent: policy.expectedCurrent, ...sourceManifest(source), git: gitState(source) };
}
function validateBuild(source, receipt, manifest, policy = POLICY) {
  insist(receipt.schemaVersion === 1 && receipt.source === source && receipt.nodeVersion === policy.nodeVersion && receipt.appVersion === policy.appVersion && receipt.expectedCurrent === policy.expectedCurrent, 'Wrong build-input receipt identity');
  insist(receipt.sourceSha256 === digest(receipt.files) && receipt.sourceSha256 === manifest.sourceSha256 && JSON.stringify(receipt.files) === JSON.stringify(manifest.files), 'Source changed since build-input receipt; rebuild required');
  const captured = Date.parse(receipt.capturedAt);
  insist(Number.isFinite(captured) && captured <= Date.now(), 'Invalid build-input receipt timestamp');
  for (const rel of ['.next', '.next/standalone', '.next/standalone/.next', '.next/standalone/node_modules']) {
    const dir = path.join(source, rel);
    directory(dir);
    insist(real(dir) === dir, 'External/symlinked build directory refused');
  }
  for (const file of BUILD_FILES) regular(path.join(source, file));
  const build = path.join(source, '.next/BUILD_ID');
  insist(fs.statSync(build).mtimeMs >= captured, 'Old build predates source receipt');
  const id = fs.readFileSync(build, 'utf8').trim();
  insist(id.length > 0 && id === fs.readFileSync(path.join(source, '.next/standalone/.next/BUILD_ID'), 'utf8').trim(), 'Standalone build ID mismatch');
  insist(JSON.parse(fs.readFileSync(path.join(source, '.next/standalone/package.json'), 'utf8')).version === policy.appVersion, 'Standalone app version mismatch');
  directory(path.join(source, '.next/static'));
  insist(fs.readdirSync(path.join(source, '.next/static')).length > 0, 'Static build assets missing');
  for (const asset of ASSETS) directory(path.join(source, asset));
  for (const helper of HELPERS) regular(path.join(source, 'scripts/deploy', helper));
  // Source receipt plus explicit owner attestation bind this build to frozen inputs.
  insist(!exists(path.join(source, '.next/lock')), 'Build still holds its lock');
  return id;
}
function nativePreflight(root, policy = POLICY, run = cp.execFileSync) {
  const probe = "(async()=>{if(process.version!=='v22.23.4')throw Error('runtime');const{createRequire}=require('node:module');const r=createRequire(require('node:path').join(process.argv[1],'package.json'));const D=r('better-sqlite3');const db=new D(':memory:');try{if(db.prepare('select 1 as ok').get().ok!==1)throw Error('sqlite')}finally{db.close()}const png=await r('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();if(!png.length)throw Error('sharp');process.stdout.write('native-ok')})().catch(()=>{process.stderr.write('Native preflight failed');process.exitCode=1})";
  const output = run(policy.node, ['-e', probe, root], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: path.dirname(policy.node) + ':/usr/bin:/bin', NODE_ENV: 'test' } });
  insist(output === 'native-ok', 'SQLite/Sharp native preflight failed');
  return { nodeVersion: policy.nodeVersion, sqlite: 'in-memory-query-passed', sharp: '2x2-png-passed' };
}
function plan(policy = POLICY) {
  return { mode: 'plan-only-no-files-copied', source: policy.source, releases: policy.releases,
    fixedExpectedCurrentAndRollback: policy.expectedCurrent, node: policy.node, nodeVersion: policy.nodeVersion,
    appVersion: policy.appVersion, links: { '.env.local': policy.env, data: policy.data },
    required: ['explicit packaging request after successful main build', 'prebuild source receipt', '--package --build-complete --build-inputs <absolute-receipt> --candidate <new-test3001-name>'],
    copiedAssets: ['.next/standalone', '.next/static', ...ASSETS, 'app/workflows if present', 'recovery-source', 'owner-activation helpers'],
    activation: false, build: false, overwrite: false, copyLiveData: false, copySecrets: false, modelWeights: false };
}
// Pre-enumerate every copy before creating a candidate. Never follow symlinks to read files.
function copyRecords(root, { standalone = false, prefix = '' } = {}) {
  const records = [];
  function walk(rel) {
    const abs = path.join(root, rel), parts = rel.split('/');
    const why = exclusion(rel);
    // Only the two build/dependency directories are permitted through exclusions.
    if (why && !(standalone && ['node_modules', '.next'].includes(parts.at(-1)))) return;
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(abs);
      insist(!path.isAbsolute(target) && inside(root, real(abs)), 'External/absolute package symlink refused: ' + rel);
      insist(!exclusion(path.relative(root, real(abs)).split(path.sep).join('/')), 'Symlink to excluded data/secret/model refused: ' + rel);
      records.push({ from: abs, to: prefix + rel, link: target });
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) walk(rel ? `${rel}/${name}` : name);
    } else {
      insist(stat.isFile(), 'Special package file refused: ' + rel);
      records.push({ from: abs, to: prefix + rel, bytes: stat.size, mode: stat.mode & 0o777 });
    }
  }
  for (const name of fs.readdirSync(root).sort()) walk(name);
  return records;
}
function copyFileExclusive(from, to, mode) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(to, mode ?? (fs.statSync(from).mode & 0o777));
}
function writeExclusive(file, data) {
  fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 });
}
function ownerInstructions(candidate, policy) {
  const helper = `${candidate}/owner-activation/activate_test_release.py`;
  return `# Packaged TEST candidate only\n\nApp version ${policy.appVersion}; Node ${policy.nodeVersion}. No activation has occurred.\n\nFixed verified rollback: ${policy.expectedCurrent}\nCandidate: ${candidate}\n\nThe following are owner instructions for separately authorized TEST activation and rollback. Packaging never runs them. The existing helper verifies the TEST pointer, Node runtime, native modules, environment/data links and service process; it requires authorized OS root on shawn.\n\nForward activation (only after reviewing PACKAGE_MANIFEST.json, SOURCE_MANIFEST.json and absence of DO_NOT_ACTIVATE):\n\n\`\`\`sh\nsudo /usr/bin/python3 ${helper} --expected-current ${policy.expectedCurrent} --candidate ${candidate}\n\`\`\`\n\nRollback (only if this candidate is still current):\n\n\`\`\`sh\nsudo /usr/bin/python3 ${helper} --expected-current ${candidate} --candidate ${policy.expectedCurrent}\n\`\`\`\n\nHelpers are copied from scripts/deploy with their dependency systemd_runtime.py and hashed in the package manifest. Rollback restores the fixed TEST release, not a moving current pointer. Runtime data and env are symlinks only; recovery-source excludes their contents, model weights, dependencies and build caches. This is code/artifact recovery, not a database backup. No data restore is authorized.\n`;
}
function packageCandidate({ source, name, receipt, buildComplete }, policy = POLICY) {
  insist(buildComplete === true, 'Explicit --build-complete attestation required');
  validateRoots(source, policy);
  validateRuntime(process.version, process.execPath, policy);
  const candidate = candidatePath(name, policy);
  const before = sourceManifest(source);
  const buildId = validateBuild(source, receipt, before, policy);
  const nativeSource = nativePreflight(source, policy);
  const copies = new Map();
  const add = records => { for (const record of records) copies.set(record.to, record); };
  add(copyRecords(path.join(source, '.next/standalone'), { standalone: true }));
  add(copyRecords(path.join(source, '.next/static'), { prefix: '.next/static/' }));
  for (const asset of ASSETS) add(copyRecords(path.join(source, asset), { prefix: asset + '/' }));
  if (exists(path.join(source, 'app/workflows'))) add(copyRecords(path.join(source, 'app/workflows'), { prefix: 'app/workflows/' }));
  // Asset overlay is intentional; standalone may already trace scripts/lib/config.
  for (const file of before.files) copies.set('recovery-source/' + file.path, { from: path.join(source, file.path), to: 'recovery-source/' + file.path, ...file });
  for (const helper of HELPERS) {
    const rel = 'scripts/deploy/' + helper;
    copies.set('owner-activation/' + helper, { from: path.join(source, rel), to: 'owner-activation/' + helper });
  }
  // Runtime overlays and owner helpers must match the same frozen source as recovery.
  const frozen = new Map(before.files.map(file => [path.join(source, file.path), file]));
  for (const record of copies.values()) {
    const expected = frozen.get(record.from);
    if (expected) { record.sha256 = expected.sha256; record.mode = expected.mode; }
  }
  // Refuse overlays that would copy through a symlinked ancestor directory.
  for (const rel of copies.keys()) {
    let parent = path.posix.dirname(rel);
    while (parent !== '.') {
      insist(copies.get(parent)?.link === undefined, 'Package copy crosses a symlinked ancestor: ' + rel);
      parent = path.posix.dirname(parent);
    }
  }
  for (const required of ['server.js', 'package.json', '.next/BUILD_ID', 'node_modules/next/package.json', 'node_modules/better-sqlite3/package.json', 'node_modules/sharp/package.json']) insist(copies.has(required), 'Standalone dependency missing: ' + required);
  // No writes before all root/build/source/native/copy validation has passed.
  fs.mkdirSync(candidate, { mode: 0o700 });
  const marker = path.join(candidate, 'DO_NOT_ACTIVATE');
  writeExclusive(marker, 'Packaging incomplete. Never activate this candidate.\n');
  try {
    const artifacts = [];
    for (const record of [...copies.values()].sort((a, b) => a.to.localeCompare(b.to))) {
      insist(inside(candidate, path.resolve(candidate, record.to)), 'Copy escaped candidate');
      const to = path.join(candidate, record.to);
      if (record.link !== undefined) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.symlinkSync(record.link, to);
        artifacts.push({ path: record.to, link: record.link });
      } else {
        copyFileExclusive(record.from, to, record.mode);
        const bytes = fs.readFileSync(to);
        const actual = { path: record.to, bytes: bytes.length, sha256: sha(bytes) };
        if (record.sha256) insist(actual.sha256 === record.sha256, 'Source changed during copy: ' + record.to);
        artifacts.push(actual);
      }
    }
    fs.symlinkSync(policy.env, path.join(candidate, '.env.local'));
    fs.symlinkSync(policy.data, path.join(candidate, 'data'));
    validateLinks(candidate, policy);
    const nativeCandidate = nativePreflight(candidate, policy);
    validateRoots(source, policy);
    const after = sourceManifest(source);
    insist(after.sourceSha256 === before.sourceSha256, 'Source changed during packaging; candidate invalid');
    insist(fs.readFileSync(path.join(source, '.next/BUILD_ID'), 'utf8').trim() === buildId, 'Build changed during packaging');
    const sourceReceipt = { ...before, schemaVersion: 1, source, git: gitState(source), buildInputCapturedAt: receipt.capturedAt,
      recoveryBaseline: { path: '/home/shawn-rochford/AI/research/h3-phase3-20261023-y8YGow', sourceSha256: '9094bc05fc62621566c5b53886420a028c4577f0a8cdbfc25bdf7e2aeb613301' } };
    const documents = { 'SOURCE_MANIFEST.json': JSON.stringify(sourceReceipt, null, 2) + '\n',
      'OWNER_TEST_ONLY.md': ownerInstructions(candidate, policy), '.release_id': name + '\n' };
    for (const [rel, contents] of Object.entries(documents)) {
      writeExclusive(path.join(candidate, rel), contents);
      artifacts.push({ path: rel, bytes: Buffer.byteLength(contents), sha256: sha(contents) });
    }
    const result = { schemaVersion: 1, state: 'packaged-not-activated', environment: 'TEST', candidate,
      createdAt: new Date().toISOString(), buildId, appVersion: policy.appVersion, sourceSha256: before.sourceSha256,
      fixedExpectedCurrentAndRollback: policy.expectedCurrent, runtime: { node: policy.node, nativeSource, nativeCandidate },
      links: { '.env.local': policy.env, data: policy.data }, sourceFileCount: before.files.length, artifacts };
    writeExclusive(path.join(candidate, 'PACKAGE_MANIFEST.json'), JSON.stringify(result, null, 2) + '\n');
    // Remove only our own incomplete marker, after all validation and manifests succeed.
    fs.unlinkSync(marker);
    return { ...result, artifacts: artifacts.length };
  } catch (error) {
    // Preserve incomplete candidate for inspection; never delete/reuse an old candidate.
    throw new Error('Packaging failed; incomplete TEST candidate retained with DO_NOT_ACTIVATE: ' + error.message);
  }
}
function main(args) {
  if (!args.length) { process.stdout.write(JSON.stringify(plan(), null, 2) + '\n'); return; }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    insist(['--record-build-inputs', '--package', '--build-complete', '--build-inputs', '--candidate'].includes(key) && !Object.hasOwn(options, key), 'Unknown/duplicate option');
    if (['--package', '--build-complete'].includes(key)) options[key] = true;
    else { insist(args[i + 1] && !args[i + 1].startsWith('--'), 'Missing option value'); options[key] = args[++i]; }
  }
  const source = path.resolve(__dirname, '../..');
  validateRoots(source);
  validateRuntime(process.version, process.execPath);
  if (options['--record-build-inputs']) {
    insist(Object.keys(options).length === 1, 'Record build inputs separately, before the main build');
    const file = receiptPath(options['--record-build-inputs'], source, POLICY);
    writeExclusive(file, JSON.stringify(captureInputs(source), null, 2) + '\n');
    process.stdout.write('Recorded source inputs only; no build or packaging performed.\n');
  } else {
    insist(options['--package'] && options['--build-complete'] && options['--build-inputs'] && options['--candidate'], 'Packaging requires --package --build-complete --build-inputs --candidate');
    const file = receiptPath(options['--build-inputs'], source, POLICY);
    regular(file);
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(JSON.stringify(packageCandidate({ source, name: options['--candidate'], receipt, buildComplete: true }), null, 2) + '\n');
  }
}
module.exports = { POLICY, ASSETS, BUILD_FILES, exclusion, sourceManifest, validateRoots, validateLinks, validateRuntime,
  candidatePath, captureInputs, validateBuild, nativePreflight, plan, copyRecords, receiptPath, ownerInstructions, packageCandidate, main };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`TEST packaging refused: ${error.message}\n`); process.exitCode = 1; } }
