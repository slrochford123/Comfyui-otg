const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const assert = require("node:assert/strict");
const evidence = path.resolve(process.argv[2] || "");
const backup = path.join(evidence, "story-creator-baseline.sqlite");
const data = path.join(evidence, "migration-rehearsal");
fs.mkdirSync(path.join(data, "story-creator"), { mode: 0o700, recursive: true });
const target = path.join(data, "story-creator/story-creator.sqlite");
fs.copyFileSync(backup, target, fs.constants.COPYFILE_EXCL);
const source = new Database(backup, { readonly: true });
const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const schemas = tables.map(name => ({ name, columns: source.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name) }));
function fingerprint(database, table) {
  const rows = database.prepare(`SELECT ${table.columns.map(quote).join(",")} FROM ${quote(table.name)}`).all().map(row => JSON.stringify(row)).sort();
  return { rows: rows.length, sha256: crypto.createHash("sha256").update(rows.join("\n")).digest("hex") };
}
const before = schemas.map(table => ({ table: table.name, ...fingerprint(source, table) }));
process.env.OTG_DATA_DIR = data; process.env.OTG_DATA_ROOT = data;
const store = require("../../lib/storyCreator/store.ts");
// Open the exact candidate store/migrations without creating any user records.
store.listStoryCreatorProjects("migration-qa-no-content");
const migrated = new Database(target, { readonly: true });
const after = schemas.map(table => ({ table: table.name, ...fingerprint(migrated, table) }));
assert.deepEqual(after, before, "An existing story row changed during additive migration rehearsal.");
assert.equal(migrated.pragma("quick_check", { simple: true }), "ok");
const restored = path.join(data, "restored-baseline.sqlite");
fs.copyFileSync(backup, restored, fs.constants.COPYFILE_EXCL);
const restore = new Database(restored, { readonly: true });
assert.equal(restore.pragma("quick_check", { simple: true }), "ok");
assert.deepEqual(schemas.map(table => ({ table: table.name, ...fingerprint(restore, table) })), before);
fs.writeFileSync(path.join(evidence, "migration-and-restore.json"), JSON.stringify({ ok: true,
  existingTables: before, oldRowsUnchanged: true, restoredCopyVerified: true, liveDatabaseChanged: false }, null, 2), { mode: 0o600 });
source.close(); migrated.close(); restore.close();
console.log(JSON.stringify({ ok: true, existingTables: before.length, oldRowsUnchanged: true, restoredCopyVerified: true, liveDatabaseChanged: false }));
