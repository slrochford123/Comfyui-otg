// Only invoked by the pinned TEST activator, first against private copies.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const candidate = path.resolve(process.argv[2]), data = path.resolve(process.env.OTG_DATA_DIR || '');
if (process.env.OTG_ENV !== 'test' || !candidate.startsWith('/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-') ||
    !(data === '/home/shawn-rochford/AI/runtime/test/data' || data.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-') ||
      /^\/home\/shawn-rochford\/AI\/research\/story-talkback-[A-Za-z0-9-]+\/test-activation-backup-[A-Za-z0-9-]+\/rehearsal$/.test(data))) throw Error('Invalid TEST migration boundary');
const Database = require(candidate + '/node_modules/better-sqlite3');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const names = ['otg.db', 'story-creator/story-creator.sqlite', 'openai/usage.sqlite'];
const before = [];
for (const name of names) {
  const file = path.join(data, name);
  if (!fs.existsSync(file)) continue;
  const db = new Database(file, {readonly: true});
  try {
    for (const table of db.pragma('table_list').filter(t => t.schema === 'main' && t.type === 'table' && !t.name.startsWith('sqlite_'))) {
      const columns = db.pragma('table_info(' + quote(table.name) + ')').map(c => c.name);
      const rows = db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(table.name)).raw().all();
      before.push({name, table:table.name, columns, rows: rows.map(hash)});
    }
  } finally { db.close(); }
}
const auth = require(candidate + '/lib/auth/db.ts'); auth.ensureMigrations();
require(candidate + '/lib/storyCreator/store.ts').listStoryCreatorProjects('__migration_no_owner__');
const usage = require(candidate + '/lib/openai/usageLedger.ts').readLedgerUsage();
let checked = 0;
for (const original of before) {
  const db = new Database(path.join(data, original.name), {readonly:true});
  try {
    const after = db.prepare('SELECT '+original.columns.map(quote).join(',')+' FROM '+quote(original.table)).raw().all();
    const remaining = new Map();
    for (const row of after) { const key=hash(row); remaining.set(key,(remaining.get(key)||0)+1); }
    for (const key of original.rows) {
      if (!(remaining.get(key)>0)) throw Error('Original rows changed: '+original.name+'/'+original.table);
      remaining.set(key,remaining.get(key)-1); checked++;
    }
  } finally { db.close(); }
}
for (const name of names) {
  const db = new Database(path.join(data,name), {readonly:true});
  try { if(db.pragma('quick_check',{simple:true})!=='ok') throw Error('Integrity check failed: '+name); }
  finally { db.close(); }
}
const administrators = auth.db.prepare("SELECT COUNT(*) n FROM user_roles WHERE role='admin'").get().n;
if(!administrators) throw Error('No preserved administrator role');
console.log(JSON.stringify({ok:true,originalRowsPreserved:checked,originalTablesChecked:before.length,administrators,usageRecords:usage.length,quickCheck:'ok'}));
