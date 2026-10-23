#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const FILE = path.resolve(__dirname, '../../config/build-history.json');
function ordinal(version) {
  if (typeof version !== 'string' || !/^[1-9]\d{0,3}(?:\.\d{2})?$/.test(version)) throw Error('Use an integer build or exactly two fractional digits, for example 2 or 2.01.');
  const [major, minor = '00'] = version.split('.');
  return Number(major) * 100 + Number(minor);
}
function recordBuild(history, version, summary, commit, date) {
  if (history.schemaVersion !== 1 || !Array.isArray(history.builds) || !history.builds.length || history.builds.at(-1).version !== history.current) throw Error('Invalid existing build history.');
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 240 || !/^[a-f0-9]{40}$/.test(commit) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw Error('Invalid release summary, source revision or date.');
  if (ordinal(version) <= Math.max(...history.builds.map(build => ordinal(build.version)))) throw Error('A new build must be newer than all recorded builds; history is append-only.');
  return { ...history, current: version, builds: [...history.builds, { version, date, summary: summary.trim(), sourceBaseCommit: commit }] };
}
function main(args) {
  if (args.length === 0) { console.log('Build ' + JSON.parse(fs.readFileSync(FILE)).current); return; }
  if (args.length !== 5 || args[0] !== '--record' || args[1] !== '--version' || args[3] !== '--summary') throw Error('Usage: record-build.cjs --record --version 2.01 --summary "Release summary"');
  if (fs.lstatSync(FILE).isSymbolicLink()) throw Error('Refusing a symlinked build history.');
  const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.dirname(FILE), encoding: 'utf8' }).trim();
  const value = recordBuild(JSON.parse(fs.readFileSync(FILE)), args[2], args[4], commit, new Date().toISOString().slice(0, 10));
  const temporary = FILE + '.release-' + process.pid;
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 }); fs.renameSync(temporary, FILE); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  console.log('Recorded Build ' + value.current + '. Commit and build this source before packaging; no deployment performed.');
}
module.exports = { ordinal, recordBuild, main };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
