#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function runAudit() {
  const res = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const raw = res.stdout || res.stderr || '';
  if (!raw.trim()) {
    throw new Error('npm audit produced no JSON output');
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fs.writeFileSync('npm-audit.raw.txt', raw, 'utf8');
    throw new Error(`Could not parse npm audit JSON. Raw output saved to npm-audit.raw.txt. ${error?.message || error}`);
  }
}

function loadPackage() {
  try { return JSON.parse(fs.readFileSync('package.json', 'utf8')); }
  catch { return {}; }
}

function rootDeps(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ]);
}

function fixClass(v) {
  const fix = v.fixAvailable;
  if (!fix) return 'no-fix';
  if (fix === true) return 'safe-fix';
  if (typeof fix === 'object' && fix.isSemVerMajor) return 'major-fix';
  return 'safe-fix';
}

function classify(v, directNames) {
  const direct = Boolean(v.isDirect || directNames.has(v.name));
  const dev = Boolean(v.dev);
  return {
    package: v.name,
    severity: v.severity,
    direct: direct ? 'direct' : 'transitive',
    scope: dev ? 'dev' : 'runtime',
    fix: fixClass(v),
    via: Array.isArray(v.via) ? v.via.map((x) => typeof x === 'string' ? x : x?.title || x?.source || '').filter(Boolean).join('; ') : '',
    range: v.range || '',
    nodes: Array.isArray(v.nodes) ? v.nodes.join(', ') : '',
  };
}

function printTable(rows) {
  if (!rows.length) {
    console.log('No vulnerabilities reported by npm audit.');
    return;
  }
  const headers = ['severity', 'package', 'direct', 'scope', 'fix', 'range'];
  const widths = Object.fromEntries(headers.map((h) => [h, Math.max(h.length, ...rows.map((r) => String(r[h] || '').length))]));
  console.log(headers.map((h) => h.padEnd(widths[h])).join('  '));
  console.log(headers.map((h) => '-'.repeat(widths[h])).join('  '));
  for (const r of rows) {
    console.log(headers.map((h) => String(r[h] || '').padEnd(widths[h])).join('  '));
  }
}

const pkg = loadPackage();
const audit = runAudit();
const directNames = rootDeps(pkg);
const vulns = audit.vulnerabilities || {};
const rows = Object.values(vulns).map((v) => classify(v, directNames)).sort((a, b) => {
  const sev = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3, info: 4 };
  return (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) || a.package.localeCompare(b.package);
});

printTable(rows);

const directSafe = rows.filter((r) => r.direct === 'direct' && r.fix === 'safe-fix');
const transitiveSafe = rows.filter((r) => r.direct === 'transitive' && r.fix === 'safe-fix');
const major = rows.filter((r) => r.fix === 'major-fix');
const noFix = rows.filter((r) => r.fix === 'no-fix');

console.log('\nRecommended order:');
console.log(`1. Direct safe fixes: ${directSafe.map((r) => r.package).join(', ') || 'none'}`);
console.log(`2. Transitive safe fixes: ${transitiveSafe.map((r) => r.package).join(', ') || 'none'}`);
console.log(`3. Major/force fixes for TEST only after green tests: ${major.map((r) => r.package).join(', ') || 'none'}`);
console.log(`4. No-fix/manual review: ${noFix.map((r) => r.package).join(', ') || 'none'}`);

const hasThree = directNames.has('three');
const hasModelViewer = directNames.has('@google/model-viewer');
console.log('\nthree / @google/model-viewer peer check:');
if (!hasThree && !hasModelViewer) {
  console.log('No direct three or @google/model-viewer dependency found in root package.json. Run npm ls three @google/model-viewer to inspect transitive installs.');
} else {
  console.log(`three direct: ${hasThree ? pkg.dependencies?.three || pkg.devDependencies?.three || 'present' : 'no'}`);
  console.log(`@google/model-viewer direct: ${hasModelViewer ? pkg.dependencies?.['@google/model-viewer'] || pkg.devDependencies?.['@google/model-viewer'] || 'present' : 'no'}`);
  console.log('If npm reports a peer conflict, pin both direct dependencies explicitly and avoid npm audit fix --force until the Playwright and Vitest suites pass on TEST.');
}
